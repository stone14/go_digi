# Argus — 서버 인프라 모니터링 플랫폼

> 온프레미스 서버 · VM · 클라우드 인스턴스를 위한 통합 모니터링 플랫폼.
> 에이전트 기반 메트릭 수집, 실시간 알림, LLM 기반 예측 분석을 제공합니다.

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Argus 플랫폼                              │
│                                                                 │
│  ┌──────────────┐     ┌─────────────────────────────────────┐  │
│  │  Next.js Web │     │           PostgreSQL 16              │  │
│  │  (포트 3100) │◄───►│  metrics / assets / alerts / logs   │  │
│  └──────┬───────┘     └─────────────────────────────────────┘  │
│         │                                                       │
│    ┌────┴─────────────────────────────────────────┐            │
│    │              스케줄러 (node-cron)              │            │
│    │  알림평가(1m) · 집계(5m) · LLM분석(5m)         │            │
│    │  BMC수집(5m) · 서비스체크(1m) · agnet폴링(1m)  │            │
│    └──────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         ▲ Push                    ▼ Pull
┌────────┴────────┐        ┌───────┴──────────┐
│  Push Agent     │        │  Pull Agent      │
│  (agent/)       │        │  (agent-pull/) │
│  60초마다 전송   │        │  9182 포트 대기  │
└─────────────────┘        └──────────────────┘
         ▲                          ▲
         │                          │
  ┌──────┴──────────────────────────┴──────┐
  │          모니터링 대상 서버              │
  │  물리 서버 · VM · AWS EC2 · Azure VM   │
  └────────────────────────────────────────┘
