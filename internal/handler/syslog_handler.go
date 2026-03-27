package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type SyslogHandler struct {
	pool *pgxpool.Pool
}

func NewSyslogHandler(pool *pgxpool.Pool) *SyslogHandler {
	return &SyslogHandler{pool: pool}
}

// List returns syslog entries with optional filters.
func (h *SyslogHandler) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	offset, _ := strconv.Atoi(c.QueryParam("offset"))

	query := `SELECT id, asset_id, facility, severity, received_at, hostname, program,
	                 message, event_type, parsed_data
	          FROM syslog_entries WHERE 1=1`
	countQuery := `SELECT count(*) FROM syslog_entries WHERE 1=1`

	args := []interface{}{}
	countArgs := []interface{}{}
	idx := 1

	if assetID, _ := strconv.Atoi(c.QueryParam("asset_id")); assetID > 0 {
		filter := fmt.Sprintf(` AND asset_id = $%d`, idx)
		query += filter
		countQuery += filter
		args = append(args, assetID)
		countArgs = append(countArgs, assetID)
		idx++
	}

	if sev := c.QueryParam("severity"); sev != "" {
		sevInt, _ := strconv.Atoi(sev)
		filter := fmt.Sprintf(` AND severity <= $%d`, idx)
		query += filter
		countQuery += filter
		args = append(args, sevInt)
		countArgs = append(countArgs, sevInt)
		idx++
	}

	if et := c.QueryParam("event_type"); et != "" {
		filter := fmt.Sprintf(` AND event_type = $%d`, idx)
		query += filter
		countQuery += filter
		args = append(args, et)
		countArgs = append(countArgs, et)
		idx++
	}

	if since := c.QueryParam("since"); since != "" {
		if t, err := time.Parse(time.RFC3339, since); err == nil {
			filter := fmt.Sprintf(` AND received_at >= $%d`, idx)
			query += filter
			countQuery += filter
			args = append(args, t)
			countArgs = append(countArgs, t)
			idx++
		}
	}

	query += fmt.Sprintf(` ORDER BY received_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type entryRow struct {
		ID         int64           `json:"id"`
		AssetID    *int            `json:"asset_id"`
		Facility   int             `json:"facility"`
		Severity   int             `json:"severity"`
		ReceivedAt time.Time       `json:"received_at"`
		Hostname   string          `json:"hostname"`
		Program    *string         `json:"program"`
		Message    string          `json:"message"`
		EventType  *string         `json:"event_type"`
		ParsedData json.RawMessage `json:"parsed_data"`
	}

	var entries []entryRow
	for rows.Next() {
		var e entryRow
		if err := rows.Scan(&e.ID, &e.AssetID, &e.Facility, &e.Severity, &e.ReceivedAt,
			&e.Hostname, &e.Program, &e.Message, &e.EventType, &e.ParsedData); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []entryRow{}
	}

	var total int
	h.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"entries": entries,
		"total":   total,
	})
}

// GetPatterns returns all syslog parse patterns.
func (h *SyslogHandler) GetPatterns(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, name, pattern, event_type, extract_fields, is_active, created_at, updated_at
		 FROM syslog_parse_patterns ORDER BY id`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type patternRow struct {
		ID            int       `json:"id"`
		Name          string    `json:"name"`
		Pattern       string    `json:"pattern"`
		EventType     string    `json:"event_type"`
		ExtractFields *string   `json:"extract_fields"`
		IsActive      bool      `json:"is_active"`
		CreatedAt     time.Time `json:"created_at"`
		UpdatedAt     time.Time `json:"updated_at"`
	}

	var patterns []patternRow
	for rows.Next() {
		var p patternRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Pattern, &p.EventType,
			&p.ExtractFields, &p.IsActive, &p.CreatedAt, &p.UpdatedAt); err != nil {
			continue
		}
		patterns = append(patterns, p)
	}
	if patterns == nil {
		patterns = []patternRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"patterns": patterns})
}

