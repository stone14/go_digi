package scheduler

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const bmcCollectConcurrency = 5

type bmcTarget struct {
	AssetID  int
	Name     string
	BmcIP    string
	BmcType  *string
	Username string
	Password string
}

// runBMCCollect queries Redfish endpoints on BMC-enabled assets and stores
// thermal, power, and health data.
func runBMCCollect(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT a.id, a.name, a.bmc_ip::text, a.bmc_type,
		        bc.username, bc.password
		 FROM assets a
		 JOIN bmc_credentials bc ON bc.asset_id = a.id
		 WHERE a.bmc_enabled = true
		   AND a.bmc_ip IS NOT NULL
		   AND a.is_active = true`)
	if err != nil {
		return fmt.Errorf("bmc query: %w", err)
	}
	defer rows.Close()

	var targets []bmcTarget
	for rows.Next() {
		var t bmcTarget
		if err := rows.Scan(&t.AssetID, &t.Name, &t.BmcIP, &t.BmcType,
			&t.Username, &t.Password); err != nil {
			slog.Warn("bmc scan 실패", "error", err)
			continue
		}
		targets = append(targets, t)
	}
	rows.Close()

	if len(targets) == 0 {
		return nil
	}

	sem := make(chan struct{}, bmcCollectConcurrency)
	var wg sync.WaitGroup

	for _, t := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(tgt bmcTarget) {
			defer wg.Done()
			defer func() { <-sem }()

			if err := collectBMC(tgt, pool); err != nil {
				slog.Warn("BMC collect 실패", "asset_id", tgt.AssetID, "bmc_ip", tgt.BmcIP, "error", err)
			}
		}(t)
	}

	wg.Wait()
	return nil
}

// collectBMC calls Redfish API endpoints on a single BMC and stores results.
func collectBMC(tgt bmcTarget, pool *pgxpool.Pool) error {
	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // BMC self-signed certs
		},
	}

	baseURL := fmt.Sprintf("https://%s", tgt.BmcIP)

	var powerWatts *int
	var cpu1Temp, cpu2Temp, inletTemp, outletTemp *int16
	var fanSpeeds map[string]interface{}
	var overallHealth string

	// ── Thermal ────────────────────────────────────────────────────
	thermalBody, err := redfishGet(client, baseURL+"/redfish/v1/Chassis/1/Thermal", tgt.Username, tgt.Password)
	if err != nil {
		slog.Debug("BMC thermal 조회 실패", "asset_id", tgt.AssetID, "error", err)
	} else {
		temps, _ := thermalBody["Temperatures"].([]interface{})
		for _, t := range temps {
			tm, ok := t.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := tm["Name"].(string)
			reading, ok := tm["ReadingCelsius"].(float64)
			if !ok {
				continue
			}
			r := int16(reading)
			switch {
			case containsAny(name, "CPU1", "CPU 1", "Processor 1"):
				cpu1Temp = &r
			case containsAny(name, "CPU2", "CPU 2", "Processor 2"):
				cpu2Temp = &r
			case containsAny(name, "Inlet", "Ambient"):
				inletTemp = &r
			case containsAny(name, "Outlet", "Exhaust"):
				outletTemp = &r
			}
		}

		fans, _ := thermalBody["Fans"].([]interface{})
		fanMap := map[string]interface{}{}
		for _, f := range fans {
			fm, ok := f.(map[string]interface{})
			if !ok {
				continue
			}
			fname, _ := fm["Name"].(string)
			if fname == "" {
				continue
			}
			if reading, ok := fm["Reading"].(float64); ok {
				fanMap[fname] = reading
			}
		}
		if len(fanMap) > 0 {
			fanSpeeds = fanMap
		}
	}

	// ── Power ──────────────────────────────────────────────────────
	powerBody, err := redfishGet(client, baseURL+"/redfish/v1/Chassis/1/Power", tgt.Username, tgt.Password)
	if err != nil {
		slog.Debug("BMC power 조회 실패", "asset_id", tgt.AssetID, "error", err)
	} else {
		if controls, ok := powerBody["PowerControl"].([]interface{}); ok && len(controls) > 0 {
			pc, ok := controls[0].(map[string]interface{})
			if ok {
				if watts, ok := pc["PowerConsumedWatts"].(float64); ok {
					w := int(watts)
					powerWatts = &w
				}
			}
		}
	}

	// ── System Health ──────────────────────────────────────────────
	sysBody, err := redfishGet(client, baseURL+"/redfish/v1/Systems/1", tgt.Username, tgt.Password)
	if err != nil {
		slog.Debug("BMC system 조회 실패", "asset_id", tgt.AssetID, "error", err)
	} else {
		if status, ok := sysBody["Status"].(map[string]interface{}); ok {
			if h, ok := status["Health"].(string); ok {
				overallHealth = h
			}
		}
	}

	// ── Store metrics ──────────────────────────────────────────────
	dbCtx, dbCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dbCancel()

	var fanJSON []byte
	if fanSpeeds != nil {
		fanJSON, _ = json.Marshal(fanSpeeds)
	}

	_, err = pool.Exec(dbCtx,
		`INSERT INTO bmc_metrics (asset_id, collected_at, power_watts,
		        cpu1_temp_c, cpu2_temp_c, inlet_temp_c, outlet_temp_c,
		        fan_speeds, overall_health)
		 VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
		tgt.AssetID, powerWatts, cpu1Temp, cpu2Temp, inletTemp, outletTemp,
		fanJSON, nilIfEmptyStr(overallHealth))
	if err != nil {
		return fmt.Errorf("bmc_metrics insert: %w", err)
	}

	// Update hw_health on status change.
	if overallHealth != "" {
		status := "ok"
		if overallHealth != "OK" {
			status = "warning"
		}
		var prevStatus string
		err := pool.QueryRow(dbCtx,
			`SELECT status FROM hw_health
			 WHERE asset_id = $1 AND component = 'system'
			 ORDER BY checked_at DESC LIMIT 1`, tgt.AssetID,
		).Scan(&prevStatus)

		if err != nil || prevStatus != status {
			pool.Exec(dbCtx,
				`INSERT INTO hw_health (asset_id, component, name, status, message)
				 VALUES ($1, 'system', 'Overall Health', $2, $3)`,
				tgt.AssetID, status, overallHealth)
		}
	}

	return nil
}

// redfishGet performs an authenticated GET to a Redfish endpoint.
func redfishGet(client *http.Client, url, user, pass string) (map[string]interface{}, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(user, pass)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body, nil
}