```

---

## 기능 목록

### 대시보드

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 홈 | `/` | 자산 카테고리별 현황, CPU/메모리 TOP 10, 알림, 스토리지, 만료 계약 |
| 서버 목록 | `/servers` | 서버 상태, CPU/메모리 현황 |
| 서버 상세 | `/servers/[id]` | 실시간 메트릭 그래프, 로그, SMART |
| 네트워크 | `/network` | 스위치/라우터, LLDP 토폴로지 |
| 네트워크 상세 | `/network/[id]` | 네트워크 장비 상세 메트릭 |
| 보안 장비 | `/security` | 방화벽/IPS/WAF 모니터링 |
| 스토리지 | `/storage` | 디스크 현황, SMART |
| 스토리지 상세 | `/storage/[id]` | 스토리지 장비 상세 메트릭 |
| 가상화 | `/virtual` | VM 목록, 하이퍼바이저 현황 |
| 하드웨어 | `/hardware` | BMC/IPMI 온도, PSU, 전력 |
| 서비스 체크 | `/services` | HTTP/TCP/DNS/Ping 서비스 모니터링 |

### 시스템 구성 현황

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 시스템 구성 | `/topology` | 네트워크 토폴로지 맵 (React Flow), LLDP/MAC/ARP/WWN 자동 발견 |
| 의존성 맵 | `/assets/dependencies` | 자산 간 의존성 시각화, 장애 영향 분석 |
| Rack 실장 현황 | `/rack` | 데이터센터 랙 시각화, U 배치, 장비 스텐실, 실장률 통계 |

### 자산 관리 (중심 허브)

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 물리 자산 | `/assets` | 자산 CRUD, 유지보수 계약, 교차 참조(랙·토폴로지·에이전트) |
| SW 인벤토리 | `/assets/software` | 소프트웨어 라이선스 관리, 만료 추적, 설치 서버 |
| IP 관리 (IPAM) | `/assets/ipam` | 서브넷/VLAN, IP 할당 현황, 사용률 |
| 도메인/SSL | `/assets/ssl` | 도메인·SSL 인증서 만료 관리, 자동갱신 |
| 변경 이력 | `/assets/changes` | 자산 변경 감사 로그, 필드별 before/after |
| 용량 계획 | `/assets/capacity` | 디스크/CPU/메모리 트렌드, 선형 회귀, LLM 분석 |

**자산 중심 연계:**
- Agent 설치 서버 → 자동 자산 등록 (`registration_source: 'agent'`)
- 토폴로지 Discovery → 자동 자산 등록 (`registration_source: 'discovery'`)
- 수동 등록 (`registration_source: 'manual'`)
- 랙 배치 시 자산 연결 필수 (자산 우선 워크플로우)
- 자산 확장 행에서 랙 위치 · 토폴로지 등록 · 에이전트 상태 교차 확인

### 알림 / 장애내역

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 알림 현황 | `/alerts` | 실시간 알림, ACK/해결, 벌크 처리 |
| 알림 규칙 | `/alerts/rules` | 메트릭 임계치 규칙, Slack/Email/Webhook |
| 장애내역 | `/incidents` | 인시던트 타임라인, 원인 분석, 해결 기록 |

### AI 분석

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 이상 탐지 | `/ai/anomaly` | LLM 기반 메트릭 이상 탐지 |
| 로그 요약 | `/ai/logs` | LLM 로그 분석 및 요약 |
| AI 대화 | `/ai/chat` | 인프라 Q&A 챗 인터페이스 |

### 리포트

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 리포트 | `/reports` | 기간별 자산·알림·CPU/메모리/스토리지 리포트, 인쇄 지원 |

### 설정

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 시스템 설정 | `/settings` | 수집 주기, 보관 기간, 알림 쿨다운, Syslog 포트 |
| 사용자 관리 | `/settings/users` | 계정 관리 (admin / operator / readonly) |
| LLM 프로바이더 | `/settings/llm` | LLM 연결 설정, 테스트, 자동 예측 주기 |
| Agent 관리 | `/settings/agents` | 토큰 발급, 상태 모니터링, 설치 가이드 |
| 파싱 패턴 | `/settings/patterns` | 로그 파싱 규칙 설정 |

### AI / LLM

- **LLM 예측 분석**: 수집된 메트릭 트렌드를 LLM으로 분석하여 이슈 발생 전 예측 알림
- **용량 계획 AI**: 디스크/CPU/메모리 트렌드 분석, 고갈 시점 예측, 추천
- **지원 프로바이더**: Ollama (온프레미스) / OpenAI / Anthropic
- **예측 유형**: CPU 급증, 메모리 누수, 디스크 부족, 네트워크 이상, 로그 오류 급증

### 토폴로지 자동 발견

- **LLDP**: Syslog 수집기를 통한 실시간 LLDP 이벤트 처리
- **MAC 테이블**: Cisco IOS/NX-OS, Juniper, FortiGate 출력 파싱
- **ARP 캐시**: 서버-스위치 연결 자동 추론
- **FC/SAN**: WWN 기반 스토리지 패브릭 발견 (Brocade FC 스위치)
- **신뢰도 점수**: 발견 방법별 자동 신뢰도 (LLDP 95, ARP 70, WWN 85)

### Rack 실장 관리

- 다중 랙 · 다중 위치(층/열) 관리
- U 단위 장비 배치, 충돌 검사, 이동
- 8종 장비 스텐실 (서버, 스위치, 방화벽, 스토리지, 패치패널, KVM, UPS, PDU)
- 자산 연결 시 제조사/모델/이름 자동 표시
- 실장률 통계 (전체 랙, 전체 U, 사용 U, 여유 U)

---

## 에이전트

### Push Agent (`agent/`)
서버에 설치되어 60초마다 Argus 서버로 데이터를 전송합니다.

**수집 항목**
- CPU, 메모리, 디스크 I/O, 네트워크 I/O, Load Average
- SMART 디스크 건강 (베어메탈)
- FC HBA/Target WWN (Linux 베어메탈)
- MAC 주소 + ARP 캐시
- 시스템 로그 (syslog, auth.log)

### Pull Agent (`agent-pull/`)
Argus 서버가 60초마다 에이전트에 HTTP 요청을 보내 수집합니다.

**추가 수집 항목**
- 애플리케이션 로그 (임의 파일 경로)
- **Java GC 로그 구조화 파싱** (JDK 8 / JDK 9+ 양쪽 포맷)
- JSON 라인 포맷 로그
- AWS/Azure 인스턴스 메타데이터 (cloud 타입)

**node_type 자동 감지**: AWS IMDS → Azure IMDS → DMI → baremetal

설치 방법: [`AGENT_INSTALL.md`](./AGENT_INSTALL.md)

---

## 알림 시스템

### 임계치 기반 알림
- CPU, 메모리, 디스크 사용률, 네트워크 트래픽
- 에이전트 오프라인 감지
- 유지보수 계약 만료 임박

### LLM 예측 알림 (v2.0+)
- 최근 30분 메트릭 트렌드를 LLM이 분석
- 이슈 발생 15분 전 사전 경고
- Slack / Email 발송

### 알림 채널
- Slack Webhook
- Email (SMTP)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | Next.js 15, React, Tailwind CSS, Recharts, React Flow |
| 백엔드 | Next.js API Routes (Node.js) |
| 데이터베이스 | PostgreSQL 16 |
| 에이전트 | Go 1.22, gopsutil v3 |
| 스케줄러 | node-cron |
| 인증 | JWT (jsonwebtoken), bcryptjs |
| LLM | Ollama / OpenAI API / Anthropic API |
| 컨테이너 | Docker, docker-compose |

---

## 에이전트 빌드 및 배포 패키지

### Windows (PowerShell)

```powershell
# Push + Pull Agent 전체 빌드 및 패키지 생성
.\build-agents.ps1

