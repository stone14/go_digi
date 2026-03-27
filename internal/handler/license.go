package handler

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type License struct {
	pool *pgxpool.Pool
}

func NewLicense(pool *pgxpool.Pool) *License {
	return &License{pool: pool}
}

type licenseInfo struct {
	ID           string    `json:"id"`
	CustomerName string    `json:"customer_name"`
	MaxAssets    int       `json:"max_assets"`
	Features     []string  `json:"features"`
	IssuedAt     time.Time `json:"issued_at"`
	ExpiresAt    time.Time `json:"expires_at"`
	Valid        bool      `json:"valid"`
	DaysLeft     int       `json:"days_left"`
}

// GetStatus는 현재 라이선스 상태를 조회합니다.
func (h *License) GetStatus(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var tokenStr *string
	h.pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'license_token'`).Scan(&tokenStr)

	if tokenStr == nil || *tokenStr == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"license": nil,
			"status":  "no_license",
			"message": "라이선스가 등록되지 않았습니다",
		})
	}

	info, err := h.parseLicense(ctx, *tokenStr)
	if err != nil {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"license": nil,
			"status":  "invalid",
			"message": err.Error(),
		})
	}

	status := "active"
	if !info.Valid {
		status = "expired"
	} else if info.DaysLeft <= 30 {
		status = "expiring"
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"license": info,
		"status":  status,
	})
}

// Activate는 라이선스 키를 등록합니다.
func (h *License) Activate(c echo.Context) error {
	var req struct {
		LicenseKey string `json:"license_key"`
	}
	if err := c.Bind(&req); err != nil || req.LicenseKey == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "라이선스 키가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// 라이선스 검증
	info, err := h.parseLicense(ctx, req.LicenseKey)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "유효하지 않은 라이선스: " + err.Error()})
	}

	// 저장
	h.pool.Exec(ctx,
		`INSERT INTO system_settings (key, value) VALUES ('license_token', $1)
		 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
		req.LicenseKey)

	return c.JSON(http.StatusOK, map[string]interface{}{"ok": true, "license": info})
}

// Deactivate는 라이선스를 제거합니다.
func (h *License) Deactivate(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `DELETE FROM system_settings WHERE key = 'license_token'`)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (h *License) parseLicense(ctx context.Context, tokenStr string) (*licenseInfo, error) {
	// 공개키 로드
	var pubKeyPEM *string
	h.pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'license_public_key'`).Scan(&pubKeyPEM)

	var pubKey *rsa.PublicKey
	if pubKeyPEM != nil && *pubKeyPEM != "" {
		block, _ := pem.Decode([]byte(*pubKeyPEM))
		if block != nil {
			key, err := x509.ParsePKIXPublicKey(block.Bytes)
			if err == nil {
				if rsaKey, ok := key.(*rsa.PublicKey); ok {
					pubKey = rsaKey
				}
			}
		}
	}

	// JWT 파싱
	claims := jwt.MapClaims{}
	var token *jwt.Token
	var err error

	if pubKey != nil {
		token, err = jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return pubKey, nil
		})
	} else {
		// RSA 공개키가 없으면 HMAC으로 폴백 (개발용)
		var secret string
		h.pool.QueryRow(ctx,
			`SELECT value FROM system_settings WHERE key = 'license_secret'`).Scan(&secret)
		if secret == "" {
			secret = "digicap-dev-license-key"
		}
		token, err = jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
	}

	if err != nil {
		return nil, fmt.Errorf("토큰 파싱 실패: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("유효하지 않은 토큰")
	}

	// 클레임 추출
	info := &licenseInfo{Valid: true}

	if v, ok := claims["jti"].(string); ok {
		info.ID = v
	}
	if v, ok := claims["sub"].(string); ok {
		info.CustomerName = v
	}
	if v, ok := claims["max_assets"].(float64); ok {
		info.MaxAssets = int(v)
	}
	if v, ok := claims["features"].([]interface{}); ok {
		for _, f := range v {
			if s, ok := f.(string); ok {
				info.Features = append(info.Features, s)
			}
		}
	}
	if v, ok := claims["iat"].(float64); ok {
		info.IssuedAt = time.Unix(int64(v), 0)
	}
	if v, ok := claims["exp"].(float64); ok {
		info.ExpiresAt = time.Unix(int64(v), 0)
		info.DaysLeft = int(time.Until(info.ExpiresAt).Hours() / 24)
		if info.DaysLeft < 0 {
			info.Valid = false
			info.DaysLeft = 0
		}
	}

	return info, nil
}
