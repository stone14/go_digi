# Argus (Digicap) — Claude Code 컨텍스트

## 프로젝트 개요
온프레미스 인프라 모니터링 + 자산 관리 플랫폼.
서버, 네트워크, 스토리지, 가상화 전체를 하나의 자산 ID 중심으로 통합 관리.
토폴로지 자동 발견(LLDP/MAC/ARP/WWN), AI 분석(Ollama/OpenAI/Anthropic), 랙 시각화, 인시던트 관리 제공.

**대상**: 중견기업/공공기관 (300~1000명, IT 인력 2~5명)

## 아키텍처
```
Next.js 14 Web ←→ PostgreSQL 16
       ↓
   node-cron (1m/5m)
       ↑ ↓
Push Agent ←→ Pull Agent (Go 1.22)
    (60s)         (60s)
      ↑              ↑
모니터링 대상 서버 (Physical/VM/Cloud)
```

- **프론트엔드**: Next.js 14 (App Router) + Tailwind CSS 다크 테마 + Recharts + React Flow
- **백엔드**: Next.js API Routes + PostgreSQL 16 (pg 드라이버 직접 사용)
- **에이전트**: Go 1.22 (Push Agent + Pull Agent), gopsutil v3
- **배포**: Docker Compose (postgres + web + agent + syslog)
- **인증**: JWT + bcryptjs
- **AI**: Ollama (로컬) / OpenAI / Anthropic 선택 가능

## 현황
| 항목 | 수치 |
|------|------|
| 대시보드 페이지 | 31 |
| API 라우트 | 48 (20개 엔드포인트) |
| DB 마이그레이션 | 16 (+ 시드 4) |
| 컴포넌트 | ~20+ |
| 라이브러리 | 12 |

## 디렉토리 구조
```
argus/
├── web/                     # Next.js 14 Web UI
│   ├── src/app/(dashboard)/ # 31개 대시보드 페이지
│   ├── src/app/api/         # 48개 API 라우트
│   ├── src/components/      # React 컴포넌트
│   └── src/lib/             # 유틸리티 라이브러리
├── agent/                   # Push Agent (Go)
├── agent-pull/              # Pull Agent (Go)
├── collector/               # Syslog Collector (Go)
├── scripts/migrations/      # SQL 마이그레이션 + 시드 데이터
├── dist/                    # 빌드 산출물 (ZIP)
├── docker-compose.yml
├── DEVPLAN.md               # v2.0 개발 체크리스트
├── INSTALL.md               # 설치 가이드
└── README.md                # 프로젝트 문서
```

## 주요 페이지 (31개)
| 영역 | 페이지 |
|------|--------|
| 모니터링 | servers, servers/[id], network, network/[id], storage, storage/[id], hardware, virtual |
| 자산 | assets, assets/capacity, assets/changes, assets/dependencies, assets/ipam, assets/software, assets/ssl |
| 토폴로지 | topology (React Flow, Physical/SAN/L3 레이어) |
| 랙 | rack (8종 스텐실, U 배치, 미니 메트릭 바) |
| 알림/인시던트 | alerts, alerts/rules, incidents |
| AI | ai/chat, ai/anomaly, ai/logs |
| 보안 | security |
| 리포트 | reports |
| 설정 | settings, settings/agents, settings/llm, settings/users |

