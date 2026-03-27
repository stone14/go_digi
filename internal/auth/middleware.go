package auth

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

const (
	CookieName  = "digicap_token"
	UserCtxKey  = "auth_user"
)

// RequireAuth는 인증된 사용자만 접근 허용하는 미들웨어입니다.
func RequireAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			user := getUserFromRequest(c)
			if user == nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			}
			c.Set(UserCtxKey, user)
			return next(c)
		}
	}
}

// RequireRole은 특정 역할 이상만 접근 허용하는 미들웨어입니다.
func RequireRole(minRole string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			user := getUserFromRequest(c)
			if user == nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			}
			if RoleLevel(user.Role) < RoleLevel(minRole) {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Forbidden"})
			}
			c.Set(UserCtxKey, user)
			return next(c)
		}
	}
}

// GetUser는 컨텍스트에서 인증된 사용자를 반환합니다.
func GetUser(c echo.Context) *AuthUser {
	user, ok := c.Get(UserCtxKey).(*AuthUser)
	if !ok {
		return nil
	}
	return user
}

func getUserFromRequest(c echo.Context) *AuthUser {
	// 1. Cookie
	cookie, err := c.Cookie(CookieName)
	if err == nil && cookie.Value != "" {
		if user, err := VerifyToken(cookie.Value); err == nil {
			return user
		}
	}

	// 2. Authorization header
	header := c.Request().Header.Get("Authorization")
	if len(header) > 7 && header[:7] == "Bearer " {
		if user, err := VerifyToken(header[7:]); err == nil {
			return user
		}
	}

	return nil
}
