# Argus Agent 설치 가이드

Argus는 두 가지 방식의 에이전트를 지원합니다.

| 구분 | 방식 | 위치 | 용도 |
|------|------|------|------|
| **Push Agent** | 에이전트 → Argus (주기 전송) | `agent/` | 기본 메트릭 수집 |
| **Pull Agent** | Argus → 에이전트 (서버 요청) | `agent-pull/` | 선택적 수집, 앱 로그, GC 분석 |

---

## 1. Push Agent

서버에 설치되어 주기적으로 메트릭을 Argus로 전송하는 기본 에이전트입니다.

### 수집 항목

- CPU, 메모리, 디스크 I/O, 네트워크 I/O
- Load Average (Linux)
- SMART 디스크 건강 상태 (`smart_enabled: true`, 베어메탈 전용)
- FC HBA/Target WWN (`fc_enabled: true`, Linux 베어메탈 전용)
- MAC 주소 + ARP 캐시
- 서버 로그 파일 tail (Linux: `/var/log/*` / Windows: Event Log)

### 사전 준비

1. Argus 대시보드 → **설정 > Agent 관리** → **토큰 발급** 클릭
2. 발급된 64자 hex 토큰 복사

### Linux 설치 (배포 패키지 사용)

```bash
# 1. 패키지 압축 해제 (베어메탈 예시)
unzip argus-agent-baremetal-linux-amd64.zip
cd argus-agent-baremetal-linux-amd64/

# 2. 설치 (토큰 및 서버 주소 입력 프롬프트 표시)
sudo bash install.sh
# → "Argus 토큰: " 입력
# → "Argus 서버 주소 [http://argus-server:3100]: " 입력 (Enter = 기본값)
# → 서비스 자동 등록 및 시작

# 상태 확인
systemctl status argus-agent
journalctl -u argus-agent -f
```

**환경변수로 사전 설정 (자동화/CI 환경):**
```bash
sudo ARGUS_TOKEN="abc123..." ARGUS_SERVER_URL="http://192.168.0.10:3100" bash install.sh
```

### Windows 설치 (배포 패키지 사용)

관리자 권한 PowerShell에서 실행합니다.

```powershell
# 1. 패키지 압축 해제
Expand-Archive argus-agent-vm-windows-amd64.zip -DestinationPath .\argus-agent-pkg
cd argus-agent-pkg

# 2. 설치 (토큰 필수, 서버 주소는 선택)
.\install.ps1 -Token "발급된_64자_토큰"
# 서버 주소 지정 시:
.\install.ps1 -Token "발급된_64자_토큰" -ServerUrl "http://192.168.0.10:3100"
```

