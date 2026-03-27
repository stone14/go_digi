# Argus — 설치 가이드 (Docker Compose)

인프라 모니터링 시스템 Argus의 Docker Compose 기반 설치 가이드입니다.
Linux 서버 (Ubuntu/RHEL/Rocky) 기준으로 작성되었습니다.

---

## 구성 요소

| 서비스 | 설명 | 포트 |
|--------|------|------|
| **postgres** | PostgreSQL 16 데이터베이스 | 5432 |
| **web** | Next.js 14 대시보드 | 3100 |
| **agent** | Go 기반 모니터링 에이전트 (선택) | — |
| **syslog** | Go 기반 Syslog 수집기 (선택) | 5140/UDP |

---

## 사전 요구사항

- Linux 서버 (Ubuntu 20.04+, RHEL 8+, Rocky 8+)
- root 또는 sudo 권한
- 인터넷 연결 (패키지 설치 및 이미지 다운로드)

---

## 1. Docker 설치

### Ubuntu / Debian

```bash
# 기존 Docker 패키지 제거
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null

# 의존성 설치
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Docker 공식 GPG 키 추가
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Docker 저장소 추가
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker 설치
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### RHEL / Rocky / CentOS

```bash
# 기존 Docker 패키지 제거
sudo yum remove -y docker docker-client docker-client-latest docker-common \
  docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null

# Docker 저장소 추가
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo

# Docker 설치
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Docker 서비스 시작
sudo systemctl start docker
sudo systemctl enable docker
```

### Docker 설치 확인

```bash
# 버전 확인
docker --version
docker compose version

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 사용)
sudo usermod -aG docker $USER

# 그룹 변경 적용 (재로그인 또는 아래 명령)
newgrp docker

# 동작 테스트
docker run --rm hello-world
```

---

## 2. Git 설치 및 소스 클론

```bash
# Git 설치 (없는 경우)
# Ubuntu/Debian
sudo apt-get install -y git

# RHEL/Rocky
sudo yum install -y git
```

```bash
# 소스 클론
git clone https://github.com/stone14/monitor.git
cd monitor
```

---

## 3. 환경 설정

### 3-1. DB 비밀번호 및 JWT 시크릿 변경 (권장)

`docker-compose.yml`에서 아래 값을 수정합니다:

```yaml
# postgres 서비스
POSTGRES_PASSWORD: <변경할-DB-비밀번호>

# web 서비스
DB_PASSWORD: <변경할-DB-비밀번호>   # 위와 동일하게
JWT_SECRET:  <변경할-JWT-시크릿>     # 랜덤 문자열 권장
```

> 로컬 테스트 시에는 기본값(`argus_password_change_me`, `change-this-secret`)으로 사용 가능합니다.

---

## 4. 실행

### 4-1. 기본 실행 (DB + 웹 대시보드)

```bash
docker compose up -d
```

첫 실행 시 이미지 빌드에 2~3분 소요됩니다.
PostgreSQL 컨테이너가 시작되면 `scripts/migrations/` 폴더의 SQL 파일들이 자동으로 실행되어 스키마와 시드 데이터가 생성됩니다.

### 4-2. 에이전트 포함 실행 (모니터링 대상 서버)

```bash
docker compose --profile agent up -d
```

### 4-3. Syslog 수집기 포함 실행

```bash
docker compose --profile collector up -d
```

### 4-4. 전체 서비스 실행

```bash
docker compose --profile agent --profile collector up -d
```

---

## 5. 접속

브라우저에서 접속합니다:

```
http://localhost:3100
```

### 기본 계정

| 항목 | 값 |
|------|-----|
| 아이디 | `admin` |
| 비밀번호 | `argus1234!` |

---

## 6. 에이전트 설정 (원격 서버 모니터링)

모니터링할 서버에 에이전트를 배포하려면:

### 6-1. 설정 파일 생성

```bash
cp agent/argus-agent.example.json argus-agent.json
```

`argus-agent.json`을 편집합니다:

```json
{
  "server_url": "http://<ARGUS-서버-IP>:3100",
  "token": "dev-token-local-1234",
  "collect_interval": 60000000000,
  "heartbeat_interval": 30000000000,
  "log_paths": [
    "/var/log/syslog",
    "/var/log/messages",
    "/var/log/auth.log"
  ],
  "log_max_lines": 500,
  "smart_enabled": true,
  "fc_enabled": true
}
```

| 항목 | 설명 |
|------|------|
| `server_url` | Argus 웹 서버 주소 |
| `token` | 에이전트 인증 토큰 (웹 UI 설정에서 관리) |
| `collect_interval` | 메트릭 수집 주기 (나노초, 기본 60초) |
| `heartbeat_interval` | 하트비트 주기 (나노초, 기본 30초) |
| `log_paths` | 수집할 로그 파일 경로 |
| `smart_enabled` | S.M.A.R.T 디스크 상태 수집 |
| `fc_enabled` | Fibre Channel HBA 정보 수집 |

### 6-2. 에이전트 실행 (Docker)

```bash
docker run -d \
  --name argus-agent \
  --restart unless-stopped \
  --network host \
  --privileged \
  -v /var/log:/var/log:ro \
  -v ./argus-agent.json:/app/argus-agent.json \
  argus-agent
