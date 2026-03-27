package notify

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/smtp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Notifier는 알림 전송을 관리합니다.
type Notifier struct {
	pool *pgxpool.Pool
}

// AlertPayload는 알림 전송에 필요한 데이터입니다.
type AlertPayload struct {
	AlertID   int64
	Title     string
	Message   string
	Severity  string
	Source    string
	AssetName string
}

// New는 새 Notifier를 생성합니다.
func New(pool *pgxpool.Pool) *Notifier {
	return &Notifier{pool: pool}
}

// SendAlert는 설정된 채널을 통해 알림을 전송합니다.
func (n *Notifier) SendAlert(ctx context.Context, payload AlertPayload, channels []string) error {
	var lastErr error
	for _, ch := range channels {
		var err error
		switch ch {
		case "slack":
			err = n.sendSlack(ctx, payload)
		case "email":
			err = n.sendEmail(ctx, payload)
		default:
			slog.Warn("알 수 없는 알림 채널", "channel", ch)
			continue
		}

		status := "sent"
		var errMsg *string
		if err != nil {
			status = "failed"
			e := err.Error()
			errMsg = &e
			lastErr = err
			slog.Error("알림 전송 실패", "channel", ch, "alert_id", payload.AlertID, "error", err)
		} else {
			slog.Info("알림 전송 완료", "channel", ch, "alert_id", payload.AlertID)
		}

		// alert_notifications 테이블에 기록
		n.logNotification(ctx, payload.AlertID, ch, status, errMsg)
	}
	return lastErr
}

// logNotification은 알림 전송 결과를 DB에 기록합니다.
func (n *Notifier) logNotification(ctx context.Context, alertID int64, channel, status string, errMsg *string) {
	_, err := n.pool.Exec(ctx,
		`INSERT INTO alert_notifications (alert_id, channel, recipient, status, sent_at, error)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		alertID, channel, channel, status, time.Now(), errMsg,
	)
	if err != nil {
		slog.Error("알림 로그 기록 실패", "error", err)
	}
}

// getSetting은 system_settings 테이블에서 설정값을 조회합니다.
func (n *Notifier) getSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := n.pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = $1`, key,
	).Scan(&value)
	if err != nil {
		return "", fmt.Errorf("설정 조회 실패 (%s): %w", key, err)
	}
	return value, nil
}

// --- Slack ---

type slackPayload struct {
	Attachments []slackAttachment `json:"attachments"`
}

type slackAttachment struct {
	Color  string       `json:"color"`
	Title  string       `json:"title"`
	Text   string       `json:"text"`
	Fields []slackField `json:"fields"`
	Ts     int64        `json:"ts"`
}

type slackField struct {
	Title string `json:"title"`
	Value string `json:"value"`
	Short bool   `json:"short"`
}

func (n *Notifier) sendSlack(ctx context.Context, payload AlertPayload) error {
	webhookURL, err := n.getSetting(ctx, "slack_webhook_url")
	if err != nil {
		return fmt.Errorf("Slack webhook URL 미설정: %w", err)
	}
	if webhookURL == "" {
		return fmt.Errorf("Slack webhook URL이 비어있습니다")
	}

	color := severityColor(payload.Severity)

	msg := slackPayload{
		Attachments: []slackAttachment{
			{
				Color: color,
				Title: fmt.Sprintf("[%s] %s", payload.Severity, payload.Title),
				Text:  payload.Message,
				Fields: []slackField{
					{Title: "Severity", Value: payload.Severity, Short: true},
					{Title: "Source", Value: payload.Source, Short: true},
					{Title: "Asset", Value: payload.AssetName, Short: true},
				},
				Ts: time.Now().Unix(),
			},
		},
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("Slack 페이로드 직렬화 실패: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("Slack 요청 생성 실패: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Slack 전송 실패: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Slack 응답 에러: %d", resp.StatusCode)
	}

	return nil
}

// --- Email ---

func (n *Notifier) sendEmail(ctx context.Context, payload AlertPayload) error {
	host, err := n.getSetting(ctx, "smtp_host")
	if err != nil {
		return fmt.Errorf("SMTP 호스트 미설정: %w", err)
	}
	portStr, err := n.getSetting(ctx, "smtp_port")
	if err != nil {
		return fmt.Errorf("SMTP 포트 미설정: %w", err)
	}
	user, err := n.getSetting(ctx, "smtp_user")
	if err != nil {
		return fmt.Errorf("SMTP 사용자 미설정: %w", err)
	}
	password, err := n.getSetting(ctx, "smtp_password")
	if err != nil {
		return fmt.Errorf("SMTP 비밀번호 미설정: %w", err)
	}
	from, err := n.getSetting(ctx, "smtp_from")
	if err != nil {
		return fmt.Errorf("SMTP 발신자 미설정: %w", err)
	}
	to, err := n.getSetting(ctx, "alert_email_to")
	if err != nil {
		return fmt.Errorf("알림 수신 이메일 미설정: %w", err)
	}

	port, _ := strconv.Atoi(portStr)
	if port == 0 {
		port = 587
	}

	color := severityColor(payload.Severity)
	subject := fmt.Sprintf("[Digicap %s] %s", payload.Severity, payload.Title)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden;">
    <div style="background: %s; padding: 16px 24px;">
      <h2 style="color: #fff; margin: 0;">%s</h2>
    </div>
    <div style="padding: 24px;">
      <p><strong>Severity:</strong> %s</p>
      <p><strong>Source:</strong> %s</p>
      <p><strong>Asset:</strong> %s</p>
      <hr style="border: none; border-top: 1px solid #eee;">
      <p>%s</p>
    </div>
  </div>
</body>
</html>`, color, subject, payload.Severity, payload.Source, payload.AssetName, payload.Message)

	mime := "MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=\"utf-8\"\r\n" +
		fmt.Sprintf("From: %s\r\n", from) +
		fmt.Sprintf("To: %s\r\n", to) +
		fmt.Sprintf("Subject: %s\r\n", subject) +
		"\r\n" + htmlBody

	addr := fmt.Sprintf("%s:%d", host, port)
	auth := smtp.PlainAuth("", user, password, host)

	tlsConfig := &tls.Config{
		ServerName: host,
	}

	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		// TLS 직접 연결 실패 시 STARTTLS 시도
		return n.sendEmailStartTLS(addr, auth, from, to, []byte(mime))
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("SMTP 클라이언트 생성 실패: %w", err)
	}
	defer client.Close()

	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("SMTP 인증 실패: %w", err)
	}
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("SMTP MAIL 실패: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("SMTP RCPT 실패: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("SMTP DATA 실패: %w", err)
	}
	if _, err := w.Write([]byte(mime)); err != nil {
		return fmt.Errorf("SMTP 본문 전송 실패: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("SMTP 전송 완료 실패: %w", err)
	}

	return client.Quit()
}

// sendEmailStartTLS는 STARTTLS를 사용하여 이메일을 전송합니다.
func (n *Notifier) sendEmailStartTLS(addr string, auth smtp.Auth, from, to string, msg []byte) error {
	err := smtp.SendMail(addr, auth, from, []string{to}, msg)
	if err != nil {
		return fmt.Errorf("SMTP STARTTLS 전송 실패: %w", err)
	}
	return nil
}

// severityColor는 심각도에 따른 색상을 반환합니다.
func severityColor(severity string) string {
	switch severity {
	case "critical":
		return "#ef4444"
	case "warning":
		return "#f59e0b"
	case "info":
		return "#3b82f6"
	default:
		return "#6b7280"
	}
}
