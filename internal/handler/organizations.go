package handler

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Organizations struct {
	pool *pgxpool.Pool
}

func NewOrganizations(pool *pgxpool.Pool) *Organizations {
	return &Organizations{pool: pool}
}

type orgRow struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	ParentID    *int      `json:"parent_id"`
	OrgType     string    `json:"org_type"`
	ManagerName *string   `json:"manager_name"`
	Contact     *string   `json:"contact"`
	SortOrder   int       `json:"sort_order"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

// List는 조직 목록을 반환합니다.
func (h *Organizations) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// 트리 조회
	if c.QueryParam("tree") == "true" {
		return h.tree(c, ctx)
	}

	rows, err := h.pool.Query(ctx,
		`SELECT id, name, parent_id, org_type, manager_name, contact, sort_order, is_active, created_at
		 FROM organizations WHERE is_active = true ORDER BY sort_order, name`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var orgs []orgRow
	for rows.Next() {
		var o orgRow
		rows.Scan(&o.ID, &o.Name, &o.ParentID, &o.OrgType, &o.ManagerName,
			&o.Contact, &o.SortOrder, &o.IsActive, &o.CreatedAt)
		orgs = append(orgs, o)
	}
	if orgs == nil {
		orgs = []orgRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"organizations": orgs})
}

func (h *Organizations) tree(c echo.Context, ctx context.Context) error {
	rows, err := h.pool.Query(ctx,
		`WITH RECURSIVE org_tree AS (
		   SELECT id, name, parent_id, org_type, manager_name, contact, sort_order, 0 AS depth
		   FROM organizations WHERE parent_id IS NULL AND is_active = true
		   UNION ALL
		   SELECT o.id, o.name, o.parent_id, o.org_type, o.manager_name, o.contact, o.sort_order, t.depth + 1
		   FROM organizations o JOIN org_tree t ON o.parent_id = t.id
		   WHERE o.is_active = true
		 )
		 SELECT id, name, parent_id, org_type, manager_name, contact, sort_order, depth
		 FROM org_tree ORDER BY depth, sort_order, name`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type treeNode struct {
		ID          int     `json:"id"`
		Name        string  `json:"name"`
		ParentID    *int    `json:"parent_id"`
		OrgType     string  `json:"org_type"`
		ManagerName *string `json:"manager_name"`
		Contact     *string `json:"contact"`
		SortOrder   int     `json:"sort_order"`
		Depth       int     `json:"depth"`
	}

	var nodes []treeNode
	for rows.Next() {
		var n treeNode
		rows.Scan(&n.ID, &n.Name, &n.ParentID, &n.OrgType, &n.ManagerName,
			&n.Contact, &n.SortOrder, &n.Depth)
		nodes = append(nodes, n)
	}
	if nodes == nil {
		nodes = []treeNode{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"tree": nodes})
}

type createOrgReq struct {
	Name        string `json:"name"`
	ParentID    *int   `json:"parent_id"`
	OrgType     string `json:"org_type"`
	ManagerName string `json:"manager_name"`
	Contact     string `json:"contact"`
	SortOrder   int    `json:"sort_order"`
}

// Create는 새 조직을 생성합니다.
func (h *Organizations) Create(c echo.Context) error {
	var req createOrgReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "조직명은 필수입니다"})
	}
	if req.OrgType == "" {
		req.OrgType = "team"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO organizations (name, parent_id, org_type, manager_name, contact, sort_order)
		 VALUES ($1, $2, $3, NULLIF($4,''), NULLIF($5,''), $6) RETURNING id`,
		req.Name, req.ParentID, req.OrgType, req.ManagerName, req.Contact, req.SortOrder,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// Update는 조직 정보를 변경합니다.
func (h *Organizations) Update(c echo.Context) error {
	var req struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		ParentID    *int   `json:"parent_id"`
		OrgType     string `json:"org_type"`
		ManagerName string `json:"manager_name"`
		Contact     string `json:"contact"`
		SortOrder   int    `json:"sort_order"`
	}
	if err := c.Bind(&req); err != nil || req.ID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx,
		`UPDATE organizations SET name=$1, parent_id=$2, org_type=$3,
		 manager_name=NULLIF($4,''), contact=NULLIF($5,''), sort_order=$6
		 WHERE id = $7`,
		req.Name, req.ParentID, req.OrgType, req.ManagerName, req.Contact, req.SortOrder, req.ID)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Delete는 조직을 비활성화합니다.
func (h *Organizations) Delete(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `UPDATE organizations SET is_active = false WHERE id = $1`, id)
	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}
