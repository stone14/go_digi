# Argus v3.0 아키텍처 — Next.js vs Go 전환 분석

## Context

현재 Argus는 Next.js 14가 **프론트엔드 + REST API + 백그라운드 스케줄러**를 모두 담당하고, Go는 에이전트(push/pull)와 syslog 수집만 담당. 모니터링 고도화, 로그 수집, LLM 연동을 확장하면 Next.js 단일 프로세스의 한계가 드러남. 장기 아키텍처 방향을 결정해야 함.

---

## 현재 아키텍처 문제점

### Next.js가 감당하고 있는 것 (과부하)

| 작업 | 주기 | 문제 |
|------|------|------|
| Alert 평가 | 1분 | 규칙 × 자산 수만큼 순차 평가, O(N) |
| LLM 예측 분석 | 5분 | 자산별 순차 LLM 호출, 30초 타임아웃 |
| Pull Agent 폴링 | 1분 | 순차 HTTP 호출 (자산 수만큼) |
| 서비스 체크 | 1분 | 블로킹 TCP/HTTP/DNS 체크 |
| 메트릭 집계 | 5분 | 5m/1h 롤업 쿼리 |
| 토폴로지 발견 | 온디맨드 | 대규모 인메모리 JOIN |
| BMC 수집 | 5분 | Redfish API 블로킹 호출 |
| SSL 체크 | 1일 | TLS 연결 체크 |

**핵심 문제:**
- node-cron 단일 스레드 → 모든 스케줄 작업이 직렬 실행
- 분산 락 없음 → 멀티 인스턴스 배포 불가
- LLM 호출이 API 프로세스 블로킹
- DB 커넥션 풀 5개를 API + 스케줄러가 공유

### Go가 담당하는 것 (잘 분리됨)

| 컴포넌트 | 역할 |
|----------|------|
| Push Agent | 서버에서 메트릭/로그 수집 → API로 전송 |
| Pull Agent | HTTP 서버로 대기 → Argus가 폴링 |
| Syslog Collector | UDP 5140 수신 → 이벤트 파싱 → API로 전송 |

---

## 3가지 옵션 비교

### 옵션 A: 전면 Go 전환

```
Go Backend (Fiber/Echo) + React SPA
├── API Server (REST + WebSocket)
├── Scheduler (alert, LLM, aggregation)
├── Worker Pool (LLM, service check, BMC)
└── PostgreSQL
```

**장점:**
- 단일 언어 (Go agents + Go backend)
- 고루틴으로 동시성 자연스럽게 해결
- 메모리 효율, 바이너리 배포 단순
- 모니터링 도구(Prometheus 등)와 Go 생태계 궁합

**단점:**
- **48개 API 라우트 + 31개 페이지 전면 재작성** (2-3개월)
- Go 웹 프레임워크의 프론트엔드 DX가 Next.js보다 약함
- React SSR 불가 → CSR SPA로 전환 필요
- 현재까지의 v2.2 작업량 대비 ROI 낮음

**예상 기간:** 8~12주 (풀타임 1인)

---

### 옵션 B: 하이브리드 (Next.js UI + Go 백엔드 서비스) ⭐ 추천

```
Next.js 14 (프론트엔드 + 경량 API)
    ↕ HTTP/gRPC
Go Backend Service (신규)
├── Scheduler (alert, metric aggregation, agent polling)
├── Worker Pool (LLM, service check, BMC, topology)
├── Syslog Receiver (기존 collector 통합)
├── WebSocket Hub (실시간 메트릭 스트리밍)
└── PostgreSQL
```

**장점:**
- 프론트엔드(Next.js)는 그대로 유지 → 재작성 없음
- 무거운 백그라운드 작업만 Go로 이전
- Go 고루틴으로 동시성 문제 해결
- 점진적 마이그레이션 가능 (기능별로 하나씩 이전)
- Next.js API는 CRUD + 프록시만 담당 (가벼움)

**단점:**
- 두 언어 유지 (이미 Go agent 있으므로 추가 부담 적음)
- 서비스 간 통신 오버헤드 (localhost HTTP → 무시 가능)

**예상 기간:** 4~6주 (풀타임 1인)

---

### 옵션 C: Next.js 유지 + 최적화

```
Next.js 14 (현재 유지)
├── BullMQ (Redis 큐) → Worker 프로세스 분리
├── WebSocket (Socket.io)
└── PostgreSQL
```

**장점:**
- 코드 변경 최소
- TypeScript 단일 언어

**단점:**
- Node.js 싱글 스레드 한계 극복 불가
- Redis 의존성 추가
- LLM/서비스체크 같은 I/O 바운드는 괜찮지만 CPU 바운드(토폴로지) 병목
- 장기적으로 모니터링 규모 확장 어려움