`install.ps1`이 자동으로:
- `C:\argus-agent\` 디렉토리 생성 및 파일 복사
- `agent.json`에 토큰/서버 주소 기록
- `ArgusAgent` Windows 서비스 등록 및 시작

**서비스 상태 확인:**
```powershell
Get-Service ArgusAgent
# 로그: C:\Windows\System32\winevt\Logs\  (이벤트 뷰어 > 응용 프로그램)
```

### 설정 파일 형식 (agent.json)

Push Agent는 JSON 형식 설정 파일을 사용합니다.

```json
{
  "server_url": "http://argus-server:3100",
  "token": "발급된_토큰",
  "collect_interval": 60000000000,
  "heartbeat_interval": 30000000000,
  "log_paths": ["/var/log/syslog", "/var/log/messages", "/var/log/auth.log"],
  "log_max_lines": 500,
  "smart_enabled": true,
  "fc_enabled": true
}
```

**Windows log_paths (Event Log 이름):**
```json
"log_paths": ["Application", "System", "Security"]
```

> Linux 경로(`/var/log/syslog` 등)는 Windows에서 동작하지 않습니다.
> 배포 패키지의 Windows ZIP에는 Event Log 경로가 자동으로 설정되어 있습니다.

| 필드 | 단위 | 기본값 |
|------|------|-------|
| `collect_interval` | 나노초 | 60000000000 (60초) |
| `heartbeat_interval` | 나노초 | 30000000000 (30초) |
| `smart_enabled` | bool | baremetal: true / vm: false |
| `fc_enabled` | bool | baremetal Linux: true / 나머지: false |

**환경변수 오버라이드:**
```bash
export ARGUS_SERVER_URL="http://argus-server:3100"
export ARGUS_TOKEN="your-token-here"
```

### 소스 빌드

```bash
cd agent/
go build -o argus-agent ./cmd/agent/
# 크로스 컴파일
GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -o argus-agent-linux-amd64  ./cmd/agent/
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o argus-agent.exe          ./cmd/agent/
```

---

## 2. Pull Agent

Argus 서버가 필요할 때 에이전트에 HTTP 요청을 보내 데이터를 수집하는 방식입니다.

### 추가 수집 항목 (Push Agent 대비)

- 애플리케이션 로그 (임의 파일 경로)
  - **Java GC 로그** 구조화 파싱 (JDK 8 / JDK 9+ 양쪽 포맷)
  - JSON 라인 포맷 로그 자동 파싱
  - 일반 텍스트 로그
- AWS/Azure 인스턴스 메타데이터 (cloud 타입)
- node_type 자동 감지 (AWS IMDS → Azure IMDS → DMI → baremetal)

### node_type 구분

| 타입 | 설명 | SMART | FC/WWN |
|------|------|-------|--------|
| `baremetal` | 물리 서버 | ✅ | ✅ (Linux) |
| `vm` | 가상 머신 (VMware, KVM 등) | ❌ | ❌ |
| `cloud` | AWS EC2 / Azure VM | ❌ | ❌ |

### 설치 패키지 빌드

**Windows (PowerShell):**
```powershell
# 프로젝트 루트에서 실행
.\build-agents.ps1              # Push + Pull 전체
.\build-agents.ps1 -Target push  # Push Agent만
.\build-agents.ps1 -Target pull  # Pull Agent만
```

**Linux (Makefile):**
```bash
cd agent-pull/
make dist              # 전체 타입×플랫폼
make dist-baremetal
make dist-vm
make dist-cloud
```

생성 결과 (`dist/`):
```
argus-agent-baremetal-linux-amd64.zip
argus-agent-baremetal-linux-arm64.zip
argus-agent-baremetal-windows-amd64.zip
argus-agent-vm-linux-amd64.zip
argus-agent-vm-linux-arm64.zip
argus-agent-vm-windows-amd64.zip
argus-pull-agent-baremetal-linux-amd64.zip
argus-pull-agent-baremetal-linux-arm64.zip
argus-pull-agent-baremetal-windows-amd64.zip
argus-pull-agent-vm-linux-amd64.zip
argus-pull-agent-vm-linux-arm64.zip
argus-pull-agent-vm-windows-amd64.zip
argus-pull-agent-cloud-linux-amd64.zip
argus-pull-agent-cloud-linux-arm64.zip
```

### Linux 설치 (배포 패키지 사용)

설치 스크립트가 **token과 서버 주소를 대화식으로 입력**받고 서비스를 자동 시작합니다.

```bash
# 1. 패키지 압축 해제
unzip argus-pull-agent-baremetal-linux-amd64.zip
cd argus-pull-agent-baremetal-linux-amd64/

# 2. 설치 (토큰 입력 프롬프트 표시)
sudo bash install.sh
# → "Argus 토큰: " 입력
# → "Argus 서버 주소 [http://argus-server:3100]: " 입력 (Enter = 기본값)
# → 서비스 자동 등록 및 시작

# 상태 확인
systemctl status agnet
journalctl -u agnet -f
```

**환경변수로 사전 설정 (자동화/CI 환경):**
```bash
sudo AGNET_TOKEN="abc123..." AGNET_ARGUS_URL="http://192.168.0.10:3100" bash install.sh
```

### Windows 설치 (배포 패키지 사용)

관리자 권한 PowerShell에서 실행합니다.

```powershell
# 1. 패키지 압축 해제
Expand-Archive argus-pull-agent-vm-windows-amd64.zip -DestinationPath .\argus-pull-pkg
cd argus-pull-pkg

# 2. 설치 (토큰 필수, 서버 주소는 선택)
.\install.ps1 -Token "발급된_64자_토큰"
# 서버 주소 지정 시:
.\install.ps1 -Token "발급된_64자_토큰" -ArgusUrl "http://192.168.0.10:3100"
```

**서비스 상태 확인:**
```powershell
Get-Service ArgusPullAgent
```

### 설정 파일 (agent.yaml)

```yaml
# Argus 서버 연동
argus_url: "http://argus-server:3100"  # 최초 등록 시 1회만 사용
token: "발급된_토큰"                    # 필수 — 비어 있으면 시작 불가
listen_port: 9182                       # Pull Agent HTTP 서버 포트

# 노드 타입 (auto: 자동 감지)
node_type: "auto"   # auto | baremetal | vm | cloud

# 시스템 로그
# Linux:
log_paths:
  - /var/log/syslog
  - /var/log/auth.log
# Windows:
# log_paths:
#   - Application
#   - System
#   - Security
log_max_lines: 500

# 애플리케이션 로그 (선택)
app_logs:
  - label: "java-gc"
    path: /opt/app/logs/gc.log
    type: "gc"          # gc | text | json
  - label: "app"
    path: /opt/app/logs/app.log
    type: "json"
