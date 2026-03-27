package handler

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type SSL struct {
	pool *pgxpool.Pool
}

func NewSSL(pool *pgxpool.Pool) *SSL {
	return &SSL{pool: pool}
}

// List는 SSL 인증서 목록을 조회합니다.
func (h *SSL) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, hostname, port, issuer, subject, serial_number,
		        not_before, not_after, warn_days, is_active,
		        last_checked, last_error, created_at
		 FROM ssl_certificates
		 WHERE is_active = true
		 ORDER BY not_after ASC NULLS LAST`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type certRow struct {
		ID           int        `json:"id"`
		Hostname     string     `json:"hostname"`
		Port         int        `json:"port"`
		Issuer       *string    `json:"issuer"`
		Subject      *string    `json:"subject"`
		SerialNumber *string    `json:"serial_number"`
		NotBefore    *time.Time `json:"not_before"`
		NotAfter     *time.Time `json:"not_after"`
		WarnDays     int        `json:"warn_days"`
		IsActive     bool       `json:"is_active"`
		LastChecked  *time.Time `json:"last_checked"`
		LastError    *string    `json:"last_error"`
		CreatedAt    time.Time  `json:"created_at"`
		Status       string     `json:"status"`
		DaysLeft     *int       `json:"days_left"`
	}

	var certs []certRow
	for rows.Next() {
		var cr certRow
		rows.Scan(&cr.ID, &cr.Hostname, &cr.Port, &cr.Issuer, &cr.Subject,
			&cr.SerialNumber, &cr.NotBefore, &cr.NotAfter, &cr.WarnDays,
			&cr.IsActive, &cr.LastChecked, &cr.LastError, &cr.CreatedAt)

		// 상태 및 남은 일수 계산
		if cr.NotAfter != nil {
			days := int(time.Until(*cr.NotAfter).Hours() / 24)
			cr.DaysLeft = &days
			if days < 0 {
				cr.Status = "expired"
			} else if days <= cr.WarnDays {
				cr.Status = "warning"
			} else {
				cr.Status = "valid"
			}
		} else {
			cr.Status = "unknown"
		}
		certs = append(certs, cr)
	}
	if certs == nil {
		certs = []certRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"certificates": certs})
}

// Create는 새 SSL 인증서 모니터링 대상을 추가합니다.
func (h *SSL) Create(c echo.Context) error {
	var req struct {
		Hostname string `json:"hostname"`
		Port     int    `json:"port"`
		WarnDays int    `json:"warn_days"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Hostname == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "hostname은 필수입니다"})
	}
	if req.Port == 0 {
		req.Port = 443
	}
	if req.WarnDays == 0 {
		req.WarnDays = 30
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO ssl_certificates (hostname, port, warn_days)
		 VALUES ($1, $2, $3) RETURNING id`,
		req.Hostname, req.Port, req.WarnDays,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// Delete는 SSL 인증서 모니터링을 비활성화합니다.
func (h *SSL) Delete(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `UPDATE ssl_certificates SET is_active = false WHERE id = $1`, id)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Check는 특정 SSL 인증서를 즉시 점검합니다.
func (h *SSL) Check(c echo.Context) error {
	var req struct {
		ID int `json:"id"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.ID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// 대상 정보 조회
	var hostname string
	var port int
	err := h.pool.QueryRow(ctx,
		`SELECT hostname, port FROM ssl_certificates WHERE id = $1`, req.ID,
	).Scan(&hostname, &port)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "인증서를 찾을 수 없습니다"})
	}

	// TLS 핸드셰이크
	addr := fmt.Sprintf("%s:%d", hostname, port)
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{
		InsecureSkipVerify: true,
	})
	if err != nil {
		// 실패 시 에러 기록
		h.pool.Exec(ctx,
			`UPDATE ssl_certificates SET last_checked = now(), last_error = $1 WHERE id = $2`,
			err.Error(), req.ID)
		return c.JSON(http.StatusOK, map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
		})
	}
	defer conn.Close()

	// 인증서 정보 추출
	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		h.pool.Exec(ctx,
			`UPDATE ssl_certificates SET last_checked = now(), last_error = 'no peer certificates' WHERE id = $1`,
			req.ID)
		return c.JSON(http.StatusOK, map[string]interface{}{
			"ok":    false,
			"error": "no peer certificates",
		})
	}

	cert := certs[0]
	issuer := cert.Issuer.String()
	subject := cert.Subject.String()
	serial := cert.SerialNumber.String()
	notBefore := cert.NotBefore
	notAfter := cert.NotAfter

	h.pool.Exec(ctx,
		`UPDATE ssl_certificates
		 SET issuer = $1, subject = $2, serial_number = $3,
		     not_before = $4, not_after = $5,
		     last_checked = now(), last_error = NULL
		 WHERE id = $6`,
		issuer, subject, serial, notBefore, notAfter, req.ID)

	daysLeft := int(time.Until(notAfter).Hours() / 24)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":         true,
		"issuer":     issuer,
		"subject":    subject,
		"not_before": notBefore,
		"not_after":  notAfter,
		"days_left":  daysLeft,
	})
}
