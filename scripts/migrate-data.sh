#!/bin/bash
set -e

# ============================================================
# Argus → Digicap 데이터 마이그레이션 스크립트
#
# 사용법:
#   ./scripts/migrate-data.sh [옵션]
#
# 옵션:
#   --src-host    소스 DB 호스트 (기본: localhost)
#   --src-port    소스 DB 포트   (기본: 5432)
#   --src-db      소스 DB 이름   (기본: argus)
#   --src-user    소스 DB 사용자 (기본: argus)
#   --dst-host    대상 DB 호스트 (기본: localhost)
#   --dst-port    대상 DB 포트   (기본: 5432)
#   --dst-db      대상 DB 이름   (기본: digicap)
#   --dst-user    대상 DB 사용자 (기본: digicap)
#   --skip-metrics  메트릭 데이터 건너뛰기 (대용량)
#   --dry-run       실제 실행 없이 확인만
# ============================================================

# 기본값
SRC_HOST="localhost"
SRC_PORT="5432"
SRC_DB="argus"
SRC_USER="argus"
DST_HOST="localhost"
DST_PORT="5432"
DST_DB="digicap"
DST_USER="digicap"
SKIP_METRICS=false
DRY_RUN=false
DUMP_FILE="/tmp/argus_data_dump.sql"

# 인수 파싱
while [[ $# -gt 0 ]]; do
  case $1 in
    --src-host)  SRC_HOST="$2"; shift 2 ;;
    --src-port)  SRC_PORT="$2"; shift 2 ;;
    --src-db)    SRC_DB="$2"; shift 2 ;;
    --src-user)  SRC_USER="$2"; shift 2 ;;
    --dst-host)  DST_HOST="$2"; shift 2 ;;
    --dst-port)  DST_PORT="$2"; shift 2 ;;
    --dst-db)    DST_DB="$2"; shift 2 ;;
    --dst-user)  DST_USER="$2"; shift 2 ;;
    --skip-metrics) SKIP_METRICS=true; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    *) echo "알 수 없는 옵션: $1"; exit 1 ;;
  esac
done

echo "============================================================"
echo "  Argus → Digicap 데이터 마이그레이션"
echo "============================================================"
echo ""
echo "  소스: ${SRC_USER}@${SRC_HOST}:${SRC_PORT}/${SRC_DB}"
echo "  대상: ${DST_USER}@${DST_HOST}:${DST_PORT}/${DST_DB}"
echo "  메트릭 건너뛰기: ${SKIP_METRICS}"
echo "  DRY RUN: ${DRY_RUN}"
echo ""

# ── 테이블 순서 (FK 의존성 고려) ──
# 부모 테이블 먼저, 자식 테이블 나중에
TABLES=(
  # 1단계: 독립 테이블
  "users"
  "organizations"
  "system_settings"
  "syslog_parse_patterns"

  # 2단계: users/orgs 참조
  "assets"
  "audit_logs"

  # 3단계: assets 참조
  "maintenance_contracts"
  "bmc_credentials"
  "agent_tokens"
  "agent_versions"
  "network_ports"
  "mac_addresses"
  "wwn_entries"
  "topology_nodes"
  "hw_inventory"
  "hw_health"
  "disk_smart"
  "storage_volumes"
  "storage_connections"
  "storage_volume_history"
  "virtual_hosts"
  "service_checks"
  "ssl_certificates"
  "ssl_domains"
  "asset_changes"
  "config_changes"
  "ip_subnets"
  "racks"
  "alert_rules"
  "escalation_policies"
  "incidents"
  "llm_providers"
  "llm_predictions"
  "custom_dashboards"
  "report_definitions"
  "discovery_logs"
  "device_mac_table"

  # 4단계: 3단계 참조
  "software_installations"
  "topology_edges"
  "virtual_machines"
  "service_check_results"
  "ip_allocations"
  "rack_units"
  "alerts"
  "llm_feature_assignments"
  "incident_timeline"
  "report_history"

  # 5단계: 4단계 참조
  "alert_notifications"
)

# 대용량 시계열 테이블 (선택적)
METRIC_TABLES=(
  "metrics"
  "metrics_5m"
  "metrics_1h"
  "disk_metrics"
  "bmc_metrics"
  "bmc_sel"
  "syslog_entries"
  "server_logs"
  "network_port_history"
  "llm_call_logs"
)

if [ "$SKIP_METRICS" = false ]; then
  TABLES+=("${METRIC_TABLES[@]}")
fi

