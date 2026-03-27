package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const agentPollConcurrency = 5

// pullMetricPayload mirrors the JSON structure returned by pull-mode agents.
type pullMetricPayload struct {
	CPUUsage     float64 `json:"cpu_usage"`
	MemUsage     float64 `json:"mem_usage"`
	MemTotalMB   int64   `json:"mem_total_mb"`
	MemUsedMB    int64   `json:"mem_used_mb"`
	DiskReadBps  int64   `json:"disk_read_bps"`
	DiskWriteBps int64   `json:"disk_write_bps"`
	DiskUsagePct float64 `json:"disk_usage_pct"`
	NetRxBps     int64   `json:"net_rx_bps"`
	NetTxBps     int64   `json:"net_tx_bps"`
	LoadAvg1m    float64 `json:"load_avg_1m"`
	ProcessCount int     `json:"process_count"`
}

// runAgentPoll fetches metrics from all pull-mode agents.
func runAgentPoll(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT id, name, agent_url FROM assets
		 WHERE agent_url IS NOT NULL
		   AND status != 'decommissioned'
		   AND is_active = true`)
	if err != nil {
		return fmt.Errorf("agent poll query: %w", err)
	}
	defer rows.Close()

	type target struct {
		ID       int
		Name     string
		AgentURL string
	}

	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.ID, &t.Name, &t.AgentURL); err != nil {
			slog.Warn("agent poll scan 실패", "error", err)
			continue
		}
		targets = append(targets, t)
	}
	rows.Close()

	if len(targets) == 0 {
		return nil
	}

	sem := make(chan struct{}, agentPollConcurrency)
	var wg sync.WaitGroup

	for _, t := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(tgt target) {
			defer wg.Done()
			defer func() { <-sem }()

			if err := pollAgent(tgt.ID, tgt.AgentURL, pool); err != nil {
				slog.Warn("agent poll 실패", "asset_id", tgt.ID, "url", tgt.AgentURL, "error", err)
			}
		}(t)
	}

	wg.Wait()
	return nil
}

// pollAgent fetches metrics from a single agent and stores them.
func pollAgent(assetID int, agentURL string, pool *pgxpool.Pool) error {
	client := &http.Client{Timeout: 10 * time.Second}

	url := agentURL + "/metrics"
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("HTTP GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	var payload pullMetricPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Store metric.
	_, err = pool.Exec(ctx,
		`INSERT INTO metrics (asset_id, collected_at, cpu_usage, mem_usage, mem_total_mb, mem_used_mb,
		        disk_read_bps, disk_write_bps, disk_usage_pct, net_rx_bps, net_tx_bps,
		        load_avg_1m, process_count)
		 VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		assetID, payload.CPUUsage, payload.MemUsage, payload.MemTotalMB, payload.MemUsedMB,
		payload.DiskReadBps, payload.DiskWriteBps, payload.DiskUsagePct,
		payload.NetRxBps, payload.NetTxBps, payload.LoadAvg1m, payload.ProcessCount)
	if err != nil {
		return fmt.Errorf("metrics insert: %w", err)
	}

	// Update last_seen.
	_, err = pool.Exec(ctx,
		`UPDATE assets SET status = 'online', last_seen = now() WHERE id = $1`, assetID)
	if err != nil {
		return fmt.Errorf("last_seen update: %w", err)
	}

	return nil
}
