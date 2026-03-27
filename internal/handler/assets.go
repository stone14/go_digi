package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Assets struct {
	pool *pgxpool.Pool
}

func NewAssets(pool *pgxpool.Pool) *Assets {
	return &Assets{pool: pool}
}

// List는 자산 목록 또는 단일 자산을 조회합니다.
func (h *Assets) List(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// 단일 자산 조회
	if idStr := c.QueryParam("id"); idStr != "" {
		return h.getOne(c, ctx, idStr)
	}

	// 목록 조회
	assetType := c.QueryParam("type")
	status := c.QueryParam("status")
	lifecycle := c.QueryParam("lifecycle")
	search := c.QueryParam("search")
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	page, _ := strconv.Atoi(c.QueryParam("page"))
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	query := `SELECT a.id, a.name, a.hostname, a.ip_address::text, a.type, a.os, a.os_version,
	                 a.location, a.group_tag, a.manufacturer, a.model, a.serial_number,
	                 a.bmc_ip::text, a.bmc_type, a.bmc_enabled, a.monitoring_enabled,
	                 a.agent_version, a.agent_url, a.node_type,
	                 a.manager, a.user_name, a.user_team, a.org_id,
	                 a.registration_source, a.status, a.lifecycle_status,
	                 a.last_seen, a.introduced_at, a.is_active, a.created_at, a.updated_at
	          FROM assets a WHERE a.is_active = true`

	countQuery := `SELECT count(*) FROM assets a WHERE a.is_active = true`

	args := []interface{}{}
	countArgs := []interface{}{}
	idx := 1

	if assetType != "" {
		filter := fmt.Sprintf(` AND a.type = $%d`, idx)
		query += filter
		countQuery += filter
		args = append(args, assetType)
		countArgs = append(countArgs, assetType)
		idx++
	}
	if status != "" {
		filter := fmt.Sprintf(` AND a.status = $%d`, idx)
		query += filter
		countQuery += filter
		args = append(args, status)
		countArgs = append(countArgs, status)
		idx++
	}
	if lifecycle != "" {
		filter := fmt.Sprintf(` AND a.lifecycle_status = $%d`, idx)
		query += filter
		countQuery += filter
		args = append(args, lifecycle)
		countArgs = append(countArgs, lifecycle)
		idx++
	}
	if search != "" {
		filter := fmt.Sprintf(` AND (a.name ILIKE $%d OR a.hostname ILIKE $%d OR a.ip_address::text ILIKE $%d OR a.manager ILIKE $%d OR a.user_name ILIKE $%d)`,
			idx, idx, idx, idx, idx)
		query += filter
		countQuery += filter
		s := "%" + search + "%"
		args = append(args, s)
		countArgs = append(countArgs, s)
		idx++
	}

	query += fmt.Sprintf(` ORDER BY a.created_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type assetRow struct {
		ID                 int        `json:"id"`
		Name               string     `json:"name"`
		Hostname           *string    `json:"hostname"`
		IPAddress          *string    `json:"ip_address"`
		Type               string     `json:"type"`
		OS                 *string    `json:"os"`
		OSVersion          *string    `json:"os_version"`
		Location           *string    `json:"location"`
		GroupTag           *string    `json:"group_tag"`
		Manufacturer       *string    `json:"manufacturer"`
		Model              *string    `json:"model"`
		SerialNumber       *string    `json:"serial_number"`
		BmcIP              *string    `json:"bmc_ip"`
		BmcType            *string    `json:"bmc_type"`
		BmcEnabled         bool       `json:"bmc_enabled"`
		MonitoringEnabled  bool       `json:"monitoring_enabled"`
		AgentVersion       *string    `json:"agent_version"`
		AgentURL           *string    `json:"agent_url"`
		NodeType           *string    `json:"node_type"`
		Manager            *string    `json:"manager"`
		UserName           *string    `json:"user_name"`
		UserTeam           *string    `json:"user_team"`
		OrgID              *int       `json:"org_id"`
		RegistrationSource *string    `json:"registration_source"`
		Status             string     `json:"status"`
		LifecycleStatus    *string    `json:"lifecycle_status"`
		LastSeen           *time.Time `json:"last_seen"`
		IntroducedAt       *string    `json:"introduced_at"`
		IsActive           bool       `json:"is_active"`
		CreatedAt          time.Time  `json:"created_at"`
		UpdatedAt          time.Time  `json:"updated_at"`
	}

	var assets []assetRow
	for rows.Next() {
		var a assetRow
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Hostname, &a.IPAddress, &a.Type, &a.OS, &a.OSVersion,
			&a.Location, &a.GroupTag, &a.Manufacturer, &a.Model, &a.SerialNumber,
			&a.BmcIP, &a.BmcType, &a.BmcEnabled, &a.MonitoringEnabled,
			&a.AgentVersion, &a.AgentURL, &a.NodeType,
			&a.Manager, &a.UserName, &a.UserTeam, &a.OrgID,
			&a.RegistrationSource, &a.Status, &a.LifecycleStatus,
			&a.LastSeen, &a.IntroducedAt, &a.IsActive, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			continue
		}
		assets = append(assets, a)
	}
	if assets == nil {
		assets = []assetRow{}
	}

	var total int
	h.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"assets": assets,
		"total":  total,
		"page":   page,
		"limit":  limit,
	})
}

func (h *Assets) getOne(c echo.Context, ctx context.Context, idStr string) error {
	id, _ := strconv.Atoi(idStr)
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "유효하지 않은 id"})
	}

	row := h.pool.QueryRow(ctx,
		`SELECT id, name, hostname, ip_address::text, type, os, os_version,
		        location, group_tag, manufacturer, model, serial_number,
		        bmc_ip::text, bmc_type, bmc_enabled, monitoring_enabled,
		        agent_version, agent_url, node_type,
		        manager, user_name, user_team, org_id,
		        registration_source, status, lifecycle_status,
		        decommission_at, decommission_note,
		        last_seen, introduced_at, is_active, created_at, updated_at
		 FROM assets WHERE id = $1`, id)

	var a struct {
		ID                 int        `json:"id"`
		Name               string     `json:"name"`
		Hostname           *string    `json:"hostname"`
		IPAddress          *string    `json:"ip_address"`
		Type               string     `json:"type"`
		OS                 *string    `json:"os"`
		OSVersion          *string    `json:"os_version"`
		Location           *string    `json:"location"`
		GroupTag           *string    `json:"group_tag"`
		Manufacturer       *string    `json:"manufacturer"`
		Model              *string    `json:"model"`
		SerialNumber       *string    `json:"serial_number"`
		BmcIP              *string    `json:"bmc_ip"`
		BmcType            *string    `json:"bmc_type"`
		BmcEnabled         bool       `json:"bmc_enabled"`
		MonitoringEnabled  bool       `json:"monitoring_enabled"`
		AgentVersion       *string    `json:"agent_version"`
		AgentURL           *string    `json:"agent_url"`
		NodeType           *string    `json:"node_type"`
		Manager            *string    `json:"manager"`
		UserName           *string    `json:"user_name"`
		UserTeam           *string    `json:"user_team"`
		OrgID              *int       `json:"org_id"`
		RegistrationSource *string    `json:"registration_source"`
		Status             string     `json:"status"`
		LifecycleStatus    *string    `json:"lifecycle_status"`
		DecommissionAt     *string    `json:"decommission_at"`
		DecommissionNote   *string    `json:"decommission_note"`
		LastSeen           *time.Time `json:"last_seen"`
		IntroducedAt       *string    `json:"introduced_at"`
		IsActive           bool       `json:"is_active"`
		CreatedAt          time.Time  `json:"created_at"`
		UpdatedAt          time.Time  `json:"updated_at"`
	}

	err := row.Scan(
		&a.ID, &a.Name, &a.Hostname, &a.IPAddress, &a.Type, &a.OS, &a.OSVersion,
		&a.Location, &a.GroupTag, &a.Manufacturer, &a.Model, &a.SerialNumber,
		&a.BmcIP, &a.BmcType, &a.BmcEnabled, &a.MonitoringEnabled,
		&a.AgentVersion, &a.AgentURL, &a.NodeType,
		&a.Manager, &a.UserName, &a.UserTeam, &a.OrgID,
		&a.RegistrationSource, &a.Status, &a.LifecycleStatus,
		&a.DecommissionAt, &a.DecommissionNote,
		&a.LastSeen, &a.IntroducedAt, &a.IsActive, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "자산을 찾을 수 없습니다"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"asset": a})
}

type createAssetReq struct {
	Name              string  `json:"name"`
	Hostname          string  `json:"hostname"`
	IPAddress         string  `json:"ip_address"`
	AssetType         string  `json:"asset_type"`
	OSType            string  `json:"os_type"`
	OSVersion         string  `json:"os_version"`
	Location          string  `json:"location"`
	GroupTag          string  `json:"group_tag"`
	Manufacturer      string  `json:"manufacturer"`
	Model             string  `json:"model"`
	SerialNumber      string  `json:"serial_number"`
	BmcIP             string  `json:"bmc_ip"`
	BmcType           string  `json:"bmc_type"`
	BmcEnabled        bool    `json:"bmc_enabled"`
	MonitoringEnabled *bool   `json:"monitoring_enabled"`
	IntroducedAt      string  `json:"introduced_at"`
	Manager           string  `json:"manager"`
	UserName          string  `json:"user_name"`
	UserTeam          string  `json:"user_team"`
	OrgID             *int    `json:"org_id"`
	Source            string  `json:"registration_source"`
}

// Create는 새 자산을 생성합니다.
func (h *Assets) Create(c echo.Context) error {
	var req createAssetReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "자산명은 필수입니다"})
	}
	if req.AssetType == "" {
		req.AssetType = "server"
	}
	if req.Source == "" {
		req.Source = "manual"
	}

	monEnabled := true
	if req.MonitoringEnabled != nil {
		monEnabled = *req.MonitoringEnabled
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO assets (name, hostname, ip_address, type, os, os_version,
		        location, group_tag, manufacturer, model, serial_number,
		        bmc_ip, bmc_type, bmc_enabled, monitoring_enabled,
		        introduced_at, manager, user_name, user_team, org_id,
		        registration_source)
		 VALUES ($1, $2, NULLIF($3,'')::inet, $4, NULLIF($5,''), NULLIF($6,''),
		         NULLIF($7,''), NULLIF($8,''), NULLIF($9,''), NULLIF($10,''), NULLIF($11,''),
		         NULLIF($12,'')::inet, NULLIF($13,''), $14, $15,
		         NULLIF($16,'')::date, NULLIF($17,''), NULLIF($18,''), NULLIF($19,''), $20,
		         $21)
		 RETURNING id`,
		req.Name, req.Hostname, req.IPAddress, req.AssetType, req.OSType, req.OSVersion,
		req.Location, req.GroupTag, req.Manufacturer, req.Model, req.SerialNumber,
		req.BmcIP, req.BmcType, req.BmcEnabled, monEnabled,
		req.IntroducedAt, req.Manager, req.UserName, req.UserTeam, req.OrgID,
		req.Source,
	).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	LogFromHandler(c, h.pool, "asset.create", "asset", id, map[string]string{"name": req.Name})

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// Update는 자산 정보를 변경합니다.
func (h *Assets) Update(c echo.Context) error {
	var body map[string]interface{}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	idVal, ok := body["id"]
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}
	id := int(idVal.(float64))

	// 필드 매핑 (프론트엔드 이름 → DB 컬럼)
	fieldMap := map[string]string{
		"name": "name", "hostname": "hostname", "ip_address": "ip_address",
		"asset_type": "type", "os_type": "os", "os_version": "os_version",
		"location": "location", "group_tag": "group_tag",
		"manufacturer": "manufacturer", "model": "model", "serial_number": "serial_number",
		"bmc_ip": "bmc_ip", "bmc_type": "bmc_type", "bmc_enabled": "bmc_enabled",
		"monitoring_enabled": "monitoring_enabled",
		"introduced_at": "introduced_at", "lifecycle_status": "lifecycle_status",
		"decommission_at": "decommission_at", "decommission_note": "decommission_note",
		"manager": "manager", "user_name": "user_name", "user_team": "user_team",
		"org_id": "org_id", "status": "status",
	}

	sets := []string{"updated_at = now()"}
	args := []interface{}{}
	idx := 1

	for key, col := range fieldMap {
		val, exists := body[key]
		if !exists {
			continue
		}

		// 빈 문자열 → NULL 처리
		if strVal, isStr := val.(string); isStr && strVal == "" {
			sets = append(sets, fmt.Sprintf("%s = NULL", col))
			continue
		}

		// inet 타입 캐스팅
		if col == "ip_address" || col == "bmc_ip" {
			sets = append(sets, fmt.Sprintf("%s = $%d::inet", col, idx))
		} else if col == "introduced_at" || col == "decommission_at" {
			sets = append(sets, fmt.Sprintf("%s = $%d::date", col, idx))
		} else {
			sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
		}
		args = append(args, val)
		idx++
	}

	if len(args) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "변경할 항목이 없습니다"})
	}

	args = append(args, id)
	query := fmt.Sprintf(`UPDATE assets SET %s WHERE id = $%d`, strings.Join(sets, ", "), idx)

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.pool.Exec(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	LogFromHandler(c, h.pool, "asset.update", "asset", id, nil)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Delete는 자산을 비활성화합니다 (소프트 삭제).
func (h *Assets) Delete(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `UPDATE assets SET is_active = false WHERE id = $1`, id)
	LogFromHandler(c, h.pool, "asset.delete", "asset", id, nil)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}
