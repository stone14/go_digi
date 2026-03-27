# ── Stage 1: Build Go backend ──
FROM golang:1.23-alpine AS go-builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
COPY config.json* ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o digicap-core ./cmd/server

# ── Stage 2: Build Next.js frontend ──
FROM node:20-alpine AS web-builder

WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: Production image ──
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata nodejs npm

WORKDIR /app

# Go backend
COPY --from=go-builder /app/digicap-core .
COPY --from=go-builder /app/config.json* ./
COPY --from=go-builder /app/migrations ./migrations/

# Next.js standalone
COPY --from=web-builder /app/.next/standalone ./web/
COPY --from=web-builder /app/.next/static ./web/.next/static
COPY --from=web-builder /app/public ./web/public

# Startup script
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

EXPOSE 3100 3200 5140/udp

ENTRYPOINT ["./docker-entrypoint.sh"]
