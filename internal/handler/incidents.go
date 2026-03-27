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

type Incidents struct {
	pool *pgxpool.Pool
}

func NewIncidents(pool *pgxpool.Pool) *Incidents {
	return &Incidents{pool: pool}
}

// List는 인시던트 목록을 조회합니다.
func (h *Incidents) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	status := c.QueryParam("status")
	severity := c.QueryParam("severity")
	search := c.QueryParam("search")
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset, _ := strconv.Atoi(c.QueryParam("offset"))

	query := `SELECT i.id, i.title, i.severity, i.status, i.description,
	                 i.assigned_to, u.name AS assigned_name,
	                 i.root_cause, i.resolution,
	                 i.created_at, i.updated_at, i.resolved_at
	          FROM incidents i
	          LEFT JOIN users u ON u.id = i.assigned_to
	          WHERE 1=1`
	args := []interface{}{}
	idx := 1

	if status != "" && status != "all" {
		query += fmt.Sprintf(` AND i.status = $%d`, idx)
		args = append(args, status)
		idx++
	}
	if severity != "" {
		query += fmt.Sprintf(` AND i.severity = $%d`, idx)
		args = append(args, severity)
		idx++
	}
	if search != "" {
		query += fmt.Sprintf(` AND (i.title ILIKE $%d OR i.description ILIKE $%d)`, idx, idx)
		args = append(args, "%"+search+"%")
		idx++
	}

	query += fmt.Sprintf(` ORDER BY i.created_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type incidentRow struct {
		ID           int64      `json:"id"`
		Title        string     `json:"title"`
		Severity     string     `json:"severity"`
		Status       string     `json:"status"`
		Description  *string    `json:"description"`
		AssignedTo   *int       `json:"assigned_to"`
		AssignedName *string    `json:"assigned_name"`
		RootCause    *string    `json:"root_cause"`
		Resolution   *string    `json:"resolution"`
		CreatedAt    time.Time  `json:"created_at"`
		UpdatedAt    time.Time  `json:"updated_at"`
		ResolvedAt   *time.Time `json:"resolved_at"`
	}

	var incidents []incidentRow
	for rows.Next() {
		var i incidentRow
		rows.Scan(&i.ID, &i.Title, &i.Severity, &i.Status, &i.Description,
			&i.AssignedTo, &i.AssignedName,
			&i.RootCause, &i.Resolution,
			&i.CreatedAt, &i.UpdatedAt, &i.ResolvedAt)
		incidents = append(incidents, i)
	}
	if incidents == nil {
		incidents = []incidentRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"incidents": incidents})
}

// Create는 새 인시던트를 생성합니다.
func (h *Incidents) Create(c echo.Context) error {
	var req struct {
		Title       string `json:"title"`
		Severity    string `json:"severity"`
		Description string `json:"description"`
		AssetIDs    []int  `json:"asset_ids"`
		AlertIDs    []int  `json:"alert_ids"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Title == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "title은 필수입니다"})
	}
	if req.Severity == "" {
		req.Severity = "warning"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int64
	err := h.pool.QueryRow(ctx,
		`INSERT INTO incidents (title, severity, description, asset_ids, alert_ids)
		 VALUES ($1, $2, NULLIF($3,''), $4, $5) RETURNING id`,
		req.Title, req.Severity, req.Description, req.AssetIDs, req.AlertIDs,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// 타임라인 항목 추가 (생성)
	h.pool.Exec(ctx,
		`INSERT INTO incident_timeline (incident_id, entry_type, content)
		 VALUES ($1, 'created', $2)`,
		id, fmt.Sprintf("인시던트 생성: %s", req.Title))

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// Update는 인시던트를 갱신합니다.
func (h *Incidents) Update(c echo.Context) error {
	var req struct {
		ID         int64  `json:"id"`
		Action     string `json:"action"`
		AssignedTo *int   `json:"assigned_to"`
		Comment    string `json:"comment"`
		Status     string `json:"status"`
		RootCause  string `json:"root_cause"`
		Resolution string `json:"resolution"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	switch req.Action {
	case "assign":
		h.pool.Exec(ctx,
			`UPDATE incidents SET assigned_to = $1, updated_at = now() WHERE id = $2`,
			req.AssignedTo, req.ID)
		h.pool.Exec(ctx,
			`INSERT INTO incident_timeline (incident_id, entry_type, content)
			 VALUES ($1, 'assigned', $2)`,
			req.ID, fmt.Sprintf("담당자 변경: user_id=%v", req.AssignedTo))

	case "comment":
		h.pool.Exec(ctx,
			`INSERT INTO incident_timeline (incident_id, entry_type, content)
			 VALUES ($1, 'comment', $2)`,
			req.ID, req.Comment)

	case "update_status":
		h.pool.Exec(ctx,
			`UPDATE incidents SET status = $1, updated_at = now() WHERE id = $2`,
			req.Status, req.ID)
		if req.Status == "resolved" || req.Status == "closed" {
			h.pool.Exec(ctx,
				`UPDATE incidents SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL`,
				req.ID)
		}
		h.pool.Exec(ctx,
			`INSERT INTO incident_timeline (incident_id, entry_type, content)
			 VALUES ($1, 'status_change', $2)`,
			req.ID, fmt.Sprintf("상태 변경: %s", req.Status))

	case "set_root_cause":
		h.pool.Exec(ctx,
			`UPDATE incidents SET root_cause = $1, updated_at = now() WHERE id = $2`,
			req.RootCause, req.ID)
		h.pool.Exec(ctx,
			`INSERT INTO incident_timeline (incident_id, entry_type, content)
			 VALUES ($1, 'root_cause', $2)`,
			req.ID, req.RootCause)

	case "set_resolution":
		h.pool.Exec(ctx,
			`UPDATE incidents SET resolution = $1, updated_at = now() WHERE id = $2`,
			req.Resolution, req.ID)
		h.pool.Exec(ctx,
			`INSERT INTO incident_timeline (incident_id, entry_type, content)
			 VALUES ($1, 'resolution', $2)`,
			req.ID, req.Resolution)

	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "유효하지 않은 action"})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Delete는 인시던트를 삭제합니다.
func (h *Incidents) Delete(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `DELETE FROM incident_timeline WHERE incident_id = $1`, id)
	h.pool.Exec(ctx, `DELETE FROM incidents WHERE id = $1`, id)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Timeline은 인시던트의 타임라인 항목을 조회합니다.
func (h *Incidents) Timeline(c echo.Context) error {
	incidentID, _ := strconv.Atoi(c.QueryParam("incident_id"))
	if incidentID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "incident_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, incident_id, entry_type, content, user_id, created_at
		 FROM incident_timeline
		 WHERE incident_id = $1
		 ORDER BY created_at ASC`, incidentID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type timelineRow struct {
		ID         int64     `json:"id"`
		IncidentID int64     `json:"incident_id"`
		EntryType  string    `json:"entry_type"`
		Content    *string   `json:"content"`
		UserID     *int      `json:"user_id"`
		CreatedAt  time.Time `json:"created_at"`
	}

	var entries []timelineRow
	for rows.Next() {
		var e timelineRow
		rows.Scan(&e.ID, &e.IncidentID, &e.EntryType, &e.Content, &e.UserID, &e.CreatedAt)
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []timelineRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"timeline": entries})
}
