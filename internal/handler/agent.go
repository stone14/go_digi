package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Agent struct {
	pool *pgxpool.Pool
}

func NewAgent(pool *pgxpool.Pool) *Agent {
	return &Agent{pool: pool}
}

// validateAgentToken은 Agent 토큰을 검증합니다.
func validateAgentToken(ctx context.Context, pool *pgxpool.Pool, assetID int, token string) bool {
	var count int
	pool.QueryRow(ctx,
		`SELECT count(*) FROM agent_tokens
		 WHERE token = $1 AND revoked = false
		 AND (asset_id = $2 OR asset_id IS NULL)`, token, assetID,
	).Scan(&count)
	return count > 0
}

type registerReq struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip_address"`
	OS       string `json:"os"`
	OSVer    string `json:"os_version"`
	Arch     string `json:"arch"`
	Version  string `json:"agent_version"`
	NodeType string `json:"node_type"`
}

// Register는 Agent가 서버에 등록하는 API입니다.
func (h *Agent) Register(c echo.Context) error {
	var req registerReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	if req.Token == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "토큰이 필요합니다"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// 토큰 조회
	var tokenID int
	var assetID *int
	err := h.pool.QueryRow(ctx,
		`SELECT id, asset_id FROM agent_tokens WHERE token = $1 AND revoked = false`, req.Token,
	).Scan(&tokenID, &assetID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "유효하지 않은 토큰"})
	}

	// 자산이 연결되지 않은 경우 자동 생성
	if assetID == nil {
		name := req.Hostname
		if name == "" {
			name = req.IP
		}
		var newID int
		err := h.pool.QueryRow(ctx,
			`INSERT INTO assets (name, hostname, ip_address, type, os, os_version, arch,
			        agent_version, node_type, status, registration_source)
			 VALUES ($1, $2, NULLIF($3,'')::inet, 'server', NULLIF($4,''), NULLIF($5,''), NULLIF($6,''),
			         NULLIF($7,''), NULLIF($8,''), 'online', 'agent')
			 RETURNING id`,
			name, req.Hostname, req.IP, req.OS, req.OSVer, req.Arch, req.Version, req.NodeType,
		).Scan(&newID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "자산 생성 실패: " + err.Error()})
		}
		assetID = &newID

		// 토큰에 자산 연결
		h.pool.Exec(ctx, `UPDATE agent_tokens SET asset_id = $1 WHERE id = $2`, newID, tokenID)
	} else {
		// 기존 자산 업데이트
		h.pool.Exec(ctx,
			`UPDATE assets SET status = 'online', last_seen = now(),
			        hostname = COALESCE(NULLIF($2,''), hostname),
			        ip_address = COALESCE(NULLIF($3,'')::inet, ip_address),
			        os = COALESCE(NULLIF($4,''), os),
			        os_version = COALESCE(NULLIF($5,''), os_version),
			        arch = COALESCE(NULLIF($6,''), arch),
			        agent_version = COALESCE(NULLIF($7,''), agent_version),
			        node_type = COALESCE(NULLIF($8,''), node_type)
			 WHERE id = $1`,
			*assetID, req.Hostname, req.IP, req.OS, req.OSVer, req.Arch, req.Version, req.NodeType)
	}

	// 수집 간격 설정 조회
	collectInterval := 60
	heartbeatInterval := 60
	var val string
	if err := h.pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'agent_check_interval'`).Scan(&val); err == nil {
		if v, err := strconv.Atoi(val); err == nil {
			heartbeatInterval = v * 60
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":                 true,
		"asset_id":           *assetID,
		"collect_interval":   collectInterval,
		"heartbeat_interval": heartbeatInterval,
	})
}

// PullRegister는 Pull Agent 등록 API입니다.
func (h *Agent) PullRegister(c echo.Context) error {
	var req struct {
		Token    string `json:"token"`
		Hostname string `json:"hostname"`
		IP       string `json:"ip_address"`
		OS       string `json:"os"`
		Port     int    `json:"port"`
		NodeType string `json:"node_type"`
		Version  string `json:"agent_version"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	var tokenID int
	var assetID *int
	err := h.pool.QueryRow(ctx,
		`SELECT id, asset_id FROM agent_tokens WHERE token = $1 AND revoked = false`, req.Token,
	).Scan(&tokenID, &assetID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "유효하지 않은 토큰"})
	}

	agentURL := fmt.Sprintf("http://%s:%d", req.IP, req.Port)

	if assetID == nil {
		name := req.Hostname
		if name == "" {
			name = req.IP
		}
		var newID int
		err := h.pool.QueryRow(ctx,
			`INSERT INTO assets (name, hostname, ip_address, type, os, agent_url, agent_version, node_type, status, registration_source)
			 VALUES ($1, $2, NULLIF($3,'')::inet, 'server', NULLIF($4,''), $5, NULLIF($6,''), NULLIF($7,''), 'online', 'agent')
			 RETURNING id`,
			name, req.Hostname, req.IP, req.OS, agentURL, req.Version, req.NodeType,
		).Scan(&newID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		assetID = &newID
		h.pool.Exec(ctx, `UPDATE agent_tokens SET asset_id = $1 WHERE id = $2`, newID, tokenID)
	} else {
		h.pool.Exec(ctx,
			`UPDATE assets SET status = 'online', last_seen = now(), agent_url = $2 WHERE id = $1`,
			*assetID, agentURL)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"ok": true, "asset_id": *assetID})
}