```

> `--privileged`는 S.M.A.R.T, BMC(IPMI) 데이터 수집에 필요합니다.

### 6-3. 에이전트 실행 (바이너리)

```bash
cd agent
go build -o argus-agent ./cmd/agent
./argus-agent -config argus-agent.json
```

---

## 7. 주요 기능

| 기능 | 설명 |
|------|------|
| 대시보드 | 인프라 전체 현황 요약 |
| 모니터링 | 물리서버, 가상화, 네트워크, 보안, 스토리지, BMC, 서비스 체크 |
| 시스템 구성 현황 | 네트워크 토폴로지 (Physical/SAN/NAS/가상화), 의존성 맵, Rack 실장 현황 |
| 자산 관리 | 물리 자산, SW 인벤토리, IP 관리, 도메인/SSL, 변경 이력, 용량 계획 |
| 알림 | 알림 현황, 알림 규칙, 장애 내역 |
| 리포트 | 자산/알림/CPU/메모리/스토리지 현황 리포트 |
| 설정 | 시스템 설정, 사용자 관리, Agent 관리, 파싱 패턴 |

---

## 8. 데이터 관리

### DB 초기화 (데이터 삭제 후 재생성)

```bash
docker compose down -v
docker compose up -d
```

### DB 백업

```bash
docker exec argus-db pg_dump -U argus argus > backup.sql
```

### DB 복원

```bash
cat backup.sql | docker exec -i argus-db psql -U argus argus
```

### 마이그레이션 수동 실행

새 마이그레이션 파일 추가 후 기존 DB에 적용:

```bash
docker exec -i argus-db psql -U argus -d argus < scripts/migrations/010_software_installations.sql
```

---

## 9. 업데이트

```bash
git pull
docker compose up -d --build
```

> DB 스키마 변경이 있는 경우, 새 마이그레이션 파일을 수동으로 실행해야 합니다 (섹션 8 참조).

---

## 10. 방화벽 설정

서버 외부에서 접속하려면 방화벽 포트를 열어야 합니다:

```bash
# Ubuntu (ufw)
sudo ufw allow 3100/tcp   # 웹 대시보드
sudo ufw allow 5432/tcp   # PostgreSQL (외부 접속 필요 시)
sudo ufw allow 5140/udp   # Syslog 수집기 (사용 시)

# RHEL/Rocky (firewalld)
sudo firewall-cmd --permanent --add-port=3100/tcp
sudo firewall-cmd --permanent --add-port=5432/tcp
sudo firewall-cmd --permanent --add-port=5140/udp
sudo firewall-cmd --reload
```

> 보안을 위해 PostgreSQL 포트(5432)는 외부에 노출하지 않는 것을 권장합니다.

---

## 11. 트러블슈팅

### 로그 확인

```bash
# 전체 로그
docker compose logs -f

# 특정 서비스
docker compose logs -f web
docker compose logs -f postgres
```

### 컨테이너 상태 확인

```bash
docker compose ps
```

### 포트 충돌

| 포트 | 서비스 | 해결 방법 |
|------|--------|-----------|
| 5432 | PostgreSQL | `docker-compose.yml`에서 `"5433:5432"`로 변경 |
| 3100 | Web | `docker-compose.yml`에서 `"3101:3100"`로 변경 |

### DB 연결 실패

```bash
# DB 컨테이너 상태 확인
docker exec argus-db pg_isready -U argus

# DB 직접 접속
docker exec -it argus-db psql -U argus -d argus
```

---

## 디렉토리 구조

```
monitor/
├── agent/                  # Go 모니터링 에이전트
│   ├── cmd/agent/          # 에이전트 메인
│   └── Dockerfile
├── collector/              # Go Syslog 수집기
│   ├── cmd/syslogd/        # 수집기 메인
│   └── Dockerfile
├── scripts/
│   └── migrations/         # DB 마이그레이션 (자동 실행)
│       ├── 001_initial.sql
│       ├── ...
│       ├── 010_software_installations.sql
│       ├── 999_dev_seed.sql        # 테스트 데이터
│       └── 999_topology_edges.sql  # 토폴로지 데이터
├── web/                    # Next.js 14 대시보드
│   ├── src/
│   │   ├── app/            # 페이지 & API 라우트
│   │   ├── components/     # 공용 컴포넌트
│   │   └── lib/            # DB, 인증, 유틸리티
│   └── Dockerfile
└── docker-compose.yml      # Docker Compose 설정
```
