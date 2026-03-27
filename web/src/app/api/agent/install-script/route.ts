import { NextRequest, NextResponse } from 'next/server'

// GET /api/agent/install-script?os=linux&token=xxx
// Returns a shell/powershell script that downloads ZIP, extracts, and runs install
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const os    = searchParams.get('os') || 'linux'
  const token = searchParams.get('token') || ''

  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host  = req.headers.get('host') || 'localhost:3100'
  const serverUrl = `${proto}://${host}`

  if (os === 'windows') {
    const script = `
# Argus Agent Installer for Windows
$ErrorActionPreference = "Stop"

# Check and elevate to admin if needed
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[!] 관리자 권한이 필요합니다. UAC 승인 후 설치가 진행됩니다..." -ForegroundColor Yellow
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Invoke-WebRequest -Uri '${serverUrl}/api/agent/install-script?os=windows&token=${token}' -UseBasicParsing).Content))
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
    exit
}

$ServerUrl = "${serverUrl}"
$Token     = "${token}"
$TempDir   = "$env:TEMP\\argus-install"

Write-Host "=== Argus Agent Installer ===" -ForegroundColor Cyan
Write-Host ""

# 1) Download ZIP
Write-Host "[1/3] Agent 패키지 다운로드 중..." -ForegroundColor Yellow
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

$zipUrl  = "$ServerUrl/api/agent/download?os=windows&arch=amd64&type=baremetal"
$zipPath = "$TempDir\\argus-agent.zip"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

# 2) Extract
Write-Host "[2/3] 압축 해제 중..." -ForegroundColor Yellow
Expand-Archive -Path $zipPath -DestinationPath $TempDir -Force

# 3) Run embedded install.ps1
Write-Host "[3/3] 설치 스크립트 실행 중..." -ForegroundColor Yellow
Push-Location $TempDir
& .\\install.ps1 -Token $Token -ServerUrl $ServerUrl
Pop-Location

# Cleanup
Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "설치가 완료됐습니다!" -ForegroundColor Green
Write-Host "  서버: $ServerUrl"
Write-Host "  서비스 확인: Get-Service ArgusAgent"
`
    return new NextResponse(script, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // Linux bash script
  const script = `#!/bin/bash
set -e

# Argus Agent Installer for Linux
SERVER_URL="${serverUrl}"
TOKEN="${token}"
TEMP_DIR="/tmp/argus-install"

echo "=== Argus Agent Installer ==="
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "[!] root 권한이 필요합니다. sudo로 실행해주세요."
  exit 1
fi

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  *) echo "지원하지 않는 아키텍처: $ARCH"; exit 1 ;;
esac

# 1) Download ZIP
echo "[1/3] Agent 패키지 다운로드 중 (linux-$ARCH)..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
curl -sSL "$SERVER_URL/api/agent/download?os=linux&arch=$ARCH&type=baremetal" -o "$TEMP_DIR/argus-agent.zip"

# 2) Extract
echo "[2/3] 압축 해제 중..."
cd "$TEMP_DIR"
unzip -o argus-agent.zip

# 3) Run embedded install.sh
echo "[3/3] 설치 스크립트 실행 중..."
chmod +x install.sh
ARGUS_TOKEN="$TOKEN" ARGUS_SERVER_URL="$SERVER_URL" bash install.sh

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "설치가 완료됐습니다!"
echo "  서버: $SERVER_URL"
echo "  서비스 확인: systemctl status argus-agent"
`

  return new NextResponse(script, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
