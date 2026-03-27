package auth

import (
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type AuthUser struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

type Claims struct {
	jwt.RegisteredClaims
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

func jwtSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "digicap-secret-change-in-production"
	}
	return []byte(secret)
}

// SignToken은 사용자 정보로 JWT를 생성합니다 (8시간 만료).
func SignToken(user AuthUser) (string, error) {
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "digicap",
		},
		UserID:   user.ID,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

// VerifyToken은 JWT를 검증하고 사용자 정보를 반환합니다.
func VerifyToken(tokenStr string) (*AuthUser, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return jwtSecret(), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}

	return &AuthUser{
		ID:       claims.UserID,
		Username: claims.Username,
		Email:    claims.Email,
		Role:     claims.Role,
	}, nil
}
