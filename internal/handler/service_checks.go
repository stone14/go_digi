package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type ServiceChecks struct {
	pool *pgxpool.Pool
}

func NewServiceChecks(pool *pgxpool.Pool) *ServiceChecks {
	return &ServiceChecks{pool: pool}
}

// List는 서비스 체크 목록을 조회합니다.
func (h *ServiceChecks) List(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	query := `SELECT sc.id, sc.asset_id, sc.name, sc.type, sc.target,
	                 sc.timeout_s, sc.expected_code, sc.expected_body, sc.is_active,
	                 r.status, r.response_ms, r.checked_at
	          FROM service_checks sc
	          LEFT JOIN LATERAL (
	            SELECT status, response_ms, checked_at
	            FROM service_check_results
	            WHERE check_id = sc.id ORDER BY checked_at DESC LIMIT 1
	          ) r ON true
	          WHERE sc.is_active = true`

	args := []interface{}{}
	if assetID > 0 {
		query += ` AND sc.asset_id = $1`
		args = append(args, assetID)
	}
	query += ` ORDER BY sc.created_at DESC`

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type checkRow struct {
		ID           int        `json:"id"`
		AssetID      int        `json:"asset_id"`
		Name         string     `json:"name"`
		Type         string     `json:"type"`
		Target       string     `json:"target"`
		TimeoutS     int        `json:"timeout_s"`
		ExpectedCode *int       `json:"expected_code"`
		ExpectedBody *string    `json:"expected_body"`
		IsActive     bool       `json:"is_active"`
		Status       *string    `json:"status"`
		ResponseMs   *int       `json:"response_ms"`
		CheckedAt    *time.Time `json:"checked_at"`
	}

	var checks []checkRow
	for rows.Next() {
		var ch checkRow
		rows.Scan(&ch.ID, &ch.AssetID, &ch.Name, &ch.Type, &ch.Target,
			&ch.TimeoutS, &ch.ExpectedCode, &ch.ExpectedBody, &ch.IsActive,
			&ch.Status, &ch.ResponseMs, &ch.CheckedAt)
		// UI 매핑: ok→up, critical→down
		if ch.Status != nil {
			switch *ch.Status {
			case "ok":
				s := "up"
				ch.Status = &s
			case "critical":
				s := "down"
				ch.Status = &s
			}
		}
		checks = append(checks, ch)
	}
	if checks == nil {
		checks = []checkRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"checks": checks})
}

// Create는 새 서비스 체크를 생성합니다.
func (h *ServiceChecks) Create(c echo.Context) error {
	var req struct {
		AssetID      int    `json:"asset_id"`
		Name         string `json:"name"`
		Type         string `json:"type"`
		Target       string `json:"target"`
		TimeoutS     int    `json:"timeout_s"`
		ExpectedCode *int   `json:"expected_code"`
		ExpectedBody string `json:"expected_body"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.TimeoutS == 0 {
		req.TimeoutS = 5
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO service_checks (asset_id, name, type, target, timeout_s, expected_code, expected_body)
		 VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,'')) RETURNING id`,
		req.AssetID, req.Name, req.Type, req.Target, req.TimeoutS, req.ExpectedCode, req.ExpectedBody,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// Delete는 서비스 체크를 비활성화합니다.
func (h *ServiceChecks) Delete(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `UPDATE service_checks SET is_active = false WHERE id = $1`, id)
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}