# Push Agent만
.\build-agents.ps1 -Target push

# Pull Agent만
.\build-agents.ps1 -Target pull
```

생성 결과 (`dist/`):
```
dist/
├── argus-agent-baremetal-linux-amd64.zip      # Push Agent
├── argus-agent-baremetal-linux-arm64.zip
├── argus-agent-baremetal-windows-amd64.zip
├── argus-agent-vm-linux-amd64.zip
├── argus-agent-vm-linux-arm64.zip
├── argus-agent-vm-windows-amd64.zip
├── argus-pull-agent-baremetal-linux-amd64.zip # Pull Agent
├── argus-pull-agent-baremetal-linux-arm64.zip
├── argus-pull-agent-baremetal-windows-amd64.zip
├── argus-pull-agent-vm-linux-amd64.zip
├── argus-pull-agent-vm-linux-arm64.zip
├── argus-pull-agent-vm-windows-amd64.zip
├── argus-pull-agent-cloud-linux-amd64.zip
└── argus-pull-agent-cloud-linux-arm64.zip
```

각 패키지에는 **바이너리 + 타입별 설정 파일 + 설치 스크립트**가 포함되어 있습니다.

### Linux (Makefile)

```bash
cd agent-pull/

make build         # 현재 OS 바이너리만
make linux         # linux/amd64
make dist          # 전체 타입×플랫폼 패키지

make dist-baremetal
make dist-vm
make dist-cloud
```

---

## 빠른 시작

### Docker Compose

```bash
git clone https://github.com/stone14/monitor.git
cd monitor

# 서버 + DB 실행 (마이그레이션 + 시드 데이터 자동 적용)
docker compose up -d

# Push Agent 함께 실행
docker compose --profile agent up -d

# Syslog 수집기 함께 실행
docker compose --profile collector up -d
```

### 초기 설정

1. `http://localhost:3100`에 접속
2. 기본 계정: `admin` / `argus1234!`
3. **설정 > Agent 관리**에서 토큰 발급
4. 서버에 에이전트 설치 ([AGENT_INSTALL.md](./AGENT_INSTALL.md) 참조)

> 상세 설치 가이드: [INSTALL.md](./INSTALL.md)

---

## 디렉토리 구조

