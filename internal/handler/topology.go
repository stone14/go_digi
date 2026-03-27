package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Topology struct {
	pool *pgxpool.Pool
}

func NewTopology(pool *pgxpool.Pool) *Topology {
	return &Topology{pool: pool}
}

// GetNodes는 토폴로지 노드 목록을 조회합니다.
func (h *Topology) GetNodes(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	layer := c.QueryParam("layer")

	query := `SELECT tn.id, tn.asset_id, tn.node_type, tn.label, tn.layer,
	                 tn.pos_x, tn.pos_y, tn.metadata,
	                 a.status AS asset_status
	          FROM topology_nodes tn
	          LEFT JOIN assets a ON a.id = tn.asset_id
	          WHERE 1=1`
	args := []interface{}{}
	idx := 1

	if layer != "" {
		query += ` AND tn.layer = $1`
		args = append(args, layer)
		idx++
	}
	query += ` ORDER BY tn.id`

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type nodeRow struct {
		ID          int              `json:"id"`
		AssetID     *int             `json:"asset_id"`
		NodeType    string           `json:"node_type"`
		Label       string           `json:"label"`
		Layer       string           `json:"layer"`
		PosX        float64          `json:"pos_x"`
		PosY        float64          `json:"pos_y"`
		Metadata    *json.RawMessage `json:"metadata"`
		AssetStatus *string          `json:"asset_status"`
	}

	var nodes []nodeRow
	for rows.Next() {
		var n nodeRow
		rows.Scan(&n.ID, &n.AssetID, &n.NodeType, &n.Label, &n.Layer,
			&n.PosX, &n.PosY, &n.Metadata, &n.AssetStatus)
		nodes = append(nodes, n)
	}
	if nodes == nil {
		nodes = []nodeRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"nodes": nodes})
}

// GetEdges는 토폴로지 엣지 목록을 조회합니다.
func (h *Topology) GetEdges(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	layer := c.QueryParam("layer")

	query := `SELECT id, source_node_id, target_node_id, source_port, target_port,
	                 link_type, method, layer
	          FROM topology_edges
	          WHERE 1=1`
	args := []interface{}{}

	if layer != "" {
		query += ` AND layer = $1`
		args = append(args, layer)
	}
	query += ` ORDER BY id`

	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type edgeRow struct {
		ID           int     `json:"id"`
		SourceNodeID int     `json:"source_node_id"`
		TargetNodeID int     `json:"target_node_id"`
		SourcePort   *string `json:"source_port"`
		TargetPort   *string `json:"target_port"`
		LinkType     *string `json:"link_type"`
		Method       *string `json:"method"`
		Layer        string  `json:"layer"`
	}

	var edges []edgeRow
	for rows.Next() {
		var e edgeRow
		rows.Scan(&e.ID, &e.SourceNodeID, &e.TargetNodeID, &e.SourcePort, &e.TargetPort,
			&e.LinkType, &e.Method, &e.Layer)
		edges = append(edges, e)
	}
	if edges == nil {
		edges = []edgeRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"edges": edges})
}

