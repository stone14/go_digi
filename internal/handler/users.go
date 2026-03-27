package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type Users struct {
	pool *pgxpool.Pool
}

func NewUsers(pool *pgxpool.Pool) *Users {
	return &Users{pool: pool}
}

type userRow struct {
	ID        int        `json:"id"`
	Username  string     `json:"username"`
	Email     string     `json:"email"`
	Role      string     `json:"role"`
	IsActive  bool       `json:"is_active"`
	LastLogin *time.Time `json:"last_login"`
	CreatedAt time.Time  `json:"created_at"`
}

// List는 전체 사용자 목록을 반환합니다.
func (h *Users) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, username, email, role, is_active, last_login, created_at
		 FROM users ORDER BY created_at DESC`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var users []userRow
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.IsActive, &u.LastLogin, &u.CreatedAt); err != nil {
			continue
		}
		users = append(users, u)
	}
	if users == nil {
		users = []userRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"users": users})
}

type createUserReq struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// Create는 새 사용자를 생성합니다.
func (h *Users) Create(c echo.Context) error {
	var req createUserReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Username == "" || req.Email == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "필수 항목을 입력하세요"})
	}

	if req.Role == "" {
		req.Role = "readonly"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "비밀번호 해시 실패"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err = h.pool.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash, role)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		req.Username, req.Email, string(hash), req.Role,
	).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "사용자명 또는 이메일이 중복됩니다"})
	}

	LogFromHandler(c, h.pool, "user.create", "user", id, map[string]string{"username": req.Username})

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

type updateUserReq struct {
	ID       int    `json:"id"`
	Role     string `json:"role,omitempty"`
	IsActive *bool  `json:"is_active,omitempty"`
	Password string `json:"password,omitempty"`
}

// Update는 사용자 정보를 변경합니다.
func (h *Users) Update(c echo.Context) error {
	var req updateUserReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.ID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	if req.Role != "" {
		h.pool.Exec(ctx, `UPDATE users SET role = $1 WHERE id = $2`, req.Role, req.ID)
	}
	if req.IsActive != nil {
		h.pool.Exec(ctx, `UPDATE users SET is_active = $1 WHERE id = $2`, *req.IsActive, req.ID)
	}
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
		if err == nil {
			h.pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, string(hash), req.ID)
		}
	}

	LogFromHandler(c, h.pool, "user.update", "user", req.ID, nil)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Delete는 사용자를 비활성화합니다 (소프트 삭제).
func (h *Users) Delete(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `UPDATE users SET is_active = false WHERE id = $1`, id)
	LogFromHandler(c, h.pool, "user.delete", "user", id, nil)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}