// Heartbeat는 Agent keepalive API입니다.
func (h *Agent) Heartbeat(c echo.Context) error {
	var req struct {
		AssetID int    `json:"asset_id"`
		Token   string `json:"token"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	if !validateAgentToken(ctx, h.pool, req.AssetID, req.Token) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "유효하지 않은 토큰"})
	}

	h.pool.Exec(ctx, `UPDATE assets SET status = 'online', last_seen = now() WHERE id = $1`, req.AssetID)
	h.pool.Exec(ctx, `UPDATE agent_tokens SET last_seen = now() WHERE token = $1`, req.Token)

	return c.JSON(http.StatusOK, map[string]interface{}{"ok": true, "ts": time.Now().Format(time.RFC3339)})
}

// GetServiceChecks는 자산에 할당된 서비스 체크 목록을 반환합니다.
func (h *Agent) GetServiceChecks(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	token := c.QueryParam("token")

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	if !validateAgentToken(ctx, h.pool, assetID, token) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "유효하지 않은 토큰"})
	}

	rows, err := h.pool.Query(ctx,
		`SELECT id, name, type, target, interval_s, timeout_s, expected_code, expected_body
		 FROM service_checks WHERE asset_id = $1 AND is_active = true`, assetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type checkRow struct {
		ID           int     `json:"id"`
		Name         string  `json:"name"`
		Type         string  `json:"type"`
		Target       string  `json:"target"`
		IntervalS    int     `json:"interval_s"`
		TimeoutS     int     `json:"timeout_s"`
		ExpectedCode *int    `json:"expected_code"`
		ExpectedBody *string `json:"expected_body"`
	}

	var checks []checkRow
	for rows.Next() {
		var ch checkRow
		rows.Scan(&ch.ID, &ch.Name, &ch.Type, &ch.Target, &ch.IntervalS, &ch.TimeoutS, &ch.ExpectedCode, &ch.ExpectedBody)
		checks = append(checks, ch)
	}
	if checks == nil {
		checks = []checkRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"checks": checks})
}

// PostServiceCheckResults는 서비스 체크 결과를 저장합니다.
func (h *Agent) PostServiceCheckResults(c echo.Context) error {
	var req struct {
		AssetID int    `json:"asset_id"`
		Token   string `json:"token"`
		Results []struct {
			CheckID    int    `json:"check_id"`
			Status     string `json:"status"`
			ResponseMs int    `json:"response_ms"`
			Message    string `json:"message"`
		} `json:"results"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "잘못된 요청"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	if !validateAgentToken(ctx, h.pool, req.AssetID, req.Token) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "유효하지 않은 토큰"})
	}

	for _, r := range req.Results {
		h.pool.Exec(ctx,
			`INSERT INTO service_check_results (check_id, checked_at, status, response_ms, message)
			 VALUES ($1, now(), $2, $3, $4)`,
			r.CheckID, r.Status, r.ResponseMs, r.Message)
	}

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// InstallScript는 Agent 설치 스크립트를 반환합니다.
func (h *Agent) InstallScript(c echo.Context) error {
	osType := c.QueryParam("os")
	if osType == "" {
		osType = "linux"
	}
	token := c.QueryParam("token")

	proto := c.Request().Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
	}
	host := c.Request().Header.Get("Host")
	if host == "" {
		host = "localhost:3200"
	}
	serverURL := fmt.Sprintf("%s://%s", proto, host)

	if osType == "windows" {
		script := fmt.Sprintf(`
# Digicap Agent Installer for Windows
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[!] 관리자 권한이 필요합니다. UAC 승인 후 설치가 진행됩니다..." -ForegroundColor Yellow
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Invoke-WebRequest -Uri '%s/api/agent/install-script?os=windows&token=%s' -UseBasicParsing).Content))
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
    exit
}

$ServerUrl = "%s"
$Token     = "%s"
$TempDir   = "$env:TEMP\\digicap-install"

Write-Host "=== Digicap Agent Installer ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Agent 패키지 다운로드 중..." -ForegroundColor Yellow
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

$zipUrl  = "$ServerUrl/api/agent/download?os=windows&arch=amd64&type=baremetal"
$zipPath = "$TempDir\\digicap-agent.zip"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Host "[2/3] 압축 해제 중..." -ForegroundColor Yellow
Expand-Archive -Path $zipPath -DestinationPath $TempDir -Force

Write-Host "[3/3] 설치 스크립트 실행 중..." -ForegroundColor Yellow
Push-Location $TempDir
& .\\install.ps1 -Token $Token -ServerUrl $ServerUrl
Pop-Location

Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "설치가 완료됐습니다!" -ForegroundColor Green
Write-Host "  서버: $ServerUrl"
Write-Host "  서비스 확인: Get-Service DigicapAgent"
`, serverURL, token, serverURL, token)

		return c.String(http.StatusOK, script)
	}

	// Linux
	script := fmt.Sprintf(`#!/bin/bash
set -e

# Digicap Agent Installer for Linux
SERVER_URL="%s"
TOKEN="%s"
TEMP_DIR="/tmp/digicap-install"

echo "=== Digicap Agent Installer ==="
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "[!] root 권한이 필요합니다. sudo로 실행해주세요."
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  *) echo "지원하지 않는 아키텍처: $ARCH"; exit 1 ;;
esac

echo "[1/3] Agent 패키지 다운로드 중 (linux-$ARCH)..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
curl -sSL "$SERVER_URL/api/agent/download?os=linux&arch=$ARCH&type=baremetal" -o "$TEMP_DIR/digicap-agent.zip"

echo "[2/3] 압축 해제 중..."
cd "$TEMP_DIR"
unzip -o digicap-agent.zip

echo "[3/3] 설치 스크립트 실행 중..."
chmod +x install.sh
DIGICAP_TOKEN="$TOKEN" DIGICAP_SERVER_URL="$SERVER_URL" bash install.sh

rm -rf "$TEMP_DIR"

echo ""
echo "설치가 완료됐습니다!"
echo "  서버: $SERVER_URL"
echo "  서비스 확인: systemctl status digicap-agent"
`, serverURL, token)

	return c.String(http.StatusOK, script)
}