app_log_max_lines: 200

# 기능 토글 (node_type이 baremetal이 아니면 자동 비활성)
smart_enabled: true
fc_enabled: true
```

**환경변수 오버라이드:**
```bash
export AGNET_ARGUS_URL="http://argus-server:3100"
export AGNET_TOKEN="your-token-here"
export AGNET_PORT="9182"
export AGNET_NODE_TYPE="baremetal"  # auto | baremetal | vm | cloud
```

### HTTP 엔드포인트

Pull Agent는 포트 9182에서 HTTP 서버로 동작합니다.
모든 요청에 `Authorization: Bearer <token>` 헤더 필요.

```bash
TOKEN="발급된_토큰"
BASE="http://localhost:9182"

curl -H "Authorization: Bearer $TOKEN" $BASE/health
curl -H "Authorization: Bearer $TOKEN" $BASE/metrics
curl -H "Authorization: Bearer $TOKEN" $BASE/smart           # 베어메탈만
curl -H "Authorization: Bearer $TOKEN" $BASE/network         # MAC + ARP + WWN
curl -H "Authorization: Bearer $TOKEN" "$BASE/logs?lines=100"
curl -H "Authorization: Bearer $TOKEN" "$BASE/applogs?name=java-gc&lines=50"
curl -H "Authorization: Bearer $TOKEN" $BASE/all             # 전체 (Argus가 주기 호출)
```

---

## 3. 연동 흐름

### Push Agent

```
[1] Argus 대시보드 → 설정 > Agent 관리 → 토큰 발급
         ↓
[2] install.sh / install.ps1 실행 → token / server_url 입력
         ↓
[3] argus-agent 시작 → POST /api/agent/register 자동 등록
    - Argus DB에 asset 생성, token에 asset_id 연결
         ↓
[4] 60초마다 POST /api/metrics → Argus DB 저장
[5] 30초마다 POST /api/agent/heartbeat → 온라인 상태 유지
```

### Pull Agent

```
[1] Argus 대시보드 → 설정 > Agent 관리 → 토큰 발급
         ↓
[2] install.sh 실행 → token / argus_url 입력
    (또는 agent.yaml에 직접 작성)
         ↓
[3] agnet 시작 → POST /api/agnet/register 자동 등록
    - Argus DB에 agnet_url (http://{서버IP}:9182) 저장
         ↓
[4] agnet HTTP 서버 대기 (포트 9182)
         ↓
[5] Argus 스케줄러 → 60초마다 GET {agnet_url}/all
    - 수집 데이터 → DB 저장 (metrics, smart, logs...)
```

---

## 4. 방화벽 설정

### Push Agent 서버
```
outbound TCP 3100 → Argus 서버
```

### Pull Agent 서버
```
inbound  TCP 9182 ← Argus 서버 (폴링)
outbound TCP 3100 → Argus 서버 (최초 등록 1회)
```

---

## 5. 트러블슈팅

### Push Agent (Linux)
```bash
systemctl status argus-agent
journalctl -u argus-agent -f

# 수동 실행 테스트
/opt/argus-agent/argus-agent --config /opt/argus-agent/agent.json
```

### Push Agent (Windows)
```powershell
Get-Service ArgusAgent
# 이벤트 뷰어 > Windows 로그 > 응용 프로그램 에서 로그 확인
# 또는 서비스 재등록:
Stop-Service ArgusAgent -Force; sc.exe delete ArgusAgent
.\install.ps1 -Token "토큰" -ServerUrl "http://..."
```

### Pull Agent (Linux)
```bash
systemctl status agnet
journalctl -u agnet -f

# 토큰 없이 시작 시 오류 메시지:
# [agnet] token이 설정되지 않았습니다. agent.yaml에서 token을 입력하세요.

# 헬스체크
curl -H "Authorization: Bearer $TOKEN" http://localhost:9182/health

# Argus 서버에서 수동 수집 트리거
curl -s "http://argus-server:3100/api/agnet/collect?asset_id=<N>"
```

### Pull Agent (Windows)
```powershell
Get-Service ArgusPullAgent
# 서비스 재등록:
Stop-Service ArgusPullAgent -Force; sc.exe delete ArgusPullAgent
.\install.ps1 -Token "토큰" -ArgusUrl "http://..."
```

### 공통 — 401 Unauthorized 오류
- 토큰이 올바른지 확인: **설정 > Agent 관리**에서 발급된 토큰과 일치하는지 확인
- 토큰이 취소(revoked)되지 않았는지 확인
- 서버 주소/포트가 올바른지 확인 (기본: `:3100`)
