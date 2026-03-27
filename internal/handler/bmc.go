package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type BMC struct {
	pool *pgxpool.Pool
}

func NewBMC(pool *pgxpool.Pool) *BMC {
	return &BMC{pool: pool}
}

// ListCredentials는 BMC 자격증명 목록을 조회합니다 (비밀번호 마스킹).
func (h *BMC) ListCredentials(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT bc.asset_id, bc.username, bc.password, bc.bmc_ip,
		        bc.created_at, bc.updated_at,
		        a.name AS asset_name
		 FROM bmc_credentials bc
		 LEFT JOIN assets a ON a.id = bc.asset_id
		 ORDER BY bc.asset_id`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type credRow struct {
		AssetID   int       `json:"asset_id"`
		Username  string    `json:"username"`
		Password  string    `json:"password"`
		BmcIP     *string   `json:"bmc_ip"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
		AssetName *string   `json:"asset_name"`
	}

	var creds []credRow
	for rows.Next() {
		var cr credRow
		rows.Scan(&cr.AssetID, &cr.Username, &cr.Password, &cr.BmcIP,
			&cr.CreatedAt, &cr.UpdatedAt, &cr.AssetName)
		// 비밀번호 마스킹
		if len(cr.Password) > 2 {
			cr.Password = cr.Password[:2] + strings.Repeat("*", len(cr.Password)-2)
		} else {
			cr.Password = "***"
		}
		creds = append(creds, cr)
	}
	if creds == nil {
		creds = []credRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"credentials": creds})
}

// SaveCredential는 BMC 자격증명을 저장합니다 (UPSERT).
func (h *BMC) SaveCredential(c echo.Context) error {
	var req struct {
		AssetID  int    `json:"asset_id"`
		Username string `json:"username"`
		Password string `json:"password"`
		BmcIP    string `json:"bmc_ip"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.AssetID == 0 || req.Username == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id, username, password는 필수입니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.pool.Exec(ctx,
		`INSERT INTO bmc_credentials (asset_id, username, password, bmc_ip)
		 VALUES ($1, $2, $3, NULLIF($4,'')::inet)
		 ON CONFLICT (asset_id) DO UPDATE
		 SET username = EXCLUDED.username, password = EXCLUDED.password,
		     bmc_ip = EXCLUDED.bmc_ip, updated_at = now()`,
		req.AssetID, req.Username, req.Password, req.BmcIP)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// DeleteCredential는 BMC 자격증명을 삭제합니다.
func (h *BMC) DeleteCredential(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	h.pool.Exec(ctx, `DELETE FROM bmc_credentials WHERE asset_id = $1`, assetID)

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// GetMetrics는 자산의 최신 BMC 메트릭을 조회합니다.
func (h *BMC) GetMetrics(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, asset_id, sensor_name, sensor_type, value, unit, status, collected_at
		 FROM bmc_metrics
		 WHERE asset_id = $1
		 ORDER BY collected_at DESC
		 LIMIT 100`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type metricRow struct {
		ID          int       `json:"id"`
		AssetID     int       `json:"asset_id"`
		SensorName  string    `json:"sensor_name"`
		SensorType  *string   `json:"sensor_type"`
		Value       *float64  `json:"value"`
		Unit        *string   `json:"unit"`
		Status      *string   `json:"status"`
		CollectedAt time.Time `json:"collected_at"`
	}

	var metrics []metricRow
	for rows.Next() {
		var m metricRow
		rows.Scan(&m.ID, &m.AssetID, &m.SensorName, &m.SensorType,
			&m.Value, &m.Unit, &m.Status, &m.CollectedAt)
		metrics = append(metrics, m)
	}
	if metrics == nil {
		metrics = []metricRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"metrics": metrics})
}

