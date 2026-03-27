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

type Metrics struct {
	pool *pgxpool.Pool
}

func NewMetrics(pool *pgxpool.Pool) *Metrics {
	return &Metrics{pool: pool}
}

type metricPayload struct {
	AssetID      int     `json:"asset_id"`
	Token        string  `json:"token"`
	CollectedAt  string  `json:"collected_at"`
	CPUUsage     float64 `json:"cpu_usage"`
	MemUsage     float64 `json:"mem_usage"`
	MemTotalMB   int64   `json:"mem_total_mb"`
	MemUsedMB    int64   `json:"mem_used_mb"`
	DiskReadBps  int64   `json:"disk_read_bps"`
	DiskWriteBps int64   `json:"disk_write_bps"`
	DiskUsagePct float64 `json:"disk_usage_pct"`
	NetRxBps     int64   `json:"net_rx_bps"`
	NetTxBps     int64   `json:"net_tx_bps"`
	LoadAvg1m    float64 `json:"load_avg_1m"`
	ProcessCount int     `json:"process_count"`
	// 선택적 데이터
	DiskMetrics []diskMetricItem `json:"disk_metrics,omitempty"`
	MacAddrs    []macAddrItem    `json:"mac_addresses,omitempty"`
	WwnEntries  []wwnItem        `json:"wwn_entries,omitempty"`
	DiskSmart   []smartItem      `json:"disk_smart,omitempty"`
	ServerLogs  []serverLogItem  `json:"server_logs,omitempty"`
}

type diskMetricItem struct {
	MountPoint string  `json:"mount_point"`
	Device     string  `json:"device"`
	Filesystem string  `json:"filesystem"`
	TotalGB    float64 `json:"total_gb"`
	UsedGB     float64 `json:"used_gb"`
}

type macAddrItem struct {
	Mac       string `json:"mac"`
	Interface string `json:"interface"`
	IP        string `json:"ip_address"`
}

type wwnItem struct {
	WWN      string `json:"wwn"`
	WwnType  string `json:"wwn_type"`
	PortName string `json:"port_name"`
}

type smartItem struct {
	Device             string `json:"device"`
	Model              string `json:"model"`
	Serial             string `json:"serial"`
	HealthStatus       string `json:"health_status"`
	TemperatureC       int    `json:"temperature_c"`
	ReallocatedSectors int    `json:"reallocated_sectors"`
	PendingSectors     int    `json:"pending_sectors"`
	Uncorrectable      int    `json:"uncorrectable"`
	PowerOnHours       int    `json:"power_on_hours"`
}

type serverLogItem struct {
	Level   string `json:"level"`
	Source  string `json:"source"`
	Message string `json:"message"`
}