// Download는 Agent ZIP 패키지를 다운로드합니다.
func (h *Agent) Download(c echo.Context) error {
	osType := c.QueryParam("os")
	arch := c.QueryParam("arch")
	agentType := c.QueryParam("type")

	if !contains([]string{"linux", "windows"}, osType) {
		osType = "linux"
	}
	if !contains([]string{"amd64", "arm64"}, arch) {
		arch = "amd64"
	}
	if !contains([]string{"baremetal", "vm", "cloud"}, agentType) {
		agentType = "baremetal"
	}

	filename := fmt.Sprintf("digicap-agent-%s-%s-%s.zip", agentType, osType, arch)

	// dist/ 디렉토리에서 파일 서빙
	data, err := os.ReadFile("dist/" + filename)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "파일을 찾을 수 없습니다: " + filename})
	}

	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Response().Header().Set("Content-Length", strconv.Itoa(len(data)))
	return c.Blob(http.StatusOK, "application/zip", data)
}

// ServerLogs는 서버 로그를 조회합니다.
func (h *Agent) ServerLogs(c echo.Context) error {
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
		`SELECT id, collected_at, level, source, message
		 FROM server_logs WHERE asset_id = $1
		 ORDER BY collected_at DESC LIMIT $2`, assetID, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type logRow struct {
		ID          int64     `json:"id"`
		CollectedAt time.Time `json:"collected_at"`
		Level       *string   `json:"level"`
		Source      *string   `json:"source"`
		Message     *string   `json:"message"`
	}

	var logs []logRow
	for rows.Next() {
		var l logRow
		rows.Scan(&l.ID, &l.CollectedAt, &l.Level, &l.Source, &l.Message)
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []logRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"logs": logs})
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// GenerateToken은 랜덤 hex 토큰을 생성합니다.
func GenerateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// unused import guard
var _ = strings.TrimSpace
