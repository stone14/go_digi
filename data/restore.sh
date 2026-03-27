#!/bin/bash
set -e

# ============================================================
# Digicap DB 데이터 복원 스크립트
#
# 사전 조건:
#   1. PostgreSQL 16이 실행 중
#   2. digicap DB가 생성되어 있고 스키마가 적용된 상태
#      (Go 서버를 한 번 실행하면 자동 마이그레이션)
#
# 사용법:
#   # Docker Compose 환경
#   docker exec -i digicap-db pg_restore -U digicap -d digicap \
#     --data-only --disable-triggers --no-owner < data/digicap_data.dump
#
#   # 또는 이 스크립트 실행
#   ./data/restore.sh [OPTIONS]
#
# 옵션:
#   --host     DB 호스트 (기본: localhost)
#   --port     DB 포트 (기본: 5432)
#   --db       DB 이름 (기본: digicap)
#   --user     DB 사용자 (기본: argus)
#   --docker   Docker 컨테이너 이름 (설정 시 docker exec 사용)
# ============================================================

HOST="localhost"
PORT="5432"
DB="digicap"
USER="argus"
DOCKER=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DUMP_FILE="${SCRIPT_DIR}/digicap_data.dump"

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)   HOST="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --db)     DB="$2"; shift 2 ;;
    --user)   USER="$2"; shift 2 ;;
    --docker) DOCKER="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1"; exit 1 ;;
  esac
done

if [ ! -f "$DUMP_FILE" ]; then
  echo "Error: ${DUMP_FILE} 파일이 없습니다."
  exit 1
fi

echo "============================================================"
echo "  Digicap DB 데이터 복원"
echo "============================================================"
echo ""

if [ -n "$DOCKER" ]; then
  echo "Docker 컨테이너: ${DOCKER}"
  echo "DB: ${DB} (user: ${USER})"
  echo ""

  # dump 파일을 컨테이너로 복사
  docker cp "$DUMP_FILE" "${DOCKER}:/tmp/digicap_data.dump"

  # 복원
  docker exec "$DOCKER" pg_restore -U "$USER" -d "$DB" \
    --data-only --disable-triggers --no-owner \
    --clean --if-exists \
    /tmp/digicap_data.dump 2>&1 || true

  # 정리
  docker exec "$DOCKER" rm -f /tmp/digicap_data.dump

else
  echo "Host: ${HOST}:${PORT}"
  echo "DB: ${DB} (user: ${USER})"
  echo ""

  pg_restore -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" \
    --data-only --disable-triggers --no-owner \
    --clean --if-exists \
    "$DUMP_FILE" 2>&1 || true
fi

echo ""
echo "복원 완료!"
echo ""
echo "기본 로그인:"
echo "  admin@digicap.local / digicap1234!"