// Ingest는 Agent에서 전송한 메트릭을 저장합니다.
func (h *Metrics) Ingest(c echo.Context) error {
	var req metricPayload
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// 토큰 검증
	if !validateAgentToken(ctx, h.pool, req.AssetID, req.Token) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "유효하지 않은 토큰"})
	}

	collectedAt := time.Now()
	if req.CollectedAt != "" {
		if t, err := time.Parse(time.RFC3339, req.CollectedAt); err == nil {
			collectedAt = t
		}
	}

	// 메트릭 저장
	h.pool.Exec(ctx,
		`INSERT INTO metrics (asset_id, collected_at, cpu_usage, mem_usage, mem_total_mb, mem_used_mb,
		        disk_read_bps, disk_write_bps, disk_usage_pct, net_rx_bps, net_tx_bps,
		        load_avg_1m, process_count)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		req.AssetID, collectedAt, req.CPUUsage, req.MemUsage, req.MemTotalMB, req.MemUsedMB,
		req.DiskReadBps, req.DiskWriteBps, req.DiskUsagePct, req.NetRxBps, req.NetTxBps,
		req.LoadAvg1m, req.ProcessCount)

	// 자산 상태 업데이트
	h.pool.Exec(ctx,
		`UPDATE assets SET status = 'online', last_seen = now() WHERE id = $1`, req.AssetID)

	// 디스크 메트릭
	for _, d := range req.DiskMetrics {
		h.pool.Exec(ctx,
			`INSERT INTO disk_metrics (asset_id, mount_point, device, filesystem, total_gb, used_gb)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			req.AssetID, d.MountPoint, d.Device, d.Filesystem, d.TotalGB, d.UsedGB)
	}

	// MAC 주소
	for _, m := range req.MacAddrs {
		h.pool.Exec(ctx,
			`INSERT INTO mac_addresses (asset_id, mac, interface, ip_address)
			 VALUES ($1, $2::macaddr, $3, NULLIF($4,'')::inet)
			 ON CONFLICT (asset_id, mac) DO UPDATE SET last_seen = now(), ip_address = NULLIF($4,'')::inet`,
			req.AssetID, m.Mac, m.Interface, m.IP)
	}

	// WWN
	for _, w := range req.WwnEntries {
		h.pool.Exec(ctx,
			`INSERT INTO wwn_entries (asset_id, wwn, wwn_type, port_name)
			 VALUES ($1,$2,$3,$4)
			 ON CONFLICT (asset_id, wwn) DO UPDATE SET last_seen = now()`,
			req.AssetID, w.WWN, w.WwnType, w.PortName)
	}

	// SMART
	for _, s := range req.DiskSmart {
		h.pool.Exec(ctx,
			`INSERT INTO disk_smart (asset_id, device, model, serial, health_status,
			        temperature_c, reallocated_sectors, pending_sectors, uncorrectable, power_on_hours)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			req.AssetID, s.Device, s.Model, s.Serial, s.HealthStatus,
			s.TemperatureC, s.ReallocatedSectors, s.PendingSectors, s.Uncorrectable, s.PowerOnHours)
	}

	// 서버 로그
	for _, l := range req.ServerLogs {
		h.pool.Exec(ctx,
			`INSERT INTO server_logs (asset_id, collected_at, level, source, message)
			 VALUES ($1,$2,$3,$4,$5)`,
			req.AssetID, collectedAt, l.Level, l.Source, l.Message)
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Query는 자산의 메트릭을 조회합니다.
func (h *Metrics) Query(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	rangeStr := c.QueryParam("range")
	if rangeStr == "" {
		rangeStr = "1h"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// 시간 범위 파싱
	var since time.Time
	var table string
	switch rangeStr {
	case "30m":
		since = time.Now().Add(-30 * time.Minute)
		table = "metrics"
	case "1h":
		since = time.Now().Add(-1 * time.Hour)
		table = "metrics"
	case "6h":
		since = time.Now().Add(-6 * time.Hour)
		table = "metrics"
	case "24h":
		since = time.Now().Add(-24 * time.Hour)
		table = "metrics_5m"
	case "7d":
		since = time.Now().Add(-7 * 24 * time.Hour)
		table = "metrics_5m"
	case "30d":
		since = time.Now().Add(-30 * 24 * time.Hour)
		table = "metrics_1h"
	default:
		since = time.Now().Add(-1 * time.Hour)
		table = "metrics"
	}

	var query string
	if table == "metrics" {
		query = fmt.Sprintf(
			`SELECT collected_at,
			        cpu_usage AS cpu_pct, mem_usage AS mem_pct,
			        mem_total_mb, mem_used_mb,
			        disk_read_bps, disk_write_bps, disk_usage_pct AS disk_pct,
			        net_rx_bps, net_tx_bps, load_avg_1m, process_count
			 FROM %s WHERE asset_id = $1 AND collected_at >= $2
			 ORDER BY collected_at ASC`, table)
	} else {
		query = fmt.Sprintf(
			`SELECT bucket AS collected_at,
			        cpu_avg AS cpu_pct, mem_avg AS mem_pct,
			        NULL::bigint AS mem_total_mb, NULL::bigint AS mem_used_mb,
			        disk_read_avg AS disk_read_bps, disk_write_avg AS disk_write_bps,
			        NULL::float AS disk_pct,
			        net_rx_avg AS net_rx_bps, net_tx_avg AS net_tx_bps,
			        NULL::float AS load_avg_1m, sample_count AS process_count
			 FROM %s WHERE asset_id = $1 AND bucket >= $2
			 ORDER BY bucket ASC`, table)
	}

	rows, err := h.pool.Query(ctx, query, assetID, since)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type metricRow struct {
		CollectedAt  time.Time `json:"collected_at"`
		CpuPct       *float64  `json:"cpu_pct"`
		MemPct       *float64  `json:"mem_pct"`
		MemTotalMB   *int64    `json:"mem_total_mb"`
		MemUsedMB    *int64    `json:"mem_used_mb"`
		DiskReadBps  *int64    `json:"disk_read_bps"`
		DiskWriteBps *int64    `json:"disk_write_bps"`
		DiskPct      *float64  `json:"disk_pct"`
		NetRxBps     *int64    `json:"net_rx_bps"`
		NetTxBps     *int64    `json:"net_tx_bps"`
		LoadAvg1m    *float64  `json:"load_avg_1m"`
		ProcessCount *int      `json:"process_count"`
	}

	var metrics []metricRow
	for rows.Next() {
		var m metricRow
		if err := rows.Scan(&m.CollectedAt, &m.CpuPct, &m.MemPct,
			&m.MemTotalMB, &m.MemUsedMB, &m.DiskReadBps, &m.DiskWriteBps,
			&m.DiskPct, &m.NetRxBps, &m.NetTxBps, &m.LoadAvg1m, &m.ProcessCount); err != nil {
			continue
		}
		metrics = append(metrics, m)
	}
	if metrics == nil {
		metrics = []metricRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"metrics": metrics, "range": rangeStr})
}

// DiskMetrics는 디스크 마운트포인트별 최신 메트릭을 조회합니다.
func (h *Metrics) DiskMetrics(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id가 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT DISTINCT ON (mount_point)
		        mount_point, device, filesystem, total_gb, used_gb, collected_at
		 FROM disk_metrics WHERE asset_id = $1
		 ORDER BY mount_point, collected_at DESC`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type diskRow struct {
		MountPoint  string    `json:"mount_point"`
		Device      *string   `json:"device"`
		Filesystem  *string   `json:"filesystem"`
		TotalGB     *float64  `json:"total_gb"`
		UsedGB      *float64  `json:"used_gb"`
		CollectedAt time.Time `json:"collected_at"`
	}

	var disks []diskRow
	for rows.Next() {
		var d diskRow
		rows.Scan(&d.MountPoint, &d.Device, &d.Filesystem, &d.TotalGB, &d.UsedGB, &d.CollectedAt)
		disks = append(disks, d)
	}
	if disks == nil {
		disks = []diskRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"disks": disks})
}
