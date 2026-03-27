package scheduler

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runSSLCheck connects to all tracked SSL endpoints, reads the certificate
// chain, and updates expiry / status in the database.
func runSSLCheck(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT id, asset_id, hostname, port, warn_days
		 FROM ssl_certificates`)
	if err != nil {
		return fmt.Errorf("ssl_certificates query: %w", err)
	}
	defer rows.Close()

	type sslTarget struct {
		ID       int
		AssetID  *int
		Hostname string
		Port     int
		WarnDays int
	}

	var targets []sslTarget
	for rows.Next() {
		var t sslTarget
		if err := rows.Scan(&t.ID, &t.AssetID, &t.Hostname, &t.Port, &t.WarnDays); err != nil {
			slog.Warn("ssl cert scan 실패", "error", err)
			continue
		}
		targets = append(targets, t)
	}
	rows.Close()

	for _, t := range targets {
		if err := checkSSL(ctx, pool, t.ID, t.AssetID, t.Hostname, t.Port, t.WarnDays); err != nil {
			slog.Warn("SSL check 실패", "id", t.ID, "hostname", t.Hostname, "error", err)
		}
	}

	return nil
}

func checkSSL(ctx context.Context, pool *pgxpool.Pool, id int, assetID *int, hostname string, port, warnDays int) error {
	addr := fmt.Sprintf("%s:%d", hostname, port)

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec // we read the cert even if invalid
	})
	if err != nil {
		// Mark as error status.
		pool.Exec(ctx,
			`UPDATE ssl_certificates SET status = 'error', last_checked = now() WHERE id = $1`, id)
		return fmt.Errorf("TLS dial %s: %w", addr, err)
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		pool.Exec(ctx,
			`UPDATE ssl_certificates SET status = 'error', last_checked = now() WHERE id = $1`, id)
		return fmt.Errorf("no peer certificates from %s", addr)
	}

	cert := certs[0]
	daysRemaining := int(time.Until(cert.NotAfter).Hours() / 24)

	var status string
	switch {
	case daysRemaining <= 0:
		status = "expired"
	case daysRemaining <= warnDays:
		status = "expiring"
	default:
		status = "ok"
	}

	// Get previous status to detect transitions.
	var prevStatus string
	pool.QueryRow(ctx,
		`SELECT status FROM ssl_certificates WHERE id = $1`, id,
	).Scan(&prevStatus)

	// Update certificate record.
	_, err = pool.Exec(ctx,
		`UPDATE ssl_certificates
		 SET subject = $2, issuer = $3, not_before = $4, not_after = $5,
		     status = $6, last_checked = now()
		 WHERE id = $1`,
		id, cert.Subject.CommonName, cert.Issuer.CommonName,
		cert.NotBefore, cert.NotAfter, status)
	if err != nil {
		return fmt.Errorf("ssl update: %w", err)
	}

	slog.Info("SSL check 완료",
		"hostname", hostname, "status", status, "days_remaining", daysRemaining)

	// Create alert on status transition to expiring or expired.
	if (status == "expiring" || status == "expired") && prevStatus != status {
		severity := "warning"
		if status == "expired" {
			severity = "critical"
		}
		title := fmt.Sprintf("[%s] SSL 인증서 %s: %s", severity, status, hostname)
		message := fmt.Sprintf("SSL 인증서 '%s:%d' — 만료까지 %d일 남음 (만료일: %s)",
			hostname, port, daysRemaining, cert.NotAfter.Format("2006-01-02"))

		var alertAssetID *int
		if assetID != nil {
			alertAssetID = assetID
		}

		pool.Exec(ctx,
			`INSERT INTO alerts (asset_id, severity, title, message, source, status)
			 VALUES ($1, $2, $3, $4, 'ssl_check', 'active')`,
			alertAssetID, severity, title, message)
		slog.Info("SSL alert 생성", "hostname", hostname, "status", status)
	}

	return nil
}
