package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runAlertEvaluation evaluates all active alert rules against the latest
// metric data, fires new alerts and auto-resolves recovered ones.
func runAlertEvaluation(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	// ── Fetch cooldown from system_settings ────────────────────────
	cooldownS := 300
	var cooldownVal string
	if err := pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'alert_cooldown_s'`,
	).Scan(&cooldownVal); err == nil {
		if v := atoi(cooldownVal); v > 0 {
			cooldownS = v
		}
	}

	// ── Load all active rules ──────────────────────────────────────
	rows, err := pool.Query(ctx,
		`SELECT id, name, asset_id, group_tag, metric, operator, threshold,
		        duration_s, severity
		 FROM alert_rules WHERE is_active = true`)
	if err != nil {
		return fmt.Errorf("alert_rules query: %w", err)
	}
	defer rows.Close()

	type rule struct {
		ID        int
		Name      string
		AssetID   *int
		GroupTag  *string
		Metric    string
		Operator  string
		Threshold float64
		DurationS int
		Severity  string
	}

	var rules []rule
	for rows.Next() {
		var r rule
		if err := rows.Scan(&r.ID, &r.Name, &r.AssetID, &r.GroupTag,
			&r.Metric, &r.Operator, &r.Threshold,
			&r.DurationS, &r.Severity); err != nil {
			slog.Warn("alert rule scan 실패", "error", err)
			continue
		}
		rules = append(rules, r)
	}
	rows.Close()

	for _, r := range rules {
		if err := evaluateRule(ctx, pool, r.ID, r.Name, r.AssetID, r.GroupTag,
			r.Metric, r.Operator, r.Threshold, r.DurationS, r.Severity, cooldownS); err != nil {
			slog.Warn("rule 평가 실패", "rule_id", r.ID, "error", err)
		}
	}

	return nil
}

// evaluateRule checks a single alert rule against matching assets.
func evaluateRule(
	ctx context.Context, pool *pgxpool.Pool,
	ruleID int, ruleName string,
	assetID *int, groupTag *string,
	metric, operator string, threshold float64,
	durationS int, severity string, cooldownS int,
) error {
	// Build asset list for this rule.
	var assetIDs []int
	if assetID != nil {
		assetIDs = append(assetIDs, *assetID)
	} else {
		query := `SELECT id FROM assets WHERE is_active = true AND status != 'decommissioned'`
		args := []interface{}{}
		if groupTag != nil && *groupTag != "" {
			query += ` AND group_tag = $1`
			args = append(args, *groupTag)
		}
		aRows, err := pool.Query(ctx, query, args...)
		if err != nil {
			return fmt.Errorf("asset query: %w", err)
		}
		defer aRows.Close()
		for aRows.Next() {
			var id int
			if err := aRows.Scan(&id); err == nil {
				assetIDs = append(assetIDs, id)
			}
		}
		aRows.Close()
	}

	// Map metric name to column in the metrics table.
	col, ok := metricColumn(metric)
	if !ok {
		return fmt.Errorf("unknown metric %q", metric)
	}

	sinceTime := time.Now().Add(-time.Duration(durationS) * time.Second)

	for _, aid := range assetIDs {
		// Check whether all samples in the duration window exceed the threshold.
		q := fmt.Sprintf(
			`SELECT count(*) AS total,
			        count(*) FILTER (WHERE %s %s $1) AS breaching
			 FROM metrics
			 WHERE asset_id = $2 AND collected_at >= $3`,
			col, operator)

		var total, breaching int
		if err := pool.QueryRow(ctx, q, threshold, aid, sinceTime).Scan(&total, &breaching); err != nil {
			slog.Warn("metric check 실패", "asset_id", aid, "error", err)
			continue
		}

		triggered := total > 0 && total == breaching

		// Check for an existing active alert for this rule+asset.
		var existingID int64
		err := pool.QueryRow(ctx,
			`SELECT id FROM alerts
			 WHERE rule_id = $1 AND asset_id = $2 AND status = 'active'
			 LIMIT 1`, ruleID, aid,
		).Scan(&existingID)
		hasActive := err == nil

		if triggered && !hasActive {
			// Check cooldown: don't re-fire if a recent resolved alert exists.
			var lastResolved time.Time
			err := pool.QueryRow(ctx,
				`SELECT resolved_at FROM alerts
				 WHERE rule_id = $1 AND asset_id = $2 AND status = 'resolved'
				 ORDER BY resolved_at DESC LIMIT 1`, ruleID, aid,
			).Scan(&lastResolved)
			if err == nil && time.Since(lastResolved) < time.Duration(cooldownS)*time.Second {
				continue
			}

			title := fmt.Sprintf("[%s] %s", severity, ruleName)
			message := fmt.Sprintf("자산 ID %d: %s %s %.2f (임계값 %.2f, %ds 지속)",
				aid, metric, operator, 0.0, threshold, durationS)

			_, err = pool.Exec(ctx,
				`INSERT INTO alerts (rule_id, asset_id, severity, title, message, source, status)
				 VALUES ($1, $2, $3, $4, $5, 'threshold', 'active')`,
				ruleID, aid, severity, title, message)
			if err != nil {
				slog.Warn("alert INSERT 실패", "rule_id", ruleID, "asset_id", aid, "error", err)
			} else {
				slog.Info("alert 발생", "rule_id", ruleID, "asset_id", aid, "severity", severity)
			}
		} else if !triggered && hasActive {
			// Auto-resolve
			_, err := pool.Exec(ctx,
				`UPDATE alerts SET status = 'resolved', resolved_at = now()
				 WHERE id = $1`, existingID)
			if err != nil {
				slog.Warn("alert resolve 실패", "alert_id", existingID, "error", err)
			} else {
				slog.Info("alert 자동 해결", "alert_id", existingID, "rule_id", ruleID, "asset_id", aid)
			}
		}
	}

	return nil
}

// metricColumn maps a rule's metric name to the corresponding column in the
// metrics table.
func metricColumn(metric string) (string, bool) {
	m := map[string]string{
		"cpu_usage":     "cpu_usage",
		"mem_usage":     "mem_usage",
		"disk_usage":    "disk_usage_pct",
		"disk_read":     "disk_read_bps",
		"disk_write":    "disk_write_bps",
		"net_rx":        "net_rx_bps",
		"net_tx":        "net_tx_bps",
		"load_avg":      "load_avg_1m",
		"process_count": "process_count",
	}
	col, ok := m[metric]
	return col, ok
}
