# Digicap v3.0 — Claude Code Context

## Project Overview
On-premises infrastructure monitoring + asset management platform.
Servers, network, storage, virtualization unified under a single asset ID.
Topology auto-discovery (LLDP/MAC/ARP/WWN), AI analysis (Ollama/OpenAI/Anthropic), rack visualization, incident management.

**Target**: Mid-sized enterprises / public institutions (300-1000 staff, 2-5 IT ops)

**Go module**: `github.com/stone14/go_digi`

## Architecture
```
Next.js 14 (:3100) ──rewrites /api/*──> Go Echo (:3200)
       │                                    │
       │                              ┌─────┼──────────┐
       │                              │     │          │
       │                          Scheduler  Syslog   WebSocket
       │                          (cron)    (UDP 5140) Hub
       │                              │
       └──── PostgreSQL 16 (digicap) ─┘
                port 5433 (host) / 5432 (docker)
```

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS dark theme + Recharts + React Flow
- **Backend**: Go (Echo v4) — all API, auth, scheduler, websocket, syslog receiver
- **DB**: PostgreSQL 16, `digicap` database, pgx v5 connection pool (max 20)
- **AI**: Ollama (local) / OpenAI / Anthropic — selectable via settings
- **Auth**: JWT (golang-jwt/v5) + bcrypt
- **Deploy**: Docker Compose (digicap-db + digicap-app) or standalone

## Stats
| Item | Count |
|------|-------|
| Go Handlers | 20 |
| API Routes | ~80 endpoints |
| Dashboard Pages | ~17 sections |
| Web API Proxies | 22 |
| DB Migration | 1 (unified from Argus v2.x 001-016) |
| Internal Packages | 12 |
| Web Libraries | 13 |

## Directory Structure
```
Go_digi/
├── cmd/server/main.go          # Entry point — Echo routes, graceful shutdown
├── internal/
│   ├── auth/                   # JWT middleware (RequireAuth, RequireRole)
│   ├── config/                 # Config loader (config.json + env override)
│   ├── db/                     # pgx v5 pool + golang-migrate
│   │   └── migrations/         # Embedded SQL (000001_initial)
│   ├── handler/                # 20 Echo handler files
│   ├── llm/                    # LLM clients (Ollama, OpenAI, Anthropic)
│   ├── middleware/             # Request logger
│   ├── notify/                 # Slack/Email/Webhook notifications
│   ├── scheduler/              # robfig/cron scheduler
│   ├── syslog/                 # UDP syslog receiver (:5140)
│   └── websocket/              # WebSocket hub (gorilla/websocket)
├── migrations/                 # SQL migration files (also embedded)
├── web/                        # Next.js 14 frontend
│   ├── src/app/(dashboard)/    # 17 dashboard page sections
│   ├── src/app/api/            # 22 API proxy routes (rewrite to Go)
│   ├── src/components/         # React components (7 directories)
│   └── src/lib/                # 13 utility libraries
├── data/
│   ├── digicap_data.dump       # PostgreSQL data dump
│   └── restore.sh              # Data restore script
├── scripts/                    # Migration/demo data SQL scripts
├── docs/                       # Documentation (INSTALL, DEVPLAN, etc.)
├── config.json                 # Local dev config
├── docker-compose.yml          # DB + App services
├── Dockerfile                  # Multi-stage: Go + Next.js unified
├── Dockerfile.core             # Go backend only
└── server.exe                  # Built binary (Windows)
```

## Configuration

### config.json (local development)
```json
{
  "port": "3200",
  "db": {
    "host": "localhost",
    "port": "5433",
    "user": "digicap",
    "password": "digicap_password_change_me",
    "database": "digicap",
    "max_conns": 20
  }
}
```

### Environment Variables (override config.json)
`PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`

## Docker Compose
```yaml
services:
  postgres:     # digicap-db, PostgreSQL 16, host:5433 -> container:5432
  app:          # digicap-app, Go + Next.js unified
                # host:3300 -> container:3100 (Next.js)
                # host:3200 -> container:3200 (Go API)
                # host:5140 -> container:5140/udp (Syslog)
```

Note: Port 3300 is used for Next.js in Docker because Argus (argus-web) uses 3100 on the host.