## API 라우트 (주요)
| 엔드포인트 | 용도 |
|-----------|------|
| /api/agent/* | 에이전트 하트비트, 메트릭 수집 |
| /api/alerts | 알림 CRUD |
| /api/assets/* | 자산 CRUD, IPAM, 라이프사이클, 계약, Excel/CSV 가져오기 |
| /api/metrics | 시계열 메트릭 (raw/5m/1h 집계) |
| /api/topology/* | LLDP/MAC/WWN 자동 발견 |
| /api/bmc | Redfish BMC 수집 |
| /api/llm | LLM 분석 |
| /api/rack | 랙 관리 |

## 핵심 라이브러리 (web/src/lib/)
| 파일 | 용도 |
|------|------|
| db.ts | PostgreSQL 커넥션 풀 |
| auth.ts | JWT 인증 |
| alert-engine.ts | 임계치 기반 알림 |
| llm-analyzer.ts | LLM 예측 분석 |
| mac-parser.ts | Cisco/Juniper/FortiGate/Brocade 파싱 |
| redfish.ts | BMC/IPMI Redfish API |
| service-checker.ts | HTTP/TCP/DNS/Ping 서비스 체크 |
| ssl-checker.ts | SSL 인증서 만료 체크 |
| notify.ts | Slack/Email/Webhook 알림 |
| scheduler.ts | node-cron 스케줄러 |

## DB 스키마 핵심 테이블
- **assets** — 모든 자산의 중심 (server/switch/router/firewall/fc_switch/nas/san/das) + manager, user_name, user_team
- **metrics** — 시계열 메트릭 (cpu, mem, disk, net), 분기별 파티션
- **metrics_5m / metrics_1h** — 집계 메트릭
- **alerts / alert_rules** — 알림 + 규칙
- **incidents / incident_timeline** — 인시던트 관리
- **topology_nodes / topology_edges** — 토폴로지 (physical/san/l3 레이어)
- **racks / rack_units** — 랙 + 유닛 배치
- **ip_subnets / ip_allocations** — IPAM
- **maintenance_contracts** — 유지보수/SW 계약
- **network_ports** — 스위치 포트 상태
- **virtual_hosts / virtual_machines** — 가상화
- **storage_volumes / storage_connections** — 스토리지

## 필수 규칙

### 코딩 규칙
- **export default** 사용 — `export { X }` 형태 금지
- **다크 테마 전용** — navy 배경 (#0a0e1a ~ #1a2540), cyan/green/purple/orange/red 강조색
- **한국어 UI** — 모든 라벨, 메시지 한국어
- **Tailwind CSS** — 인라인 스타일 대신 Tailwind 유틸리티 사용
- **CSS 변수** — `var(--c-cyan)`, `var(--c-green)` 등 테마 변수 활용
- **폰트**: Pretendard Variable (한글) + Inter (영문) + JetBrains Mono (코드)

### Next.js 규칙
- `output: 'standalone'` — 프로덕션 빌드
- `useSearchParams()` 사용 시 반드시 `<Suspense>` 래핑 (SSR 호환)
- 개발: `npm run dev` (포트 3100), 프로덕션: `npm run build && npm start`

### DB 규칙
- **pg 드라이버 직접 사용** — ORM 없음
- 환경변수: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- 메트릭 테이블은 분기별 파티션 (2025-Q1 ~ 2027-Q4)

### Docker Compose
```yaml
services:
  postgres:  # PostgreSQL 16, 포트 5432
  web:       # Next.js 14, 포트 3100
  agent:     # Push Agent (profile: agent)
  syslog:    # Syslog Collector, 5140/UDP (profile: collector)
```

## 개발 환경 설정
```bash
git clone https://github.com/stone14/monitor.git
cd monitor
docker compose up -d          # DB + Web 시작
cd web && npm install && npm run dev  # 개발 서버 (HMR)
```

기본 계정: `admin` / `argus1234!`

## 배포 (서버)
```bash
git pull
docker compose up -d --build  # 프론트엔드 변경 시
```

DB 초기화 (데이터 삭제 후 재생성):
```bash
docker compose down -v
docker compose up -d
```

## v2.0 개발 현황 (DEVPLAN.md 참조)
모든 항목 완료:
- **Tier 1**: 자산 통계 카드, 대시보드 드릴다운, 토폴로지 자동배치, 필터 강화, CSV 내보내기, TOP10 링크
- **Tier 2**: 토폴로지 메트릭 팝오버, Physical/SAN 레이어 전환, 최근활동 컬럼, IPAM CRUD, 벌크 작업
- **Tier 3**: 토폴로지 CPU/MEM 히트맵 오버레이, 알림 표시, 랙 실시간 메트릭 바

## v2.1 개발 현황
- **자산 담당자/사용자 필드**: `manager`, `user_name`, `user_team` 컬럼 추가 (마이그레이션 014)
- **Excel/CSV 가져오기**: 템플릿 다운로드(.xlsx) + 파일 업로드 → 미리보기 → 벌크 등록 (최대 500건)
- **Import API**: `POST /api/assets/import` — 트랜잭션 기반 벌크 삽입, 유효성 검증
- **SW 인벤토리 가져오기**: 템플릿 다운로드 + CSV/XLSX 벌크 등록 (`POST /api/assets/contracts/import`)
- **도메인/SSL 가져오기**: 템플릿 다운로드 + CSV/XLSX 벌크 등록 (`POST /api/assets/ssl/import`)
- **역할 기반 접근 제어**: 가져오기/추가는 admin만, 운영자는 수정만 (`requireRole('admin')`)
- **자산 수정 버그 수정**: 빈 문자열 → NULL 변환 (날짜/IP 필드)
- **검색 강화**: 관리담당자(`manager`), 사용자(`user_name`) 검색 추가
- **로그아웃**: Header에 사용자 드롭다운 + 로그아웃 (`DELETE /api/auth`)
- **로그인 잠금**: 5회 실패 시 30분 잠금 (마이그레이션 015), `GET /api/auth` 현재 사용자 정보

## v2.2 개발 현황
- [x] 1.1 자산에 설치 SW 표시 (확장 행에 뱃지 형태)
- [x] 2.1 조직 트리 구조 (`organizations` 테이블, 마이그레이션 016, CRUD API + 트리 뷰 페이지)
- [x] 3.1 에이전트 자동 설치 스크립트 생성 (Linux/Windows 원클릭 설치)
- [x] 4.1 감사 로그 UI + 기록 로직 (`audit.ts` 헬퍼, `/security/audit` 페이지)
- [x] 4.2 장애 이력 내보내기 (Excel, MTTR 포함)
- [x] 4.3 컴플라이언스 리포트 (`/reports/compliance` — 자산 완성도, MTTR, 접근 제어, 감사 로그)

### LLM 구성 이후
- [ ] AI 채팅 API (`/api/ai/chat`)
- [ ] AI 예측 API (`/api/ai/predictions`)
- [ ] AI 로그 분석 (`/api/ai/log-analysis`)
- [ ] AI 근본원인 분석 (인시던트 연동)

## 에이전트 빌드
```powershell
.\build-agents.ps1              # 전체 (14개 패키지)
.\build-agents.ps1 -Target push # Push Agent만
.\build-agents.ps1 -Target pull # Pull Agent만
```

Linux: `scripts/build-agent.sh`

## 마이그레이션 파일 순서
`scripts/migrations/` 디렉토리가 PostgreSQL `docker-entrypoint-initdb.d`로 마운트됨.
파일명 순서대로 자동 실행: 001 → 002 → ... → 016 → 999_dev_seed → 999_sample_data → 999_v2_sample_data