```
monitor/
├── agent/                   # Push Agent (Go 1.22)
│   ├── cmd/agent/main.go
│   ├── internal/
│   │   ├── collector/       # 메트릭, SMART, MAC, FC, 로그
│   │   ├── config/
│   │   └── shipper/         # Argus 서버로 데이터 전송
│   └── Dockerfile
│
├── web/                     # Argus Web 서버 (Next.js 15, 31페이지)
│   └── src/
│       ├── app/
│       │   ├── (dashboard)/ # 대시보드 페이지들
│       │   ├── api/         # REST API 라우트
│       │   └── login/
│       ├── components/
│       │   ├── layout/          # Sidebar, Header
│       │   ├── topology/        # DiscoveryPanel (MAC/WWN 파싱 UI)
│       │   └── rack/            # RackStencils (SVG 장비 스텐실)
│       ├── lib/
│       │   ├── db.ts            # PostgreSQL 연결
│       │   ├── auth.ts          # JWT 인증
│       │   ├── alert-engine.ts  # 알림 평가 엔진
│       │   ├── llm-analyzer.ts  # LLM 예측 분석
│       │   ├── scheduler.ts     # 크론 스케줄러
│       │   ├── notify.ts        # Slack/Email 발송
│       │   ├── redfish.ts       # BMC/Redfish API
│       │   ├── mac-parser.ts    # MAC/ARP/WWN 파서 (Cisco/Juniper/FortiGate/Brocade)
│       │   └── service-checker.ts
│
├── agent-pull/              # Pull Agent (Go 1.22)
│   ├── cmd/agent/
│   ├── internal/
│   │   ├── collector/       # metrics, smart, network, fc, cloud, applogs
│   │   ├── config/
│   │   └── handler/         # HTTP 엔드포인트
│   ├── configs/             # 타입별 설정 템플릿
│   └── scripts/             # 타입별 설치 스크립트
│
├── collector/               # Syslog 수집기 (Go)
├── scripts/
│   └── migrations/          # DB 마이그레이션 SQL
│       ├── 001_initial.sql
│       ├── 002_add_missing_columns.sql
│       ├── 003_storage.sql
│       ├── 004_virtualization.sql
│       ├── 005_agent_label.sql
│       ├── 006_agnet.sql        # Pull Agent 지원
│       ├── 007_llm.sql          # LLM 예측 알림
│       ├── 008 ~ 011            # 알림, 자산 확장, 용량, 서비스
│       ├── 012_topology_discovery.sql  # MAC/WWN 자동 발견
│       └── 013_asset_registration_source.sql
├── docker-compose.yml
├── build-agents.ps1         # Windows 빌드 스크립트 (Push + Pull Agent)
├── dist/                    # 빌드 결과물 (ZIP 패키지 14개)
├── AGENT_INSTALL.md         # 에이전트 설치 가이드
└── README.md                # 이 파일
```

---

## DB 마이그레이션

새 환경에서 수동 마이그레이션 실행:

```bash
for f in scripts/migrations/0*.sql; do
  psql -h localhost -U argus -d argus -f "$f"
done
```

docker compose는 `scripts/migrations/` 폴더 전체를 자동 적용합니다 (초기 실행 시).

---

## 개발 현황 (v1.0)

### 완료
- [x] 대시보드 (자산 카테고리, CPU/메모리 TOP 10, 알림, 스토리지, 만료 계약)
- [x] 모니터링 7개 (서버, 가상화, 네트워크, 보안, 스토리지, BMC, 서비스 체크)
- [x] Push Agent (Go) — 메트릭, SMART, FC/WWN, MAC/ARP, 로그
- [x] Pull Agent (Go) — HTTP 서버, node_type 자동 감지, 앱 로그/GC 파싱
- [x] 알림 엔진 (임계치 기반) + 알림 규칙 UI + Slack/Email/Webhook
- [x] 인시던트 관리 (타임라인, 원인 분석, 해결 기록)
- [x] BMC/IPMI 하드웨어 모니터링 (Redfish)
- [x] 서비스 체크 (HTTP/TCP/DNS/Ping)
- [x] 사용자 관리 + JWT 인증 (admin/operator/readonly)
- [x] Agent 토큰 관리 + 자동 자산 등록
- [x] LLM 예측 알림 (Ollama/OpenAI/Anthropic) + LLM 설정 UI
- [x] 설치 타입별 배포 패키지 (baremetal/vm/cloud)
- [x] 토폴로지 시각화 (React Flow) + LLDP/MAC/ARP/WWN 자동 발견
- [x] 의존성 맵 (네트워크/스토리지/가상화 연결, 장애 영향 분석)
- [x] Rack 실장 관리 (U 배치, 스텐실, 자산 연결, 실장률 통계)
- [x] 자산 중심 허브 (등록 출처 추적, 교차 참조, 자산 우선 워크플로우)
- [x] 자산 확장 (SW 인벤토리, IPAM, 도메인/SSL, 변경 이력, 용량 계획)
- [x] AI 분석 (이상 탐지, 로그 요약, AI 대화)
- [x] 리포트 생성 (기간별 자산·알림·리소스 리포트)

### 계획
- [ ] 대시보드 → 자산 필터 드릴다운 링크
- [ ] 자산 필터 강화 (상태/라이프사이클/복합 필터)
- [ ] 자산 CSV 내보내기
- [ ] 토폴로지 메트릭 오버레이 (CPU/메모리 히트맵)
- [ ] 토폴로지 알림 표시 (노드별 활성 알림)
- [ ] 토폴로지 Physical/SAN 레이어 전환
- [ ] 랙 장비 실시간 메트릭 표시
- [ ] IPAM 편집 UI
- [ ] 자산 일괄 라이프사이클 변경

---

*최종 업데이트: 2026-03-26*
