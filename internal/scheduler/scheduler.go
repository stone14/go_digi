package scheduler

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

// Scheduler wraps robfig/cron and the database pool.
type Scheduler struct {
	pool *pgxpool.Pool
	cron *cron.Cron
}

// New creates a new Scheduler with the given connection pool.
func New(pool *pgxpool.Pool) *Scheduler {
	return &Scheduler{
		pool: pool,
	}
}

// Start initialises the cron instance and registers every recurring job.
func (s *Scheduler) Start() {
	s.cron = cron.New(cron.WithSeconds())

	// Alert evaluation — every 1 min
	s.cron.AddFunc("0 */1 * * * *", func() {
		ctx := context.Background()
		if err := runAlertEvaluation(ctx, s.pool); err != nil {
			slog.Error("alert evaluation 실패", "error", err)
		}
	})

	// Offline check — every 1 min
	s.cron.AddFunc("0 */1 * * * *", func() {
		ctx := context.Background()
		if err := runOfflineCheck(ctx, s.pool); err != nil {
			slog.Error("offline check 실패", "error", err)
		}
	})

	// Metric aggregation — every 5 min
	s.cron.AddFunc("0 */5 * * * *", func() {
		ctx := context.Background()
		if err := runAggregation(ctx, s.pool); err != nil {
			slog.Error("metric aggregation 실패", "error", err)
		}
	})

	// Service checks — every 1 min
	s.cron.AddFunc("0 */1 * * * *", func() {
		ctx := context.Background()
		if err := runServiceChecks(ctx, s.pool); err != nil {
			slog.Error("service checks 실패", "error", err)
		}
	})

	// Agent poll (pull mode) — every 1 min
	s.cron.AddFunc("0 */1 * * * *", func() {
		ctx := context.Background()
		if err := runAgentPoll(ctx, s.pool); err != nil {
			slog.Error("agent poll 실패", "error", err)
		}
	})

	// BMC collection — every 5 min
	s.cron.AddFunc("0 */5 * * * *", func() {
		ctx := context.Background()
		if err := runBMCCollect(ctx, s.pool); err != nil {
			slog.Error("BMC collect 실패", "error", err)
		}
	})

	// SSL check — daily at 2:00 AM
	s.cron.AddFunc("0 0 2 * * *", func() {
		ctx := context.Background()
		if err := runSSLCheck(ctx, s.pool); err != nil {
			slog.Error("SSL check 실패", "error", err)
		}
	})

	// Maintenance check — daily at 3:00 AM
	s.cron.AddFunc("0 0 3 * * *", func() {
		ctx := context.Background()
		if err := runMaintenanceCheck(ctx, s.pool); err != nil {
			slog.Error("maintenance check 실패", "error", err)
		}
	})

	// LLM prediction — every 5 min
	s.cron.AddFunc("0 */5 * * * *", func() {
		ctx := context.Background()
		if err := runLLMPrediction(ctx, s.pool); err != nil {
			slog.Error("LLM prediction 실패", "error", err)
		}
	})

	s.cron.Start()
	slog.Info("스케줄러 시작 완료", "jobs", len(s.cron.Entries()))
}

// Stop gracefully shuts down the cron scheduler.
func (s *Scheduler) Stop() {
	if s.cron != nil {
		s.cron.Stop()
		slog.Info("스케줄러 종료")
	}
}
