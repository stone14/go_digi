package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/stone14/go_digi/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

type Auth struct {
	pool *pgxpool.Pool
}

func NewAuth(pool *pgxpool.Pool) *Auth {
	return &Auth{pool: pool}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Login은 사용자 인증 후 JWT 쿠키를 설정합니다.
func (h *Auth) Login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Username == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "사용자명과 비밀번호를 입력하세요"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var user struct {
		ID           int
		Username     string
		Email        string
		Role         string
		PasswordHash string
		IsActive     bool
		FailedAttempts int
		LockedUntil  *time.Time
	}

	err := h.pool.QueryRow(ctx,
		`SELECT id, username, email, role, password_hash, is_active, failed_attempts, locked_until
		 FROM users WHERE username = $1`, req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Role,
		&user.PasswordHash, &user.IsActive, &user.FailedAttempts, &user.LockedUntil)

	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "사용자명 또는 비밀번호가 올바르지 않습니다"})
	}

	if !user.IsActive {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "비활성화된 계정입니다"})
	}

	// 잠금 확인
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		return c.JSON(http.StatusTooManyRequests, map[string]string{
			"error": "계정이 잠겨있습니다. 잠시 후 다시 시도하세요",
		})
	}

	// 비밀번호 검증
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		// 실패 횟수 증가
		failed := user.FailedAttempts + 1
		if failed >= 5 {
			h.pool.Exec(ctx,
				`UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
				failed, time.Now().Add(30*time.Minute), user.ID)
		} else {
			h.pool.Exec(ctx,
				`UPDATE users SET failed_attempts = $1 WHERE id = $2`, failed, user.ID)
		}
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "사용자명 또는 비밀번호가 올바르지 않습니다"})
	}

	// 로그인 성공: 실패 횟수 초기화
	h.pool.Exec(ctx,
		`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = now() WHERE id = $1`,
		user.ID)

	// JWT 발급
	tokenStr, err := auth.SignToken(auth.AuthUser{
		ID:       user.ID,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "토큰 생성 실패"})
	}

	// 쿠키 설정
	c.SetCookie(&http.Cookie{
		Name:     auth.CookieName,
		Value:    tokenStr,
		Path:     "/",
		MaxAge:   28800, // 8시간
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	// 감사 로그
	logAudit(ctx, h.pool, user.ID, "login", "user", user.ID, nil, c.RealIP())

	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":       true,
		"username": user.Username,
		"role":     user.Role,
	})
}

// Me는 현재 인증된 사용자 정보를 반환합니다.
func (h *Auth) Me(c echo.Context) error {
	user := auth.GetUser(c)
	if user == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{"user": nil})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"user": map[string]interface{}{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
			"role":     user.Role,
		},
	})
}

// Logout은 인증 쿠키를 삭제합니다.
func (h *Auth) Logout(c echo.Context) error {
	c.SetCookie(&http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}
