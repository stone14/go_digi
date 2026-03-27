package scheduler

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const serviceCheckConcurrency = 10

// runServiceChecks executes all active service checks in parallel (up to 10
// concurrent) and records the results. State transitions trigger alert
// creation or resolution.
func runServiceChecks(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT sc.id, sc.asset_id, sc.name, sc.type, sc.target,
		        sc.timeout_s, sc.expected_code, sc.expected_body
		 FROM service_checks sc
		 WHERE sc.is_active = true`)
	if err != nil {
		return fmt.Errorf("service_checks query: %w", err)
	}
	defer rows.Close()

	type check struct {
		ID           int
		AssetID      int
		Name         string
		Type         string
		Target       string
		TimeoutS     int
		ExpectedCode *int
		ExpectedBody *string
	}

	var checks []check
	for rows.Next() {
		var c check
		if err := rows.Scan(&c.ID, &c.AssetID, &c.Name, &c.Type, &c.Target,
			&c.TimeoutS, &c.ExpectedCode, &c.ExpectedBody); err != nil {
			slog.Warn("service check scan 실패", "error", err)
			continue
		}
		checks = append(checks, c)
	}
	rows.Close()

	if len(checks) == 0 {
		return nil
	}

	sem := make(chan struct{}, serviceCheckConcurrency)
	var wg sync.WaitGroup

	for _, ch := range checks {
		wg.Add(1)
		sem <- struct{}{}
		go func(c check) {
			defer wg.Done()
			defer func() { <-sem }()

			status, responseMs, msg := executeCheck(c.Type, c.Target, c.TimeoutS, c.ExpectedCode, c.ExpectedBody)

			// Store result.
			dbCtx, dbCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer dbCancel()

			_, err := pool.Exec(dbCtx,
				`INSERT INTO service_check_results (check_id, checked_at, status, response_ms, message)
				 VALUES ($1, now(), $2, $3, $4)`,
				c.ID, status, responseMs, msg)
			if err != nil {
				slog.Warn("service check result 저장 실패", "check_id", c.ID, "error", err)
			}

			// Detect state change for alerts.
			handleServiceCheckAlert(dbCtx, pool, c.ID, c.AssetID, c.Name, status)
		}(ch)
	}

	wg.Wait()
	return nil
}

// executeCheck runs a single service check and returns (status, response_ms, message).
func executeCheck(checkType, target string, timeoutS int, expectedCode *int, expectedBody *string) (string, int, string) {
	timeout := time.Duration(timeoutS) * time.Second
	if timeout == 0 {
		timeout = 5 * time.Second
	}

	start := time.Now()

	switch checkType {
	case "http":
		return checkHTTP(target, timeout, expectedCode, expectedBody, start)
	case "tcp":
		return checkTCP(target, timeout, start)
	case "icmp":
		// ICMP requires raw sockets (root); fall back to TCP ping.
		return checkTCP(target, timeout, start)
	case "dns":
		return checkDNS(target, timeout, start)
	default:
		return "critical", 0, fmt.Sprintf("unknown check type: %s", checkType)
	}
}

func checkHTTP(target string, timeout time.Duration, expectedCode *int, expectedBody *string, start time.Time) (string, int, string) {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(target)
	elapsed := int(time.Since(start).Milliseconds())
	if err != nil {
		return "critical", elapsed, err.Error()
	}
	defer resp.Body.Close()

	// Check status code.
	if expectedCode != nil && resp.StatusCode != *expectedCode {
		return "critical", elapsed, fmt.Sprintf("expected %d, got %d", *expectedCode, resp.StatusCode)
	}

	// Check body content if required.
	if expectedBody != nil && *expectedBody != "" {
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB limit
		if err != nil {
			return "warning", elapsed, "body read error: " + err.Error()
		}
		if !strings.Contains(string(body), *expectedBody) {
			return "critical", elapsed, "expected body not found"
		}
	}

	return "ok", elapsed, fmt.Sprintf("HTTP %d", resp.StatusCode)
}

func checkTCP(target string, timeout time.Duration, start time.Time) (string, int, string) {
	conn, err := net.DialTimeout("tcp", target, timeout)
	elapsed := int(time.Since(start).Milliseconds())
	if err != nil {
		return "critical", elapsed, err.Error()
	}
	conn.Close()
	return "ok", elapsed, "tcp connection ok"
}

func checkDNS(target string, timeout time.Duration, start time.Time) (string, int, string) {
	resolver := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return net.DialTimeout("udp", "8.8.8.8:53", timeout)
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	addrs, err := resolver.LookupHost(ctx, target)
	elapsed := int(time.Since(start).Milliseconds())
	if err != nil {
		return "critical", elapsed, err.Error()
	}
	return "ok", elapsed, fmt.Sprintf("resolved %d addresses", len(addrs))
}

// handleServiceCheckAlert creates or resolves alerts on state transitions.
func handleServiceCheckAlert(ctx context.Context, pool *pgxpool.Pool, checkID, assetID int, checkName, newStatus string) {
	// Get previous status.
	var prevStatus string
	err := pool.QueryRow(ctx,
		`SELECT status FROM service_check_results
		 WHERE check_id = $1
		 ORDER BY checked_at DESC OFFSET 1 LIMIT 1`, checkID,
	).Scan(&prevStatus)
	if err != nil {
		// No previous result — nothing to compare.
		return
	}

	if prevStatus == newStatus {
		return // no change
	}

	if newStatus == "critical" && prevStatus != "critical" {
		// Create alert.
		title := fmt.Sprintf("[critical] 서비스 체크 실패: %s", checkName)
		message := fmt.Sprintf("서비스 체크 '%s' (ID %d)가 critical 상태로 전환되었습니다.", checkName, checkID)
		pool.Exec(ctx,
			`INSERT INTO alerts (asset_id, severity, title, message, source, status)
			 VALUES ($1, 'critical', $2, $3, 'service_check', 'active')`,
			assetID, title, message)
		slog.Info("service check alert 생성", "check_id", checkID, "asset_id", assetID)
	} else if newStatus == "ok" && prevStatus == "critical" {
		// Resolve existing active alert.
		pool.Exec(ctx,
			`UPDATE alerts SET status = 'resolved', resolved_at = now()
			 WHERE asset_id = $1 AND source = 'service_check' AND status = 'active'
			   AND title LIKE '%' || $2 || '%'`,
			assetID, checkName)
		slog.Info("service check alert 해결", "check_id", checkID, "asset_id", assetID)
	}
}