# ── 1. 소스 DB 데이터 확인 ──
echo "[1/5] 소스 DB 데이터 확인 중..."
echo ""

SRC_CONN="postgresql://${SRC_USER}@${SRC_HOST}:${SRC_PORT}/${SRC_DB}"
DST_CONN="postgresql://${DST_USER}@${DST_HOST}:${DST_PORT}/${DST_DB}"

for t in "${TABLES[@]}"; do
  COUNT=$(psql "$SRC_CONN" -t -A -c "SELECT count(*) FROM ${t}" 2>/dev/null || echo "0")
  COUNT=$(echo "$COUNT" | tr -d '[:space:]')
  if [ "$COUNT" != "0" ]; then
    printf "  %-35s %s rows\n" "$t" "$COUNT"
  fi
done

echo ""

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] 실제 마이그레이션을 수행하지 않습니다."
  exit 0
fi

# ── 2. 대상 DB 기존 데이터 정리 ──
echo "[2/5] 대상 DB 기존 데이터 정리 중..."

# 역순으로 삭제 (FK 의존성)
REVERSED=()
for (( i=${#TABLES[@]}-1; i>=0; i-- )); do
  REVERSED+=("${TABLES[$i]}")
done

for t in "${REVERSED[@]}"; do
  psql "$DST_CONN" -c "TRUNCATE ${t} CASCADE;" 2>/dev/null || true
done

echo "  완료"
echo ""

# ── 3. pg_dump로 데이터 추출 ──
echo "[3/5] 소스 DB에서 데이터 추출 중..."

EXCLUDE_TABLES=""
if [ "$SKIP_METRICS" = true ]; then
  for t in "${METRIC_TABLES[@]}"; do
    EXCLUDE_TABLES="$EXCLUDE_TABLES --exclude-table=${t}"
  done
fi

# 파티셔닝 테이블의 default 파티션도 포함하여 덤프
pg_dump "$SRC_CONN" \
  --data-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  --disable-triggers \
  $EXCLUDE_TABLES \
  -f "$DUMP_FILE"

DUMP_SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
echo "  덤프 파일: ${DUMP_FILE} (${DUMP_SIZE})"
echo ""

# ── 4. 대상 DB에 데이터 로드 ──
echo "[4/5] 대상 DB에 데이터 로드 중..."

psql "$DST_CONN" \
  --single-transaction \
  -v ON_ERROR_STOP=1 \
  -f "$DUMP_FILE"

echo "  완료"
echo ""

# ── 5. 시퀀스 리셋 ──
echo "[5/5] 시퀀스 재설정 중..."

# 모든 serial/bigserial 시퀀스를 실제 max(id)로 리셋
psql "$DST_CONN" -t -A -c "
  SELECT 'SELECT setval(''' || seq.relname || ''', COALESCE((SELECT MAX(' || a.attname || ') FROM ' || t.relname || '), 1));'
  FROM pg_class seq
  JOIN pg_depend d ON d.objid = seq.oid
  JOIN pg_class t ON t.oid = d.refobjid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
  WHERE seq.relkind = 'S'
" | psql "$DST_CONN" -t -A

echo "  완료"
echo ""

# ── 6. admin 비밀번호 업데이트 (argus → digicap) ──
echo "[+] admin 비밀번호를 digicap 기본값으로 업데이트..."
psql "$DST_CONN" -c "
  UPDATE users SET
    email = REPLACE(email, '@argus.local', '@digicap.local'),
    password_hash = crypt('digicap1234!', gen_salt('bf'))
  WHERE username = 'admin' AND email LIKE '%@argus.local';
"
echo "  완료"
echo ""

# ── 정리 ──
rm -f "$DUMP_FILE"

# ── 결과 확인 ──
echo "============================================================"
echo "  마이그레이션 완료! 대상 DB 데이터 확인:"
echo "============================================================"
echo ""

for t in "${TABLES[@]}"; do
  COUNT=$(psql "$DST_CONN" -t -A -c "SELECT count(*) FROM ${t}" 2>/dev/null || echo "0")
  COUNT=$(echo "$COUNT" | tr -d '[:space:]')
  if [ "$COUNT" != "0" ]; then
    printf "  %-35s %s rows\n" "$t" "$COUNT"
  fi
done

echo ""
echo "마이그레이션이 성공적으로 완료되었습니다."
echo ""
echo "기본 admin 로그인:"
echo "  이메일: admin@digicap.local"
echo "  비밀번호: digicap1234!"
echo ""
echo "⚠️  프로덕션 환경에서는 반드시 비밀번호를 변경하세요."
