package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Health struct {
	pool *pgxpool.Pool
}

func NewHealth(pool *pgxpool.Pool) *Health {
	return &Health{pool: pool}
}

type HealthResponse struct {
	Status   string `json:"status"`
	Version  string `json:"version"`
	Database string `json:"database"`
	Uptime   string `json:"uptime"`
}

var startTime = time.Now()

func (h *Health) Check(c echo.Context) error {
	dbStatus := "ok"

	ctx, cancel := context.WithTimeout(c.Request().Context(), 3*time.Second)
	defer cancel()

	if err := h.pool.Ping(ctx); err != nil {
		dbStatus = "error: " + err.Error()
	}

	resp := HealthResponse{
		Status:   "ok",
		Version:  "0.1.0",
		Database: dbStatus,
		Uptime:   time.Since(startTime).Round(time.Second).String(),
	}

	if dbStatus != "ok" {
		resp.Status = "degraded"
		return c.JSON(http.StatusServiceUnavailable, resp)
	}

	return c.JSON(http.StatusOK, resp)
}