## Next.js Frontend (web/)
- `output: 'standalone'` for production
- Rewrites `/api/*` to Go backend (`API_URL` env, default `http://localhost:3200`)
- Also rewrites `/health` and `/ws`
- Dark theme only — navy background (#0a0e1a ~ #1a2540), cyan/green/purple/orange/red accents
- Korean UI — all labels and messages in Korean
- Fonts: Pretendard Variable (Korean) + Inter (English) + JetBrains Mono (code)

## API Routes (Go Backend)

### Public
| Method | Path | Handler |
|--------|------|---------|
| GET | /health | Health check |
| GET | /ws | WebSocket |
| POST | /api/auth | Login |
| DELETE | /api/auth | Logout |

### Agent API (token auth)
| Method | Path | Handler |
|--------|------|---------|
| POST | /api/agent/register | Push agent registration |
| POST | /api/agent/pull-register | Pull agent registration |
| POST | /api/agent/heartbeat | Heartbeat |
| POST | /api/agent/metrics | Metrics ingest |
| GET | /api/agent/service-checks | Get assigned checks |
| POST | /api/agent/service-check-results | Report results |
| GET | /api/agent/install-script | Auto-install script |
| GET | /api/agent/download | Agent binary download |

### Authenticated Routes (JWT required)
Assets, Organizations, Metrics, Alerts, Service Checks, Incidents, Topology, Network/IPAM, Reports, BMC/Redfish, SSL, LLM, Syslog, License

### Admin-Only Routes
User management, Agent token management, System settings, Audit logs, License activation

## Go Handler Files (internal/handler/)
`agent.go`, `alerts.go`, `assets.go`, `audit.go`, `auth.go`, `bmc.go`, `health.go`, `incidents.go`, `license.go`, `llm.go`, `metrics.go`, `network.go`, `organizations.go`, `reports.go`, `service_checks.go`, `settings.go`, `ssl.go`, `syslog_handler.go`, `topology.go`, `users.go`

## Web Libraries (web/src/lib/)
| File | Purpose |
|------|---------|
| db.ts | PostgreSQL connection (legacy, proxied to Go) |
| auth.ts | JWT authentication |
| alert-engine.ts | Threshold-based alerting |
| llm-analyzer.ts | LLM predictive analysis |
| mac-parser.ts | Cisco/Juniper/FortiGate/Brocade parsing |
| redfish.ts | BMC/IPMI Redfish API |
| service-checker.ts | HTTP/TCP/DNS/Ping service checks |
| ssl-checker.ts | SSL certificate expiry |
| notify.ts | Slack/Email/Webhook notifications |
| scheduler.ts | node-cron scheduler (legacy) |
| audit.ts | Audit logging helper |
| maintenance-checker.ts | Maintenance contract checker |
| theme.tsx | Theme provider |

## LLM Package (internal/llm/)
Multi-provider support: `ollama.go`, `openai.go`, `anthropic.go`, `client.go`, `pool.go`

## DB Schema (key tables)
- **users** — RBAC (admin / operator / readonly), login lockout
- **audit_logs** — Partitioned by date range
- **organizations** — Tree structure (company / division / team)
- **assets** — Central entity (server/switch/router/firewall/fc_switch/nas/san/das)
- **metrics** — Time-series (cpu, mem, disk, net), quarterly partitions
- **metrics_5m / metrics_1h** — Aggregated metrics
- **alerts / alert_rules** — Alerts + rules
- **incidents / incident_timeline** — Incident management
- **topology_nodes / topology_edges** — Physical/SAN/L3 topology
- **racks / rack_units** — Rack + unit placement
- **ip_subnets / ip_allocations** — IPAM
- **maintenance_contracts** — Maintenance/SW contracts
- **network_ports** — Switch port status
- **virtual_hosts / virtual_machines** — Virtualization
- **storage_volumes / storage_connections** — Storage

## Critical Rules

### Go Coding
- All API routes defined in `cmd/server/main.go`
- Handlers in `internal/handler/` — one file per domain
- Config: `config.json` first, then env vars override
- DB: pgx v5 pool, no ORM
- Migrations: golang-migrate with embedded SQL
- Graceful shutdown with signal handling

### Frontend Rules
- `export default` — no named exports `{ X }`
- Dark theme only — Tailwind CSS utilities
- Korean UI for all labels
- `useSearchParams()` must be wrapped in `<Suspense>`

### Dual Development Environment
Argus (Next.js) and Digicap (Go) run simultaneously on the same machine:
- **Argus**: argus-db on port 5432, argus-web on port 3100
- **Digicap**: digicap-db on port 5433, Go backend on port 3200, Next.js dev on port 3100 (or Docker 3300)

## Development

### Prerequisites
- Go 1.26+
- Node.js 20+
- PostgreSQL 16 (or Docker)

### Quick Start
```bash
# Start DB
docker compose up -d postgres

# Restore data (optional)
cd data && bash restore.sh

# Start Go backend
go build ./cmd/server/ && ./server.exe
# or: go run ./cmd/server/

# Start Next.js frontend (separate terminal)
cd web && npm install && npm run dev
```

### Login Credentials
- **Email**: admin@digicap.local
- **Password**: digicap1234!

### Data Restore
```bash
cd data
bash restore.sh   # Restores digicap_data.dump to digicap DB on port 5433
```

### Build
```bash
# Go backend
go build -o server.exe ./cmd/server/

# Docker (unified: Go + Next.js)
docker compose up -d --build
```

### Production Docker Ports
- 3300 → Next.js frontend (mapped to avoid conflict with Argus)
- 3200 → Go API backend
- 5140/udp → Syslog receiver

## Migration from Argus v2.x
Digicap v3.0 is a full rewrite of Argus:
- Backend moved from Next.js API Routes to Go (Echo v4)
- All 16 Argus migrations merged into single `000001_initial.up.sql`
- Frontend remains Next.js 14 but now proxies all `/api/*` to Go backend
- Go handles: auth, scheduling, syslog, websocket, metrics ingestion, all CRUD
