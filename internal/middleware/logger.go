package middleware

import (
	"log/slog"
	"time"

	"github.com/labstack/echo/v4"
)

// RequestLogger는 요청/응답을 slog로 기록합니다.
func RequestLogger() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()

			err := next(c)

			req := c.Request()
			res := c.Response()
			latency := time.Since(start)

			slog.Info("request",
				"method", req.Method,
				"path", req.URL.Path,
				"status", res.Status,
				"latency_ms", latency.Milliseconds(),
				"remote_ip", c.RealIP(),
			)

			return err
		}
	}
}
