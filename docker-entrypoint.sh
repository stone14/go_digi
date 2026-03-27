#!/bin/sh
set -e

echo "=== Digicap Platform ==="

# Start Go backend
echo "[1/2] Starting Go backend on :${PORT:-3200}..."
./digicap-core &
GO_PID=$!

# Wait for Go backend
sleep 2

# Start Next.js frontend
echo "[2/2] Starting Next.js frontend on :3100..."
cd web
API_URL="http://localhost:${PORT:-3200}" PORT=3100 node server.js &
WEB_PID=$!

echo "=== All services started ==="
echo "  Backend:  http://localhost:${PORT:-3200}"
echo "  Frontend: http://localhost:3100"

# Handle signals
trap "kill $GO_PID $WEB_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait $GO_PID $WEB_PID
