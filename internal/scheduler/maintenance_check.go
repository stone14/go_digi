package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runMaintenanceCheck finds maintenance contracts expiring within the next 30
// days and creates warning alerts for those not already alerted.
func runMaintenanceCheck(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT mc.id, mc.asset_id, mc.vendor, mc.contract_end, a.name
		 FROM maintenance_contracts mc
		 JOIN assets a ON a.id = mc.asset_id
		 WHERE mc.has_contract = true
		   AND mc.is_active = true
		   AND mc.contract_end BETWEEN now()::date AND (now() + interval '30 days')::date`)
	if err != nil {
		return fmt.Errorf("maintenance query: %w", err)
	}
	defer rows.Close()

	type contract struct {
		ID          int
		AssetID     int
		Vendor      *string
		ContractEnd time.Time
		AssetName   string
	}

	var contracts []contract
	for rows.Next() {
		var c contract
		if err := rows.Scan(&c.ID, &c.AssetID, &c.Vendor, &c.ContractEnd, &c.AssetName); err != nil {
			slog.Warn("maintenance scan 실패", "error", err)
			continue
		}
		contracts = append(contracts, c)
	}
	rows.Close()

	for _, c := range contracts {
		// Check if an alert already exists for this contract.
		var existing int
		pool.QueryRow(ctx,
			`SELECT count(*) FROM alerts
			 WHERE asset_id = $1
			   AND source = 'maintenance_check'
			   AND status IN ('active', 'acked')
			   AND title LIKE '%유지보수%' || '%' || $2 || '%'`,
			c.AssetID, c.AssetName,
		).Scan(&existing)

		if existing > 0 {
			continue
		}

		daysLeft := int(time.Until(c.ContractEnd).Hours() / 24)
		vendor := "N/A"
		if c.Vendor != nil {
			vendor = *c.Vendor
		}

		title := fmt.Sprintf("[warning] 유지보수 계약 만료 임박: %s", c.AssetName)
		message := fmt.Sprintf("자산 '%s' (ID %d)의 유지보수 계약이 %d일 후 만료됩니다. (만료일: %s, 업체: %s)",
			c.AssetName, c.AssetID, daysLeft,
			c.ContractEnd.Format("2006-01-02"), vendor)

		_, err := pool.Exec(ctx,
			`INSERT INTO alerts (asset_id, severity, title, message, source, status)
			 VALUES ($1, 'warning', $2, $3, 'maintenance_check', 'active')`,
			c.AssetID, title, message)
		if err != nil {
			slog.Warn("maintenance alert 생성 실패", "asset_id", c.AssetID, "error", err)
		} else {
			slog.Info("maintenance alert 생성", "asset_id", c.AssetID, "days_left", daysLeft)
		}
	}

	return nil
}