// GetHealth는 자산의 하드웨어 상태를 조회합니다.
func (h *BMC) GetHealth(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, asset_id, component, status, detail, checked_at
		 FROM hw_health
		 WHERE asset_id = $1
		 ORDER BY checked_at DESC`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type healthRow struct {
		ID        int       `json:"id"`
		AssetID   int       `json:"asset_id"`
		Component string    `json:"component"`
		Status    string    `json:"status"`
		Detail    *string   `json:"detail"`
		CheckedAt time.Time `json:"checked_at"`
	}

	var health []healthRow
	for rows.Next() {
		var h healthRow
		rows.Scan(&h.ID, &h.AssetID, &h.Component, &h.Status, &h.Detail, &h.CheckedAt)
		health = append(health, h)
	}
	if health == nil {
		health = []healthRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"health": health})
}

// GetInventory는 자산의 하드웨어 인벤토리를 조회합니다.
func (h *BMC) GetInventory(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	row := h.pool.QueryRow(ctx,
		`SELECT asset_id, cpu_model, cpu_count, cpu_cores, mem_total_gb,
		        disk_info, nic_info, bios_version, firmware_version, collected_at
		 FROM hw_inventory
		 WHERE asset_id = $1
		 ORDER BY collected_at DESC LIMIT 1`, assetID)

	var inv struct {
		AssetID         int              `json:"asset_id"`
		CPUModel        *string          `json:"cpu_model"`
		CPUCount        *int             `json:"cpu_count"`
		CPUCores        *int             `json:"cpu_cores"`
		MemTotalGB      *float64         `json:"mem_total_gb"`
		DiskInfo        *json.RawMessage `json:"disk_info"`
		NicInfo         *json.RawMessage `json:"nic_info"`
		BIOSVersion     *string          `json:"bios_version"`
		FirmwareVersion *string          `json:"firmware_version"`
		CollectedAt     time.Time        `json:"collected_at"`
	}

	err := row.Scan(&inv.AssetID, &inv.CPUModel, &inv.CPUCount, &inv.CPUCores,
		&inv.MemTotalGB, &inv.DiskInfo, &inv.NicInfo,
		&inv.BIOSVersion, &inv.FirmwareVersion, &inv.CollectedAt)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "인벤토리를 찾을 수 없습니다"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"inventory": inv})
}

// GetSEL는 자산의 BMC SEL(System Event Log) 이벤트를 조회합니다.
func (h *BMC) GetSEL(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, asset_id, record_id, event_type, sensor_name, severity, message, event_at
		 FROM bmc_sel
		 WHERE asset_id = $1
		 ORDER BY event_at DESC
		 LIMIT $2`, assetID, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type selRow struct {
		ID         int       `json:"id"`
		AssetID    int       `json:"asset_id"`
		RecordID   *int      `json:"record_id"`
		EventType  *string   `json:"event_type"`
		SensorName *string   `json:"sensor_name"`
		Severity   *string   `json:"severity"`
		Message    *string   `json:"message"`
		EventAt    time.Time `json:"event_at"`
	}

	var events []selRow
	for rows.Next() {
		var e selRow
		rows.Scan(&e.ID, &e.AssetID, &e.RecordID, &e.EventType,
			&e.SensorName, &e.Severity, &e.Message, &e.EventAt)
		events = append(events, e)
	}
	if events == nil {
		events = []selRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"events": events})
}

// Collect는 특정 자산의 BMC 즉시 수집을 트리거합니다.
func (h *BMC) Collect(c echo.Context) error {
	var req struct {
		AssetID int `json:"asset_id"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.AssetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// bmc_collect_queue 테이블에 수집 요청 삽입
	_, err := h.pool.Exec(ctx,
		`INSERT INTO bmc_collect_queue (asset_id, requested_at)
		 VALUES ($1, now())
		 ON CONFLICT (asset_id) DO UPDATE SET requested_at = now()`,
		req.AssetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":      true,
		"message": "BMC 수집 요청이 큐에 추가되었습니다",
	})
}
