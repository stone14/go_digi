package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runAggregation rolls up raw metrics into metrics_5m and metrics_5m into
// metrics_1h.
func runAggregation(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	if err := aggregate5m(ctx, pool); err != nil {
		slog.Warn("5m aggregation 실패", "error", err)
	}

	if err := aggregate1h(ctx, pool); err != nil {
		slog.Warn("1h aggregation 실패", "error", err)
	}

	return nil
}

// aggregate5m inserts 5-minute buckets from raw metrics.
func aggregate5m(ctx context.Context, pool *pgxpool.Pool) error {
	tag, err := pool.Exec(ctx, `
		INSERT INTO metrics_5m
			(asset_id, bucket, cpu_avg, cpu_max, mem_avg, mem_max,
			 disk_read_avg, disk_write_avg, net_rx_avg, net_tx_avg, sample_count)
		SELECT
			asset_id,
			date_trunc('hour', collected_at)
				+ INTERVAL '5 min' * (EXTRACT(MINUTE FROM collected_at)::int / 5),
			avg(cpu_usage), max(cpu_usage),
			avg(mem_usage), max(mem_usage),
			avg(disk_read_bps), avg(disk_write_bps),
			avg(net_rx_bps), avg(net_tx_bps),
			count(*)
		FROM metrics
		WHERE collected_at > (
			SELECT COALESCE(max(bucket), now() - interval '1 hour') FROM metrics_5m
		)
		GROUP BY 1, 2
		ON CONFLICT (asset_id, bucket) DO NOTHING`)
	if err != nil {
		return fmt.Errorf("metrics_5m insert: %w", err)
	}

	if tag.RowsAffected() > 0 {
		slog.Info("5m aggregation 완료", "rows", tag.RowsAffected())
	}

	return nil
}

// aggregate1h inserts 1-hour buckets from 5-minute aggregates.
func aggregate1h(ctx context.Context, pool *pgxpool.Pool) error {
	tag, err := pool.Exec(ctx, `
		INSERT INTO metrics_1h
			(asset_id, bucket, cpu_avg, cpu_max, mem_avg, mem_max,
			 disk_read_avg, disk_write_avg, net_rx_avg, net_tx_avg, sample_count)
		SELECT
			asset_id,
			date_trunc('hour', bucket),
			avg(cpu_avg), max(cpu_max),
			avg(mem_avg), max(mem_max),
			avg(disk_read_avg), avg(disk_write_avg),
			avg(net_rx_avg), avg(net_tx_avg),
			sum(sample_count)
		FROM metrics_5m
		WHERE bucket > (
			SELECT COALESCE(max(bucket), now() - interval '1 day') FROM metrics_1h
		)
		GROUP BY 1, 2
		ON CONFLICT (asset_id, bucket) DO NOTHING`)
	if err != nil {
		return fmt.Errorf("metrics_1h insert: %w", err)
	}

	if tag.RowsAffected() > 0 {
		slog.Info("1h aggregation 완료", "rows", tag.RowsAffected())
	}

	return nil
}
