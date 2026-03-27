package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Network struct {
	pool *pgxpool.Pool
}

func NewNetwork(pool *pgxpool.Pool) *Network {
	return &Network{pool: pool}
}

// ListPorts는 자산의 네트워크 포트 목록을 조회합니다.
func (h *Network) ListPorts(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, asset_id, port_name, port_index, speed_mbps, admin_status, oper_status,
		        description, vlan_id, mac_address, last_change, updated_at
		 FROM network_ports
		 WHERE asset_id = $1
		 ORDER BY port_index`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type portRow struct {
		ID          int        `json:"id"`
		AssetID     int        `json:"asset_id"`
		PortName    string     `json:"port_name"`
		PortIndex   *int       `json:"port_index"`
		SpeedMbps   *int       `json:"speed_mbps"`
		AdminStatus *string    `json:"admin_status"`
		OperStatus  *string    `json:"oper_status"`
		Description *string    `json:"description"`
		VlanID      *int       `json:"vlan_id"`
		MacAddress  *string    `json:"mac_address"`
		LastChange  *time.Time `json:"last_change"`
		UpdatedAt   time.Time  `json:"updated_at"`
	}

	var ports []portRow
	for rows.Next() {
		var p portRow
		rows.Scan(&p.ID, &p.AssetID, &p.PortName, &p.PortIndex, &p.SpeedMbps,
			&p.AdminStatus, &p.OperStatus, &p.Description, &p.VlanID,
			&p.MacAddress, &p.LastChange, &p.UpdatedAt)
		ports = append(ports, p)
	}
	if ports == nil {
		ports = []portRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"ports": ports})
}

// UpdatePort는 네트워크 포트 정보를 갱신합니다.
func (h *Network) UpdatePort(c echo.Context) error {
	var req struct {
		ID          int    `json:"id"`
		Description string `json:"description"`
		VlanID      *int   `json:"vlan_id"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.pool.Exec(ctx,
		`UPDATE network_ports SET description = NULLIF($1,''), vlan_id = $2, updated_at = now()
		 WHERE id = $3`,
		req.Description, req.VlanID, req.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// ListMacTable은 자산의 MAC 테이블을 조회합니다.
func (h *Network) ListMacTable(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, asset_id, mac_address, vlan_id, port_name, entry_type, updated_at
		 FROM device_mac_table
		 WHERE asset_id = $1
		 ORDER BY updated_at DESC`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type macRow struct {
		ID         int       `json:"id"`
		AssetID    int       `json:"asset_id"`
		MacAddress string    `json:"mac_address"`
		VlanID     *int      `json:"vlan_id"`
		PortName   *string   `json:"port_name"`
		EntryType  *string   `json:"entry_type"`
		UpdatedAt  time.Time `json:"updated_at"`
	}

	var entries []macRow
	for rows.Next() {
		var m macRow
		rows.Scan(&m.ID, &m.AssetID, &m.MacAddress, &m.VlanID, &m.PortName, &m.EntryType, &m.UpdatedAt)
		entries = append(entries, m)
	}
	if entries == nil {
		entries = []macRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"entries": entries})
}

// ListSubnets는 서브넷 목록을 조회합니다 (할당 수 포함).
func (h *Network) ListSubnets(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT s.id, s.subnet, s.name, s.vlan, s.location, s.description,
		        s.created_at, s.updated_at,
		        COALESCE(cnt.alloc_count, 0) AS alloc_count
		 FROM ip_subnets s
		 LEFT JOIN (
		     SELECT subnet_id, count(*) AS alloc_count
		     FROM ip_allocations
		     GROUP BY subnet_id
		 ) cnt ON cnt.subnet_id = s.id
		 ORDER BY s.subnet`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type subnetRow struct {
		ID          int       `json:"id"`
		Subnet      string    `json:"subnet"`
		Name        *string   `json:"name"`
		Vlan        *int      `json:"vlan"`
		Location    *string   `json:"location"`
		Description *string   `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
		UpdatedAt   time.Time `json:"updated_at"`
		AllocCount  int       `json:"alloc_count"`
	}

	var subnets []subnetRow
	for rows.Next() {
		var s subnetRow
		rows.Scan(&s.ID, &s.Subnet, &s.Name, &s.Vlan, &s.Location, &s.Description,
			&s.CreatedAt, &s.UpdatedAt, &s.AllocCount)
		subnets = append(subnets, s)
	}
	if subnets == nil {
		subnets = []subnetRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"subnets": subnets})
}

// CreateSubnet는 새 서브넷을 생성합니다.
func (h *Network) CreateSubnet(c echo.Context) error {
	var req struct {
		Subnet      string `json:"subnet"`
		Name        string `json:"name"`
		Vlan        *int   `json:"vlan"`
		Location    string `json:"location"`
		Description string `json:"description"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Subnet == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "subnet(CIDR)은 필수입니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO ip_subnets (subnet, name, vlan, location, description)
		 VALUES ($1::cidr, NULLIF($2,''), $3, NULLIF($4,''), NULLIF($5,'')) RETURNING id`,
		req.Subnet, req.Name, req.Vlan, req.Location, req.Description,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// UpdateSubnet는 서브넷 정보를 갱신합니다.
func (h *Network) UpdateSubnet(c echo.Context) error {
	var req struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		Vlan        *int   `json:"vlan"`
		Location    string `json:"location"`
		Description string `json:"description"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.pool.Exec(ctx,
		`UPDATE ip_subnets SET name = NULLIF($1,''), vlan = $2, location = NULLIF($3,''),
		        description = NULLIF($4,''), updated_at = now()
		 WHERE id = $5`,
		req.Name, req.Vlan, req.Location, req.Description, req.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// DeleteSubnet는 서브넷을 삭제합니다.
func (h *Network) DeleteSubnet(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `DELETE FROM ip_allocations WHERE subnet_id = $1`, id)
	h.pool.Exec(ctx, `DELETE FROM ip_subnets WHERE id = $1`, id)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// ListAllocations는 서브넷 내 IP 할당 목록을 조회합니다.
func (h *Network) ListAllocations(c echo.Context) error {
	subnetID, _ := strconv.Atoi(c.QueryParam("subnet_id"))
	if subnetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "subnet_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT ia.id, ia.subnet_id, ia.ip_address, ia.asset_id, ia.hostname,
		        ia.purpose, ia.status, ia.notes, ia.created_at, ia.updated_at,
		        a.name AS asset_name
		 FROM ip_allocations ia
		 LEFT JOIN assets a ON a.id = ia.asset_id
		 WHERE ia.subnet_id = $1
		 ORDER BY ia.ip_address`, subnetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type allocRow struct {
		ID        int       `json:"id"`
		SubnetID  int       `json:"subnet_id"`
		IPAddress string    `json:"ip_address"`
		AssetID   *int      `json:"asset_id"`
		Hostname  *string   `json:"hostname"`
		Purpose   *string   `json:"purpose"`
		Status    *string   `json:"status"`
		Notes     *string   `json:"notes"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
		AssetName *string   `json:"asset_name"`
	}

	var allocations []allocRow
	for rows.Next() {
		var a allocRow
		rows.Scan(&a.ID, &a.SubnetID, &a.IPAddress, &a.AssetID, &a.Hostname,
			&a.Purpose, &a.Status, &a.Notes, &a.CreatedAt, &a.UpdatedAt, &a.AssetName)
		allocations = append(allocations, a)
	}
	if allocations == nil {
		allocations = []allocRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"allocations": allocations})
}

// CreateAllocation는 새 IP 할당을 생성합니다.
func (h *Network) CreateAllocation(c echo.Context) error {
	var req struct {
		SubnetID  int    `json:"subnet_id"`
		IPAddress string `json:"ip_address"`
		AssetID   *int   `json:"asset_id"`
		Hostname  string `json:"hostname"`
		Purpose   string `json:"purpose"`
		Status    string `json:"status"`
		Notes     string `json:"notes"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.IPAddress == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "ip_address는 필수입니다"})
	}
	if req.Status == "" {
		req.Status = "allocated"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO ip_allocations (subnet_id, ip_address, asset_id, hostname, purpose, status, notes)
		 VALUES ($1, $2::inet, $3, NULLIF($4,''), NULLIF($5,''), $6, NULLIF($7,'')) RETURNING id`,
		req.SubnetID, req.IPAddress, req.AssetID, req.Hostname, req.Purpose, req.Status, req.Notes,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// UpdateAllocation는 IP 할당 정보를 갱신합니다.
func (h *Network) UpdateAllocation(c echo.Context) error {
	var body map[string]interface{}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	idVal, ok := body["id"]
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}
	id := int(idVal.(float64))

	fieldMap := map[string]string{
		"asset_id": "asset_id", "hostname": "hostname",
		"purpose": "purpose", "status": "status", "notes": "notes",
	}

	sets := []string{"updated_at = now()"}
	args := []interface{}{}
	idx := 1

	for key, col := range fieldMap {
		val, exists := body[key]
		if !exists {
			continue
		}
		sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}

	if len(args) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "변경할 항목이 없습니다"})
	}

	args = append(args, id)
	query := fmt.Sprintf(`UPDATE ip_allocations SET %s WHERE id = $%d`,
		joinSets(sets), idx)

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.pool.Exec(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// DeleteAllocation는 IP 할당을 삭제합니다.
func (h *Network) DeleteAllocation(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `DELETE FROM ip_allocations WHERE id = $1`, id)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func joinSets(sets []string) string {
	result := sets[0]
	for i := 1; i < len(sets); i++ {
		result += ", " + sets[i]
	}
	return result
}
