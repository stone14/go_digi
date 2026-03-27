package db

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/stone14/go_digi/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect는 PostgreSQL 커넥션 풀을 생성합니다.
func Connect(ctx context.Context, cfg config.DBConfig) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("DSN 파싱 실패: %w", err)
	}

	poolCfg.MaxConns = int32(cfg.MaxConns)

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("커넥션 풀 생성 실패: %w", err)
	}

	// 연결 테스트
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("DB ping 실패: %w", err)
	}

	slog.Info("PostgreSQL 연결",
		"host", cfg.Host,
		"port", cfg.Port,
		"database", cfg.Database,
		"max_conns", cfg.MaxConns,
	)

	return pool, nil
}