// SaveLayout은 노드 위치를 일괄 저장합니다.
func (h *Topology) SaveLayout(c echo.Context) error {
	var req []struct {
		NodeID int     `json:"node_id"`
		PosX   float64 `json:"pos_x"`
		PosY   float64 `json:"pos_y"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	for _, item := range req {
		h.pool.Exec(ctx,
			`UPDATE topology_nodes SET pos_x = $1, pos_y = $2 WHERE id = $3`,
			item.PosX, item.PosY, item.NodeID)
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// CreateNode는 토폴로지 노드를 생성합니다.
func (h *Topology) CreateNode(c echo.Context) error {
	var req struct {
		AssetID  *int             `json:"asset_id"`
		NodeType string           `json:"node_type"`
		Label    string           `json:"label"`
		Layer    string           `json:"layer"`
		PosX     float64          `json:"pos_x"`
		PosY     float64          `json:"pos_y"`
		Metadata *json.RawMessage `json:"metadata"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Layer == "" {
		req.Layer = "physical"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO topology_nodes (asset_id, node_type, label, layer, pos_x, pos_y, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		req.AssetID, req.NodeType, req.Label, req.Layer, req.PosX, req.PosY, req.Metadata,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// CreateEdge는 토폴로지 엣지를 생성합니다.
func (h *Topology) CreateEdge(c echo.Context) error {
	var req struct {
		SourceNodeID int    `json:"source_node_id"`
		TargetNodeID int    `json:"target_node_id"`
		SourcePort   string `json:"source_port"`
		TargetPort   string `json:"target_port"`
		LinkType     string `json:"link_type"`
		Method       string `json:"method"`
		Layer        string `json:"layer"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Layer == "" {
		req.Layer = "physical"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var id int
	err := h.pool.QueryRow(ctx,
		`INSERT INTO topology_edges (source_node_id, target_node_id, source_port, target_port, link_type, method, layer)
		 VALUES ($1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), $7) RETURNING id`,
		req.SourceNodeID, req.TargetNodeID, req.SourcePort, req.TargetPort,
		req.LinkType, req.Method, req.Layer,
	).Scan(&id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"ok": true, "id": id})
}

// DeleteNode는 토폴로지 노드 및 관련 엣지를 삭제합니다.
func (h *Topology) DeleteNode(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// 관련 엣지 먼저 삭제
	h.pool.Exec(ctx,
		`DELETE FROM topology_edges WHERE source_node_id = $1 OR target_node_id = $1`, id)
	h.pool.Exec(ctx,
		`DELETE FROM topology_nodes WHERE id = $1`, id)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// DeleteEdge는 토폴로지 엣지를 삭제합니다.
func (h *Topology) DeleteEdge(c echo.Context) error {
	id, _ := strconv.Atoi(c.QueryParam("id"))
	if id == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `DELETE FROM topology_edges WHERE id = $1`, id)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Dependencies는 자산의 의존성 그래프를 빌드합니다 (React Flow용).
func (h *Topology) Dependencies(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// 토폴로지 엣지에서 관련 노드/엣지 조회
	nodeRows, err := h.pool.Query(ctx,
		`SELECT DISTINCT tn.id, tn.asset_id, tn.node_type, tn.label, tn.layer, tn.pos_x, tn.pos_y
		 FROM topology_nodes tn
		 WHERE tn.asset_id = $1
		    OR tn.id IN (
		        SELECT te.target_node_id FROM topology_edges te
		        JOIN topology_nodes src ON src.id = te.source_node_id
		        WHERE src.asset_id = $1
		    )
		    OR tn.id IN (
		        SELECT te.source_node_id FROM topology_edges te
		        JOIN topology_nodes tgt ON tgt.id = te.target_node_id
		        WHERE tgt.asset_id = $1
		    )`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer nodeRows.Close()

	type depNode struct {
		ID       int     `json:"id"`
		AssetID  *int    `json:"asset_id"`
		NodeType string  `json:"node_type"`
		Label    string  `json:"label"`
		Layer    string  `json:"layer"`
		PosX     float64 `json:"pos_x"`
		PosY     float64 `json:"pos_y"`
	}

	var nodes []depNode
	nodeIDs := map[int]bool{}
	for nodeRows.Next() {
		var n depNode
		nodeRows.Scan(&n.ID, &n.AssetID, &n.NodeType, &n.Label, &n.Layer, &n.PosX, &n.PosY)
		nodes = append(nodes, n)
		nodeIDs[n.ID] = true
	}

	// storage_connections에서 추가 의존성
	scRows, err := h.pool.Query(ctx,
		`SELECT sc.id, sc.asset_id, sc.storage_asset_id, a1.name AS asset_name, a2.name AS storage_name
		 FROM storage_connections sc
		 LEFT JOIN assets a1 ON a1.id = sc.asset_id
		 LEFT JOIN assets a2 ON a2.id = sc.storage_asset_id
		 WHERE sc.asset_id = $1 OR sc.storage_asset_id = $1`, assetID)
	if err == nil {
		defer scRows.Close()
		for scRows.Next() {
			var scID, scAssetID, scStorageID int
			var assetName, storageName *string
			scRows.Scan(&scID, &scAssetID, &scStorageID, &assetName, &storageName)
			// 가상 노드 추가 (storage_connections를 그래프에 포함)
			if !nodeIDs[scStorageID+100000] {
				label := "storage"
				if storageName != nil {
					label = *storageName
				}
				nodes = append(nodes, depNode{
					ID: scStorageID + 100000, AssetID: &scStorageID,
					NodeType: "storage", Label: label, Layer: "logical",
				})
				nodeIDs[scStorageID+100000] = true
			}
		}
	}

	// virtual_machines에서 추가 의존성
	vmRows, err := h.pool.Query(ctx,
		`SELECT vm.id, vm.host_asset_id, vm.vm_name
		 FROM virtual_machines vm
		 WHERE vm.host_asset_id = $1`, assetID)
	if err == nil {
		defer vmRows.Close()
		for vmRows.Next() {
			var vmID, hostID int
			var vmName *string
			vmRows.Scan(&vmID, &hostID, &vmName)
			label := "vm"
			if vmName != nil {
				label = *vmName
			}
			nodes = append(nodes, depNode{
				ID: vmID + 200000, AssetID: nil,
				NodeType: "vm", Label: label, Layer: "logical",
			})
		}
	}

	// 엣지 조회
	edgeRows, err := h.pool.Query(ctx,
		`SELECT id, source_node_id, target_node_id, link_type, layer
		 FROM topology_edges
		 WHERE source_node_id = ANY($1) OR target_node_id = ANY($1)`,
		collectNodeIDs(nodeIDs))
	if err != nil {
		// 엣지 조회 실패해도 노드는 반환
		if nodes == nil {
			nodes = []depNode{}
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"nodes": nodes, "edges": []struct{}{}})
	}
	defer edgeRows.Close()

	type depEdge struct {
		ID           int     `json:"id"`
		SourceNodeID int     `json:"source_node_id"`
		TargetNodeID int     `json:"target_node_id"`
		LinkType     *string `json:"link_type"`
		Layer        string  `json:"layer"`
	}

	var edges []depEdge
	for edgeRows.Next() {
		var e depEdge
		edgeRows.Scan(&e.ID, &e.SourceNodeID, &e.TargetNodeID, &e.LinkType, &e.Layer)
		edges = append(edges, e)
	}

	if nodes == nil {
		nodes = []depNode{}
	}
	if edges == nil {
		edges = []depEdge{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"nodes": nodes, "edges": edges})
}

func collectNodeIDs(m map[int]bool) []int {
	ids := make([]int, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	return ids
}
