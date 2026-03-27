package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/stone14/go_digi/internal/auth"
)

type Audit struct {
	pool *pgxpool.Pool
}

func NewAudit(pool *pgxpool.Pool) *Audit {
	return &Audit{pool: pool}
}

// logAudit는 감사 로그를 기록합니다 (핸들러 내부에서 호출).
func logAudit(ctx context.Context, pool *pgxpool.Pool, userID int, action, targetType string, targetID int, detail interface{}, ip string) {
	var detailJSON []byte
	if detail != nil {
		detailJSON, _ = json.Marshal(detail)
	}
	pool.Exec(ctx,
		`INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip_address)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, action, targetType, targetID, detailJSON, ip)
}

// List는 감사 로그를 조회합니다.
func (h *Audit) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset, _ := strconv.Atoi(c.QueryParam("offset"))

	action := c.QueryParam("action")
	user := c.QueryParam("user")

	query := `SELECT a.id, a.user_id, u.username, a.action, a.target_type, a.target_id,
	                 a.detail, a.ip_address::text, a.occurred_at
	          FROM audit_logs a
	          LEFT JOIN users u ON u.id = a.user_id
	          WHERE 1=1`
	args := []interface{}{}
	idx := 1

	if action != "" {
		query += ` AND a.action = $` + strconv.Itoa(idx)
		args = append(args, action)
		idx++
	}
	if user != "" {
		query += ` AND u.username ILIKE $` + strconv.Itoa(idx)
		args = append(args, "%"+user+"%")
		idx++
	}

	query += ` ORDER BY a.occurred_at DESC LIMIT $` + strconv.Itoa(idx)
	args = append(args, limit)
	idx++
	query += ` OFFSET $` + strconv.Itoa(idx)
	args = append(args, offset)

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type logEntry struct {
		ID         int64           `json:"id"`
		UserID     *int            `json:"user_id"`
		Username   *string         `json:"username"`
		Action     string          `json:"action"`
		TargetType *string         `json:"target_type"`
		TargetID   *int            `json:"target_id"`
		Detail     json.RawMessage `json:"detail"`
		IPAddress  *string         `json:"ip_address"`
		OccurredAt time.Time       `json:"occurred_at"`
	}

	var logs []logEntry
	for rows.Next() {
		var l logEntry
		if err := rows.Scan(&l.ID, &l.UserID, &l.Username, &l.Action,
			&l.TargetType, &l.TargetID, &l.Detail, &l.IPAddress, &l.OccurredAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}

	if logs == nil {
		logs = []logEntry{}
	}

	// 총 개수
	countQuery := `SELECT count(*) FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`
	countArgs := []interface{}{}
	cidx := 1
	if action != "" {
		countQuery += ` AND a.action = $` + strconv.Itoa(cidx)
		countArgs = append(countArgs, action)
		cidx++
	}
	if user != "" {
		countQuery += ` AND u.username ILIKE $` + strconv.Itoa(cidx)
		countArgs = append(countArgs, "%"+user+"%")
	}
	var total int
	h.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"logs":  logs,
		"total": total,
	})
}

// LogFromHandler는 핸들러에서 감사 로그를 기록하는 헬퍼입니다.
func LogFromHandler(c echo.Context, pool *pgxpool.Pool, action, targetType string, targetID int, detail interface{}) {
	user := auth.GetUser(c)
	userID := 0
	if user != nil {
		userID = user.ID
	}
	logAudit(c.Request().Context(), pool, userID, action, targetType, targetID, detail, c.RealIP())
}
