package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Alerts struct {
	pool *pgxpool.Pool
}

func NewAlerts(pool *pgxpool.Pool) *Alerts {
	return &Alerts{pool: pool}
}

// List는 알림 목록을 조회합니다.
func (h *Alerts) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// 카운트만 요청
	if c.QueryParam("count") == "true" {
		var count int
		status := c.QueryParam("status")
		if status == "" || status == "active" {
			h.pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE status = 'active'`).Scan(&count)
		} else {
			h.pool.QueryRow(ctx, `SELECT count(*) FROM alerts`).Scan(&count)
		}
		return c.JSON(http.StatusOK, map[string]int{"count": count})
	}

	status := c.QueryParam("status")
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	severity := c.QueryParam("severity")
	search := c.QueryParam("search")
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset, _ := strconv.Atoi(c.QueryParam("offset"))

	query := `SELECT al.id, al.rule_id, al.asset_id, al.severity, al.title, al.message,
	                 al.source, al.status, al.fired_at, al.resolved_at, al.acked_at,
	                 a.name AS asset_name
	          FROM alerts al
	          LEFT JOIN assets a ON a.id = al.asset_id
	          WHERE 1=1`
	args := []interface{}{}
	idx := 1

	if status != "" && status != "all" {
		if status == "acknowledged" {
			status = "acked"
		}
		query += fmt.Sprintf(` AND al.status = $%d`, idx)
		args = append(args, status)
		idx++
	}
	if assetID > 0 {
		query += fmt.Sprintf(` AND al.asset_id = $%d`, idx)
		args = append(args, assetID)
		idx++
	}
	if severity != "" {
		query += fmt.Sprintf(` AND al.severity = $%d`, idx)
		args = append(args, severity)
		idx++
	}
	if search != "" {
		query += fmt.Sprintf(` AND (al.title ILIKE $%d OR al.message ILIKE $%d)`, idx, idx)
		args = append(args, "%"+search+"%")
		idx++
	}

	query += fmt.Sprintf(` ORDER BY al.fired_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type alertRow struct {
		ID         int64      `json:"id"`
		RuleID     *int       `json:"rule_id"`
		AssetID    *int       `json:"asset_id"`
		Severity   string     `json:"severity"`
		Title      string     `json:"title"`
		Message    *string    `json:"message"`
		Source     string     `json:"source"`
		Status     string     `json:"status"`
		FiredAt    time.Time  `json:"fired_at"`
		ResolvedAt *time.Time `json:"resolved_at"`
		AckedAt    *time.Time `json:"acked_at"`
		AssetName  *string    `json:"asset_name"`
	}

	var alerts []alertRow
	for rows.Next() {
		var a alertRow
		rows.Scan(&a.ID, &a.RuleID, &a.AssetID, &a.Severity, &a.Title, &a.Message,
			&a.Source, &a.Status, &a.FiredAt, &a.ResolvedAt, &a.AckedAt, &a.AssetName)
		// DB 'acked' → UI 'acknowledged'
		if a.Status == "acked" {
			a.Status = "acknowledged"
		}
		alerts = append(alerts, a)
	}
	if alerts == nil {
		alerts = []alertRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"alerts": alerts})
}

// Action은 알림을 확인/해결합니다.
func (h *Alerts) Action(c echo.Context) error {
	var req struct {
		ID     int64  `json:"id"`
		Action string `json:"action"` // ack / resolve
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	switch req.Action {
	case "ack":
		h.pool.Exec(ctx, `UPDATE alerts SET status = 'acked', acked_at = now() WHERE id = $1`, req.ID)
	case "resolve":
		h.pool.Exec(ctx, `UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`, req.ID)
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "유효하지 않은 action"})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// --- Alert Rules ---

// ListRules는 알림 규칙을 조회합니다.
func (h *Alerts) ListRules(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, name, asset_id, group_tag, metric, operator, threshold,
		        duration_s, severity, notify_channels, is_active, created_at
		 FROM alert_rules ORDER BY created_at DESC`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type ruleRow struct {
		ID             int       `json:"id"`
		Name           string    `json:"name"`
		AssetID        *int      `json:"asset_id"`
		GroupTag       *string   `json:"group_tag"`
		Metric         string    `json:"metric"`
		Operator       string    `json:"operator"`
		Threshold      float64   `json:"threshold"`
		DurationS      int       `json:"duration_s"`
		Severity       string    `json:"severity"`
		NotifyChannels []string  `json:"notify_channels"`
		IsActive       bool      `json:"is_active"`
		CreatedAt      time.Time `json:"created_at"`
	}

	var rules []ruleRow
	for rows.Next() {
		var r ruleRow
		rows.Scan(&r.ID, &r.Name, &r.AssetID, &r.GroupTag, &r.Metric, &r.Operator,
			&r.Threshold, &r.DurationS, &r.Severity, &r.NotifyChannels, &r.IsActive, &r.CreatedAt)
		rules = append(rules, r)
	}
	if rules == nil {
		rules = []ruleRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"rules": rules})
}

// CreateRule은 새 알림 규칙을 생성합니다.
func (h *Alerts) CreateRule(c echo.Context) error {
	var req struct {
		Name           string   `json:"name"`
		AssetID        *int     `json:"asset_id"`
		GroupTag       string   `json:"group_tag"`
		Metric         string   `json:"metric"`
		Operator       string   `json:"operator"`
		Threshold      float64  `json:"threshold"`
		DurationS      int      `json:"duration_s"`
		Severity       string   `json:"severity"`
		NotifyChannels []string `json:"notify_channels"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.DurationS == 0 {
		req.DurationS = 60
	}
	if req.Severity == "" {
		req.Severity = "warning"
	}
	if req.NotifyChannels == nil {
		req.NotifyChannels = []string{"slack"}
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO alert_rules (name, asset_id, group_tag, metric, operator, threshold,
		        duration_s, severity, notify_channels)
		 VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9) RETURNING id`,
		req.Name, req.AssetID, req.GroupTag, req.Metric, req.Operator, req.Threshold,
		req.DurationS, req.Severity, req.NotifyChannels,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}
