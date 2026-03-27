package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runOfflineCheck marks assets as offline when they haven't reported within
// the configured threshold, and creates warning alerts for newly offline assets.
func runOfflineCheck(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Read threshold from system_settings (default 300s = 5 min).
	thresholdS := 300
	var val string
	if err := pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'agent_check_interval'`,
	).Scan(&val); err == nil {
		if v := atoi(val); v > 0 {
			thresholdS = v * 60 // stored as minutes
		}
	}

	cutoff := time.Now().Add(-time.Duration(thresholdS) * time.Second)

	// Find assets that should be marked offline.
	rows, err := pool.Query(ctx,
		`SELECT id, name FROM assets
		 WHERE status = 'online'
		   AND last_seen IS NOT NULL
		   AND last_seen < $1
		   AND is_active = true`, cutoff)
	if err != nil {
		return fmt.Errorf("offline check query: %w", err)
	}
	defer rows.Close()

	type offlineAsset struct {
		ID   int
		Name string
	}

	var targets []offlineAsset
	for rows.Next() {
		var a offlineAsset
		if err := rows.Scan(&a.ID, &a.Name); err != nil {
			slog.Warn("offline check scan 실패", "error", err)
			continue
		}
		targets = append(targets, a)
	}
	rows.Close()

	for _, a := range targets {
		// Update status
		_, err := pool.Exec(ctx,
			`UPDATE assets SET status = 'offline' WHERE id = $1`, a.ID)
		if err != nil {
			slog.Warn("offline status 업데이트 실패", "asset_id", a.ID, "error", err)
			continue
		}

		// Only create alert if there isn't already an active offline alert for this asset.
		var existing int
		pool.QueryRow(ctx,
			`SELECT count(*) FROM alerts
			 WHERE asset_id = $1 AND source = 'offline_check' AND status = 'active'`, a.ID,
		).Scan(&existing)

		if existing == 0 {
			title := fmt.Sprintf("[warning] %s 오프라인 감지", a.Name)
			message := fmt.Sprintf("자산 '%s' (ID %d)이 %d초 동안 응답이 없어 오프라인으로 전환되었습니다.",
				a.Name, a.ID, thresholdS)

			_, err := pool.Exec(ctx,
				`INSERT INTO alerts (asset_id, severity, title, message, source, status)
				 VALUES ($1, 'warning', $2, $3, 'offline_check', 'active')`,
				a.ID, title, message)
			if err != nil {
				slog.Warn("offline alert 생성 실패", "asset_id", a.ID, "error", err)
			} else {
				slog.Info("offline alert 생성", "asset_id", a.ID, "name", a.Name)
			}
		}
	}

	if len(targets) > 0 {
		slog.Info("offline check 완료", "offline_count", len(targets))
	}

	return nil
}
