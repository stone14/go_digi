package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Reports struct {
	pool *pgxpool.Pool
}

func NewReports(pool *pgxpool.Pool) *Reports {
	return &Reports{pool: pool}
}

// Generate는 종합 리포트를 생성합니다.
func (h *Reports) Generate(c echo.Context) error {
	rangeParam := c.QueryParam("range")
	if rangeParam == "" {
		rangeParam = "7d"
	}

	var interval string
	switch rangeParam {
	case "7d":
		interval = "7 days"
	case "30d":
		interval = "30 days"
	case "90d":
		interval = "90 days"
	default:
		interval = "7 days"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second)
	defer cancel()

	report := map[string]interface{}{}

	// --- Asset summary ---
	type assetSummary struct {
		Total   int            `json:"total"`
		ByType  map[string]int `json:"by_type"`
		Online  int            `json:"online"`
		Offline int            `json:"offline"`
	}
	as := assetSummary{ByType: map[string]int{}}
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM assets WHERE is_active = true`).Scan(&as.Total)
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM assets WHERE is_active = true AND status = 'online'`).Scan(&as.Online)
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM assets WHERE is_active = true AND status = 'offline'`).Scan(&as.Offline)

	typeRows, err := h.pool.Query(ctx,
		`SELECT type, count(*) FROM assets WHERE is_active = true GROUP BY type`)
	if err == nil {
		defer typeRows.Close()
		for typeRows.Next() {
			var t string
			var cnt int
			typeRows.Scan(&t, &cnt)
			as.ByType[t] = cnt
		}
	}
	report["assets"] = as

	// --- Alert stats ---
	type alertStats struct {
		BySeverity map[string]int `json:"by_severity"`
		Resolved   int            `json:"resolved"`
		Unresolved int            `json:"unresolved"`
	}
	als := alertStats{BySeverity: map[string]int{}}
	sevRows, err := h.pool.Query(ctx,
		`SELECT severity, count(*) FROM alerts WHERE fired_at >= now() - $1::interval GROUP BY severity`,
		interval)
	if err == nil {
		defer sevRows.Close()
		for sevRows.Next() {
			var sev string
			var cnt int
			sevRows.Scan(&sev, &cnt)
			als.BySeverity[sev] = cnt
		}
	}
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM alerts WHERE fired_at >= now() - $1::interval AND status = 'resolved'`,
		interval).Scan(&als.Resolved)
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM alerts WHERE fired_at >= now() - $1::interval AND status != 'resolved'`,
		interval).Scan(&als.Unresolved)
	report["alerts"] = als

	// --- Top 5 by CPU ---
	report["top_cpu"] = h.topMetric(ctx, interval, "cpu_percent", 5)

	// --- Top 5 by Memory ---
	report["top_mem"] = h.topMetric(ctx, interval, "mem_percent", 5)

	// --- Top 5 by Disk ---
	report["top_disk"] = h.topMetric(ctx, interval, "disk_percent", 5)

	// --- Incident summary ---
	type incidentSummary struct {
		Total    int            `json:"total"`
		ByStatus map[string]int `json:"by_status"`
	}
	is := incidentSummary{ByStatus: map[string]int{}}
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM incidents WHERE created_at >= now() - $1::interval`,
		interval).Scan(&is.Total)
	isRows, err := h.pool.Query(ctx,
		`SELECT status, count(*) FROM incidents WHERE created_at >= now() - $1::interval GROUP BY status`,
		interval)
	if err == nil {
		defer isRows.Close()
		for isRows.Next() {
			var st string
			var cnt int
			isRows.Scan(&st, &cnt)
			is.ByStatus[st] = cnt
		}
	}
	report["incidents"] = is

	// --- Service check summary ---
	type scSummary struct {
		Up   int `json:"up"`
		Down int `json:"down"`
	}
	sc := scSummary{}
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM service_checks sc
		 JOIN LATERAL (
		     SELECT status FROM service_check_results
		     WHERE check_id = sc.id ORDER BY checked_at DESC LIMIT 1
		 ) r ON true
		 WHERE sc.is_active = true AND r.status = 'ok'`).Scan(&sc.Up)
	h.pool.QueryRow(ctx,
		`SELECT count(*) FROM service_checks sc
		 JOIN LATERAL (
		     SELECT status FROM service_check_results
		     WHERE check_id = sc.id ORDER BY checked_at DESC LIMIT 1
		 ) r ON true
		 WHERE sc.is_active = true AND r.status = 'critical'`).Scan(&sc.Down)
	report["service_checks"] = sc

	report["generated_at"] = time.Now().UTC()

	return c.JSON(http.StatusOK, map[string]interface{}{"report": report})
}

func (h *Reports) topMetric(ctx context.Context, interval, metric string, limit int) []map[string]interface{} {
	rows, err := h.pool.Query(ctx,
		`SELECT m.asset_id, a.name, avg(m.value) AS avg_val
		 FROM metrics_1h m
		 JOIN assets a ON a.id = m.asset_id
		 WHERE m.metric = $1 AND m.bucket >= now() - $2::interval
		 GROUP BY m.asset_id, a.name
		 ORDER BY avg_val DESC
		 LIMIT $3`, metric, interval, limit)
	if err != nil {
		return []map[string]interface{}{}
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var assetID int
		var name string
		var avgVal float64
		rows.Scan(&assetID, &name, &avgVal)
		result = append(result, map[string]interface{}{
			"asset_id": assetID,
			"name":     name,
			"avg":      avgVal,
		})
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	return result
}

// ListDefinitions는 리포트 정의 목록을 조회합니다.
func (h *Reports) ListDefinitions(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, name, type, schedule, config, is_active, created_at, updated_at
		 FROM report_definitions
		 ORDER BY created_at DESC`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type defRow struct {
		ID        int              `json:"id"`
		Name      string           `json:"name"`
		Type      string           `json:"type"`
		Schedule  *string          `json:"schedule"`
		Config    *json.RawMessage `json:"config"`
		IsActive  bool             `json:"is_active"`
		CreatedAt time.Time        `json:"created_at"`
		UpdatedAt time.Time        `json:"updated_at"`
	}

	var defs []defRow
	for rows.Next() {
		var d defRow
		rows.Scan(&d.ID, &d.Name, &d.Type, &d.Schedule, &d.Config, &d.IsActive,
			&d.CreatedAt, &d.UpdatedAt)
		defs = append(defs, d)
	}
	if defs == nil {
		defs = []defRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"definitions": defs})
}

// CreateDefinition는 새 리포트 정의를 생성합니다.
func (h *Reports) CreateDefinition(c echo.Context) error {
	var req struct {
		Name     string           `json:"name"`
		Type     string           `json:"type"`
		Schedule string           `json:"schedule"`
		Config   *json.RawMessage `json:"config"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name은 필수입니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO report_definitions (name, type, schedule, config)
		 VALUES ($1, $2, NULLIF($3,''), $4) RETURNING id`,
		req.Name, req.Type, req.Schedule, req.Config,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}
