package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Settings struct {
	pool *pgxpool.Pool
}

func NewSettings(pool *pgxpool.Pool) *Settings {
	return &Settings{pool: pool}
}

// SystemSettings — GET: 시스템 설정 조회, PUT: 설정 변경
func (h *Settings) GetSystemSettings(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT key, value, description FROM system_settings ORDER BY key`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	settings := map[string]interface{}{}
	for rows.Next() {
		var key, value string
		var desc *string
		if err := rows.Scan(&key, &value, &desc); err != nil {
			continue
		}
		settings[key] = value
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"settings": settings})
}

func (h *Settings) UpdateSystemSettings(c echo.Context) error {
	var body map[string]string
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	for key, value := range body {
		h.pool.Exec(ctx,
			`UPDATE system_settings SET value = $1, updated_at = now() WHERE key = $2`,
			value, key)
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// AgentTokens — CRUD
func (h *Settings) ListAgentTokens(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// 서버 목록 (Agent 설치 대상)
	if c.QueryParam("list") == "servers" {
		rows, err := h.pool.Query(ctx,
			`SELECT id, hostname, ip_address::text, type, os, agent_version
			 FROM assets WHERE is_active = true AND type = 'server'
			 ORDER BY hostname`)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		defer rows.Close()

		type serverRow struct {
			ID           int     `json:"id"`
			Hostname     *string `json:"hostname"`
			IPAddress    *string `json:"ip_address"`
			Type         string  `json:"type"`
			OS           *string `json:"os"`
			AgentVersion *string `json:"agent_version"`
		}
		var servers []serverRow
		for rows.Next() {
			var s serverRow
			rows.Scan(&s.ID, &s.Hostname, &s.IPAddress, &s.Type, &s.OS, &s.AgentVersion)
			servers = append(servers, s)
		}
		if servers == nil {
			servers = []serverRow{}
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"servers": servers})
	}

	// 토큰 목록
	rows, err := h.pool.Query(ctx,
		`SELECT t.id, t.token, t.label, t.asset_id,
		        a.name AS asset_name, a.ip_address::text, a.os, a.agent_version,
		        t.last_seen, t.revoked, t.created_at
		 FROM agent_tokens t
		 LEFT JOIN assets a ON a.id = t.asset_id
		 ORDER BY t.created_at DESC`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type tokenRow struct {
		ID           int        `json:"id"`
		Token        string     `json:"token"`
		Label        *string    `json:"label"`
		AssetID      *int       `json:"asset_id"`
		AssetName    *string    `json:"asset_name"`
		IPAddress    *string    `json:"ip_address"`
		OS           *string    `json:"os"`
		AgentVersion *string    `json:"agent_version"`
		LastSeen     *time.Time `json:"last_seen"`
		Revoked      bool       `json:"revoked"`
		CreatedAt    time.Time  `json:"created_at"`
	}
	var agents []tokenRow
	for rows.Next() {
		var t tokenRow
		rows.Scan(&t.ID, &t.Token, &t.Label, &t.AssetID,
			&t.AssetName, &t.IPAddress, &t.OS, &t.AgentVersion,
			&t.LastSeen, &t.Revoked, &t.CreatedAt)
		agents = append(agents, t)
	}
	if agents == nil {
		agents = []tokenRow{}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"agents": agents})
}

func (h *Settings) CreateAgentToken(c echo.Context) error {
	var body struct {
		Label   string `json:"label"`
		AssetID *int   `json:"asset_id"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	tokenBytes := make([]byte, 32)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO agent_tokens (token, label, asset_id) VALUES ($1, $2, $3) RETURNING id`,
		token, nilIfEmpty(body.Label), body.AssetID,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"ok": true, "id": id, "token": token})
}

func (h *Settings) RevokeAgentToken(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `UPDATE agent_tokens SET revoked = true WHERE id = $1`, id)
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