**예상 기간:** 2~3주

---

## 추천: 옵션 B (하이브리드)

### 이유

1. **이미 Go 코드베이스 존재** — agent/, agent-pull/, collector/ 모두 Go. 백엔드 서비스 추가는 자연스러운 확장
2. **프론트엔드 재작성 불필요** — Next.js 31페이지 + 48 API 라우트를 다시 만들 필요 없음
3. **점진적 이전** — scheduler.ts의 작업을 하나씩 Go 서비스로 이전 가능
4. **대상 고객(300~1000명)에 적합** — 단일 바이너리로 배포 단순, 메모리 효율적
5. **LLM 연동 확장성** — Go goroutine pool로 동시 LLM 호출 (10-50 concurrent), 큐 기반 재시도

### 아키텍처

```
┌─────────────────────────────────────────────────┐
│                    클라이언트                      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Next.js 14 (포트 3100)                  │
│  ├── 31개 대시보드 페이지 (SSR)                     │
│  ├── CRUD API (자산, 알림, 설정, 조직 등)            │
│  └── Go 서비스 프록시 (/api/ai/*, /api/metrics/*)  │
└────────────────────┬────────────────────────────┘
                     │ HTTP (localhost:3200)
┌────────────────────▼────────────────────────────┐
│           Go Backend (argus-core)                 │
│  ├── HTTP API (메트릭 수신, LLM, 실시간 데이터)      │
│  ├── Scheduler                                    │
│  │   ├── Alert 평가 (1분, goroutine pool)          │
│  │   ├── 메트릭 집계 (5분)                          │
│  │   ├── Agent 폴링 (1분, concurrent)              │
│  │   ├── 서비스 체크 (1분, goroutine pool)          │
│  │   └── BMC/SSL 수집                              │
│  ├── LLM Worker Pool                              │
│  │   ├── 예측 분석 (Ollama/OpenAI/Anthropic)       │
│  │   ├── 로그 분석                                  │
│  │   ├── AI 채팅                                    │
│  │   └── 근본원인 분석                               │
│  ├── Syslog Receiver (UDP 5140)                   │
│  ├── WebSocket Hub (실시간 메트릭 push)             │
│  └── Agent 수신 (heartbeat, register)             │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              PostgreSQL 16                        │
└─────────────────────────────────────────────────┘
```

### 결정 사항
- **아키텍처**: 옵션 B 하이브리드 (Next.js UI + Go 백엔드)
- **프레임워크**: Echo v4
- **첫 단계**: 스케줄러 이전 (가장 큰 병목 해소)

### 마이그레이션 단계 (점진적)