// CreatePattern creates a new syslog parse pattern.
func (h *SyslogHandler) CreatePattern(c echo.Context) error {
	var req struct {
		Name          string `json:"name"`
		Pattern       string `json:"pattern"`
		EventType     string `json:"event_type"`
		ExtractFields string `json:"extract_fields"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if req.Name == "" || req.Pattern == "" || req.EventType == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name, pattern, and event_type are required"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO syslog_parse_patterns (name, pattern, event_type, extract_fields)
		 VALUES ($1, $2, $3, NULLIF($4, '')) RETURNING id`,
		req.Name, req.Pattern, req.EventType, req.ExtractFields,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// UpdatePattern updates an existing syslog parse pattern.
func (h *SyslogHandler) UpdatePattern(c echo.Context) error {
	var req struct {
		ID            int    `json:"id"`
		Name          string `json:"name"`
		Pattern       string `json:"pattern"`
		EventType     string `json:"event_type"`
		ExtractFields string `json:"extract_fields"`
		IsActive      *bool  `json:"is_active"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if req.ID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id is required"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	sets := []string{"updated_at = now()"}
	args := []interface{}{}
	idx := 1

	if req.Name != "" {
		sets = append(sets, fmt.Sprintf("name = $%d", idx))
		args = append(args, req.Name)
		idx++
	}
	if req.Pattern != "" {
		sets = append(sets, fmt.Sprintf("pattern = $%d", idx))
		args = append(args, req.Pattern)
		idx++
	}
	if req.EventType != "" {
		sets = append(sets, fmt.Sprintf("event_type = $%d", idx))
		args = append(args, req.EventType)
		idx++
	}
	if req.ExtractFields != "" {
		sets = append(sets, fmt.Sprintf("extract_fields = $%d", idx))
		args = append(args, req.ExtractFields)
		idx++
	}
	if req.IsActive != nil {
		sets = append(sets, fmt.Sprintf("is_active = $%d", idx))
		args = append(args, *req.IsActive)
		idx++
	}

	if len(args) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no fields to update"})
	}

	args = append(args, req.ID)
	query := fmt.Sprintf(`UPDATE syslog_parse_patterns SET %s WHERE id = $%d`,
		joinStrings(sets, ", "), idx)

	_, err := h.pool.Exec(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// DeletePattern deletes a syslog parse pattern by id.
func (h *SyslogHandler) DeletePattern(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id is required"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.pool.Exec(ctx, `DELETE FROM syslog_parse_patterns WHERE id = $1`, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Stats returns syslog aggregation by severity and event_type for the last 24h.
func (h *SyslogHandler) Stats(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	since := time.Now().Add(-24 * time.Hour)
	assetFilter := ""
	args := []interface{}{since}
	idx := 2

	if assetID, _ := strconv.Atoi(c.QueryParam("asset_id")); assetID > 0 {
		assetFilter = fmt.Sprintf(` AND asset_id = $%d`, idx)
		args = append(args, assetID)
	}

	// By severity
	sevRows, err := h.pool.Query(ctx,
		fmt.Sprintf(`SELECT severity, count(*) FROM syslog_entries
		 WHERE received_at >= $1%s GROUP BY severity ORDER BY severity`, assetFilter),
		args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer sevRows.Close()

	bySeverity := map[int]int64{}
	for sevRows.Next() {
		var sev int
		var cnt int64
		sevRows.Scan(&sev, &cnt)
		bySeverity[sev] = cnt
	}

	// By event_type
	etRows, err := h.pool.Query(ctx,
		fmt.Sprintf(`SELECT COALESCE(event_type, 'unknown'), count(*) FROM syslog_entries
		 WHERE received_at >= $1%s GROUP BY event_type ORDER BY count(*) DESC`, assetFilter),
		args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer etRows.Close()

	byEventType := map[string]int64{}
	for etRows.Next() {
		var et string
		var cnt int64
		etRows.Scan(&et, &cnt)
		byEventType[et] = cnt
	}

	// Total count
	var total int64
	h.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT count(*) FROM syslog_entries WHERE received_at >= $1%s`, assetFilter),
		args...).Scan(&total)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"stats": map[string]interface{}{
			"total":         total,
			"by_severity":   bySeverity,
			"by_event_type": byEventType,
			"since":         since,
		},
	})
}

// joinStrings joins a slice of strings with a separator.
func joinStrings(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}