#### Phase 1: Go 백엔드 스캐폴드 (1주) ← **시작점**
- `C:\Users\jishin\Dev\Go_digi\` 디렉토리 생성 (Go module: `github.com/digicap/argus-core`)
- Echo v4 HTTP 서버 + pgx v5 DB 연결 + 설정 로드
- Docker Compose에 `core` 서비스 추가
- Health check API 구현

**디렉토리 구조:**
```
Go_digi/
├── cmd/
│   └── server/
│       └── main.go          # 엔트리포인트
├── internal/
│   ├── config/
│   │   └── config.go        # 설정 로드 (env + JSON)
│   ├── db/
│   │   └── postgres.go      # pgx 커넥션 풀
│   ├── handler/
│   │   └── health.go        # /health 엔드포인트
│   └── middleware/
│       └── logger.go        # 요청 로깅
├── go.mod
├── go.sum
├── Dockerfile
├── .env.example
└── README.md
```

#### Phase 2: 스케줄러 이전 (1주)
- `scheduler.ts`의 작업을 Go cron으로 이전:
  - Alert 평가 → goroutine pool (자산별 병렬)
  - 메트릭 집계 → 단일 goroutine
  - Agent 폴링 → goroutine pool (동시 폴링)
  - 서비스 체크 → goroutine pool
- Next.js `scheduler.ts` 비활성화

#### Phase 3: Agent 통신 이전 (1주)
- `/api/agent/heartbeat`, `/api/agent/register` → Go 서비스로 이전
- Push/Pull agent → Go 서비스에 직접 연결
- Syslog collector 통합 (별도 바이너리 → core에 내장)
- Next.js는 프록시만 유지

#### Phase 4: LLM 연동 이전 (1주)
- LLM client (Ollama/OpenAI/Anthropic) Go 구현
- AI 채팅 API → Go 서비스 (SSE 스트리밍)
- 예측 분석, 로그 분석, 근본원인 분석 → Go worker pool
- Next.js `/api/ai/*` → Go 서비스 프록시

#### Phase 5: 실시간 기능 (1주)
- WebSocket hub (Go gorilla/websocket)
- 메트릭 실시간 push (대시보드 자동 갱신)
- Alert 실시간 알림

#### Phase 6: Next.js 경량화 (1주)
- Next.js에서 제거: scheduler.ts, llm-analyzer.ts, alert-engine.ts, service-checker.ts, ssl-checker.ts
- Next.js API는 CRUD + Go 프록시만 유지
- Docker 이미지 경량화

### Next.js에 남는 것

| 역할 | 내용 |
|------|------|
| SSR 페이지 | 31개 대시보드 페이지 |
| CRUD API | 자산, 조직, 설정, 사용자, 알림규칙 등 |
| 인증 | JWT + bcrypt |
| 프록시 | `/api/ai/*` → Go, `/api/metrics/stream` → Go WebSocket |
| 정적 파일 | CSS, JS, 이미지 |

### Go 백엔드 기술 스택 (확정)

| 항목 | 선택 |
|------|------|
| HTTP 프레임워크 | **Echo v4** |
| DB 드라이버 | pgx v5 (커넥션 풀 내장) |
| 스케줄러 | robfig/cron v3 |
| WebSocket | gorilla/websocket |
| LLM 클라이언트 | net/http (직접 구현, 의존성 최소화) |
| Syslog | 기존 collector 코드 재사용 |
| 설정 | viper 또는 직접 JSON 파싱 |
| 로깅 | slog (Go 1.21 표준) |

---

## 납품/업데이트/라이선스 전략

### 결정 사항
- **업데이트 방식**: A(대시보드 자동) + C(중앙 관리) 결합
- **중앙 관리 범위**: 버전/상태 + 라이선스만 (로그 수집 안함, 트래픽 최소)
- **네트워크**: 혼합 (인터넷 연결 + 폐쇄망 고객 모두 지원)
- **라이선스**: 필요 (고객별 키 발급, 만료일, 기능/자산 수 제한)

### 아키텍처

```
┌─────────────────────────────────────────────────┐
│          중앙 관리 포털 (Digicap Cloud)             │
│  ├── 고객사 목록 + 버전/상태 대시보드               │
│  ├── 라이선스 발급/관리                             │
│  ├── 업데이트 패키지 배포 (Docker 이미지 + 오프라인)  │
│  └── 장애 진단 스냅샷 수신 (고객 수동 전송)          │
└────────────────────┬────────────────────────────┘
                     │ HTTPS (시간당 1회, 수 KB)
                     │
┌────────────────────▼────────────────────────────┐
│      고객사 Argus (온프레미스)                      │
│  ├── 대시보드: 업데이트 알림 + 원클릭 업데이트       │
│  ├── Phone-Home: 버전/상태/라이선스 전송            │
│  ├── 라이선스 검증 (오프라인 키 기반)                │
│  └── 오프라인 업데이트 지원 (tar 패키지 업로드)      │
└─────────────────────────────────────────────────┘
```

### 트래픽 분석 (중앙 관리)

| 데이터 | 크기 | 주기 | 100고객 기준 |
|--------|------|------|-------------|
| 버전/상태 heartbeat | ~1 KB | 1시간 | 2.4 MB/일 |
| 라이선스 검증 | ~0.5 KB | 24시간 | 50 KB/일 |
| 업데이트 체크 | ~0.5 KB | 6시간 | 200 KB/일 |
| 진단 스냅샷 (수동) | ~100 KB | 필요 시 | - |
| **합계** | | | **~3 MB/일** |

→ 로그를 수집하지 않으므로 트래픽 무시 가능

### 라이선스 시스템

```
라이선스 키 구조 (JWT 기반, 오프라인 검증 가능):
{
  "customer_id": "cust-001",
  "customer_name": "ABC 주식회사",
  "plan": "standard",          // basic / standard / enterprise
  "max_assets": 100,           // 최대 자산 수
  "features": ["llm", "syslog", "compliance"],
  "issued_at": "2026-03-27",
  "expires_at": "2027-03-27",
  "signature": "RSA-SHA256..."  // 오프라인 검증용
}
```

**검증 방식:**
- **온라인**: 중앙 서버에서 JWT 서명 + 만료일 검증
- **오프라인**: RSA 공개키로 서명 검증 (인터넷 없이도 라이선스 유효성 확인)
- **유예 기간**: 만료 후 30일 유예 (기능은 유지, 경고 표시)

**기능 제한 (plan별):**

| 기능 | basic | standard | enterprise |
|------|-------|----------|------------|
| 자산 수 | 50 | 200 | 무제한 |
| Agent | 10 | 50 | 무제한 |
| LLM 분석 | ✗ | ✓ | ✓ |
| Syslog 수집 | ✗ | ✓ | ✓ |
| 컴플라이언스 | ✗ | ✗ | ✓ |
| 원격 지원 | ✗ | 이메일 | 전용 채널 |

### 업데이트 프로세스

#### 온라인 고객
```
1. Argus 대시보드 → "새 버전 v2.3.0 사용 가능" 알림 표시
2. 관리자 클릭 → 업데이트 내역(changelog) 확인
3. "업데이트" 클릭 →
   a) DB 백업 자동 실행 (pg_dump)
   b) Docker 이미지 pull (레지스트리에서)
   c) DB 마이그레이션 자동 실행
   d) 서비스 재시작 (docker compose up -d)
   e) 헬스체크 → 성공/실패 표시
4. 실패 시 자동 롤백 (이전 이미지로 복원)
```

#### 오프라인 고객
```
1. 중앙 포털에서 오프라인 패키지 다운로드 (.tar.gz)
   - Docker 이미지 (docker save)
   - 마이그레이션 SQL
   - changelog
   - 설치 스크립트
2. USB/파일전송으로 고객사 서버에 복사
3. Argus 대시보드 → "오프라인 업데이트" 메뉴
4. 패키지 파일 업로드 → 서명 검증 → 설치 진행
   (또는 CLI: argus-update apply package.tar.gz)
```

### 구현 순서 (업데이트/라이선스)

#### Phase 7: 라이선스 시스템 (1주)
- `argus-core/license/` — JWT 발급/검증 (RSA 키페어)
- Go 백엔드에 라이선스 미들웨어 (요청마다 유효성 체크)
- Next.js 설정 페이지에 라이선스 입력/상태 표시
- 기능 제한 로직 (자산 수 초과 시 추가 불가 등)

#### Phase 8: 대시보드 업데이트 기능 (1주)
- Next.js `/settings` 페이지에 "시스템 업데이트" 섹션
- 버전 체크 API (중앙 서버 또는 GitHub Releases)
- 온라인 업데이트: Docker pull + 마이그레이션 + 재시작
- 오프라인 업데이트: 패키지 업로드 → docker load → 재시작
- 자동 백업 + 롤백 로직

#### Phase 9: 중앙 관리 포털 (2주)
- 별도 프로젝트 (`argus-portal/`)
- 고객사 등록/관리 대시보드
- 라이선스 발급/갱신/폐기
- 고객사 Phone-Home 수신 (버전/상태)
- 업데이트 패키지 빌드 + 배포
- 진단 스냅샷 뷰어

---

## 전체 마이그레이션 로드맵

| Phase | 내용 | 기간 | 의존성 |
|-------|------|------|--------|
| 1 | Go 백엔드 스캐폴드 (Echo v4 + DB + Docker) | 1주 | - |
| 2 | 스케줄러 이전 (Alert, 집계, 폴링, 서비스체크) | 1주 | Phase 1 |
| 3 | Agent 통신 이전 (heartbeat, register, syslog 통합) | 1주 | Phase 2 |
| 4 | LLM 연동 이전 (채팅, 예측, 로그분석, 근본원인) | 1주 | Phase 1 |
| 5 | 실시간 기능 (WebSocket 메트릭/알림 push) | 1주 | Phase 2 |
| 6 | Next.js 경량화 (scheduler.ts 제거) | 1주 | Phase 2-5 |
| 7 | 라이선스 시스템 (JWT, RSA 오프라인 검증) | 1주 | Phase 1 |
| 8 | 대시보드 업데이트 (온라인/오프라인, 자동 백업) | 1주 | Phase 7 |
| 9 | 중앙 관리 포털 (고객 관리, 라이선스 발급, 패키지 배포) | 2주 | Phase 7-8 |

**총 예상 기간: 10~11주 (Phase 1~6 병렬 가능 → 6~8주)**

## 검증

1. Go 서비스 헬스체크: `curl http://localhost:3200/health`
2. Alert 평가 성능: 100+ 자산에서 1분 이내 완료 확인
3. LLM 동시 호출: 10 goroutine 동시 처리 확인
4. Agent 통신: push/pull agent → Go 서비스 직접 연결 확인
5. Next.js → Go 프록시: CRUD API 정상 응답 확인
6. WebSocket: 대시보드 실시간 메트릭 수신 확인
7. Docker Compose: `docker compose up -d` 전체 서비스 기동 확인
8. 라이선스: 오프라인 환경에서 RSA 키 기반 검증 확인
9. 온라인 업데이트: 대시보드에서 원클릭 업데이트 → 백업 → 마이그레이션 → 재시작
10. 오프라인 업데이트: tar 패키지 업로드 → docker load → 정상 기동 확인
