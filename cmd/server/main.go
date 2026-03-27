package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"github.com/stone14/go_digi/internal/auth"
	"github.com/stone14/go_digi/internal/config"
	"github.com/stone14/go_digi/internal/db"
	"github.com/stone14/go_digi/internal/handler"
	"github.com/stone14/go_digi/internal/middleware"
	"github.com/stone14/go_digi/internal/notify"
	"github.com/stone14/go_digi/internal/scheduler"
	syslogrcv "github.com/stone14/go_digi/internal/syslog"
	ws "github.com/stone14/go_digi/internal/websocket"
)

func main() {
	// 로거 초기화
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// 설정 로드
	cfg, err := config.Load()
	if err != nil {
		slog.Error("설정 로드 실패", "error", err)
		os.Exit(1)
	}
	slog.Info("설정 로드 완료", "port", cfg.Port, "db_host", cfg.DB.Host)

	// DB 연결
	pool, err := db.Connect(context.Background(), cfg.DB)
	if err != nil {
		slog.Error("DB 연결 실패", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("DB 연결 완료")

	// DB 마이그레이션
	if err := db.RunMigrations(cfg.DB); err != nil {
		slog.Warn("마이그레이션 실패 (무시)", "error", err)
	}

	// WebSocket Hub
	hub := ws.NewHub()
	go hub.Run()
	slog.Info("WebSocket Hub 시작")

	// Notifier
	notifier := notify.New(pool)
	_ = notifier // 스케줄러/알림 엔진에서 사용

	// Scheduler
	sched := scheduler.New(pool)
	sched.Start()
	slog.Info("스케줄러 시작")

	// Syslog Receiver (UDP 5140)
	syslogReceiver := syslogrcv.NewReceiver(pool, ":5140")
	syslogCtx, syslogCancel := context.WithCancel(context.Background())
	go func() {
		if err := syslogReceiver.Start(syslogCtx); err != nil {
			slog.Warn("Syslog 수신기 시작 실패", "error", err)
		}
	}()
	slog.Info("Syslog 수신기 시작", "addr", ":5140")

	// Echo 서버
	e := echo.New()
	e.HideBanner = true

	// 글로벌 미들웨어
	e.Use(echomw.Recover())
	e.Use(echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOrigins:     []string{"http://localhost:3100", "http://localhost:3000"},
		AllowCredentials: true,
	}))
	e.Use(middleware.RequestLogger())

	// ─── 핸들러 초기화 ───
	healthH := handler.NewHealth(pool)
	authH := handler.NewAuth(pool)
	usersH := handler.NewUsers(pool)
	assetsH := handler.NewAssets(pool)
	settingsH := handler.NewSettings(pool)
	orgsH := handler.NewOrganizations(pool)
	auditH := handler.NewAudit(pool)
	metricsH := handler.NewMetrics(pool)
	agentH := handler.NewAgent(pool)
	alertsH := handler.NewAlerts(pool)
	serviceChecksH := handler.NewServiceChecks(pool)
	incidentsH := handler.NewIncidents(pool)
	topologyH := handler.NewTopology(pool)
	networkH := handler.NewNetwork(pool)
	reportsH := handler.NewReports(pool)
	bmcH := handler.NewBMC(pool)
	sslH := handler.NewSSL(pool)
	llmH := handler.NewLLM(pool)
	syslogH := handler.NewSyslogHandler(pool)
	licenseH := handler.NewLicense(pool)

	// ─── 공개 라우트 ───
	e.GET("/health", healthH.Check)
	e.GET("/ws", hub.HandleWS)

	api := e.Group("/api")

	// 인증
	api.POST("/auth", authH.Login)
	api.DELETE("/auth", authH.Logout)

	// ─── Agent API (토큰 인증, 공개) ───
	agentAPI := api.Group("/agent")
	agentAPI.POST("/register", agentH.Register)
	agentAPI.POST("/pull-register", agentH.PullRegister)
	agentAPI.POST("/heartbeat", agentH.Heartbeat)
	agentAPI.POST("/metrics", metricsH.Ingest)
	agentAPI.GET("/service-checks", agentH.GetServiceChecks)
	agentAPI.POST("/service-check-results", agentH.PostServiceCheckResults)

	// Agent 다운로드/설치 (공개)
	api.GET("/agent/install-script", agentH.InstallScript)
	api.GET("/agent/download", agentH.Download)

	// ─── 인증 필요 라우트 ───
	authed := api.Group("", auth.RequireAuth())

	authed.GET("/auth", authH.Me)

	// 자산
	authed.GET("/assets", assetsH.List)
	authed.POST("/assets", assetsH.Create)
	authed.PUT("/assets", assetsH.Update)
	authed.DELETE("/assets", assetsH.Delete)

	// 조직
	authed.GET("/organizations", orgsH.List)
	authed.POST("/organizations", orgsH.Create)
	authed.PUT("/organizations", orgsH.Update)
	authed.DELETE("/organizations", orgsH.Delete)

	// 메트릭
	authed.GET("/metrics", metricsH.Query)
	authed.GET("/metrics/disk", metricsH.DiskMetrics)

	// 알림
	authed.GET("/alerts", alertsH.List)
	authed.POST("/alerts/action", alertsH.Action)
	authed.GET("/alert-rules", alertsH.ListRules)
	authed.POST("/alert-rules", alertsH.CreateRule)

	// 서비스 체크
	authed.GET("/service-checks", serviceChecksH.List)
	authed.POST("/service-checks", serviceChecksH.Create)
	authed.DELETE("/service-checks", serviceChecksH.Delete)

	// 서버 로그
	authed.GET("/server-logs", agentH.ServerLogs)

	// 인시던트
	authed.GET("/incidents", incidentsH.List)
	authed.POST("/incidents", incidentsH.Create)
	authed.PUT("/incidents", incidentsH.Update)
	authed.DELETE("/incidents", incidentsH.Delete)
	authed.GET("/incidents/timeline", incidentsH.Timeline)

	// 토폴로지
	authed.GET("/topology/nodes", topologyH.GetNodes)
	authed.GET("/topology/edges", topologyH.GetEdges)
	authed.PUT("/topology/layout", topologyH.SaveLayout)
	authed.POST("/topology/nodes", topologyH.CreateNode)
	authed.POST("/topology/edges", topologyH.CreateEdge)
	authed.DELETE("/topology/nodes", topologyH.DeleteNode)
	authed.DELETE("/topology/edges", topologyH.DeleteEdge)
	authed.GET("/topology/dependencies", topologyH.Dependencies)

	// 네트워크
	authed.GET("/network/ports", networkH.ListPorts)
	authed.PUT("/network/ports", networkH.UpdatePort)
	authed.GET("/network/mac-table", networkH.ListMacTable)

	// IPAM
	authed.GET("/ipam/subnets", networkH.ListSubnets)
	authed.POST("/ipam/subnets", networkH.CreateSubnet)
	authed.PUT("/ipam/subnets", networkH.UpdateSubnet)
	authed.DELETE("/ipam/subnets", networkH.DeleteSubnet)
	authed.GET("/ipam/allocations", networkH.ListAllocations)
	authed.POST("/ipam/allocations", networkH.CreateAllocation)
	authed.PUT("/ipam/allocations", networkH.UpdateAllocation)
	authed.DELETE("/ipam/allocations", networkH.DeleteAllocation)

	// 리포트
	authed.GET("/reports", reportsH.Generate)
	authed.GET("/reports/definitions", reportsH.ListDefinitions)
	authed.POST("/reports/definitions", reportsH.CreateDefinition)

	// BMC
	authed.GET("/bmc/credentials", bmcH.ListCredentials)
	authed.POST("/bmc/credentials", bmcH.SaveCredential)
	authed.DELETE("/bmc/credentials", bmcH.DeleteCredential)
	authed.GET("/bmc/metrics", bmcH.GetMetrics)
	authed.GET("/bmc/health", bmcH.GetHealth)
	authed.GET("/bmc/inventory", bmcH.GetInventory)
	authed.GET("/bmc/sel", bmcH.GetSEL)
	authed.POST("/bmc/collect", bmcH.Collect)

	// SSL
	authed.GET("/ssl", sslH.List)
	authed.POST("/ssl", sslH.Create)
	authed.DELETE("/ssl", sslH.Delete)
	authed.POST("/ssl/check", sslH.Check)

	// LLM
	authed.GET("/llm/config", llmH.GetConfig)
	authed.PUT("/llm/config", llmH.UpdateConfig)
	authed.POST("/llm/chat", llmH.Chat)
	authed.GET("/llm/predictions", llmH.ListPredictions)
	authed.POST("/llm/analyze", llmH.Analyze)

	// Syslog
	authed.GET("/syslog", syslogH.List)
	authed.GET("/syslog/patterns", syslogH.GetPatterns)
	authed.POST("/syslog/patterns", syslogH.CreatePattern)
	authed.PUT("/syslog/patterns", syslogH.UpdatePattern)
	authed.DELETE("/syslog/patterns", syslogH.DeletePattern)
	authed.GET("/syslog/stats", syslogH.Stats)

	// 라이선스
	authed.GET("/license", licenseH.GetStatus)

	// ─── 관리자 전용 라우트 ───
	admin := api.Group("", auth.RequireRole("admin"))

	// 사용자 관리
	admin.GET("/settings/users", usersH.List)
	admin.POST("/settings/users", usersH.Create)
	admin.PUT("/settings/users", usersH.Update)
	admin.DELETE("/settings/users", usersH.Delete)

	// Agent 토큰 관리
	admin.GET("/settings/agents", settingsH.ListAgentTokens)
	admin.POST("/settings/agents", settingsH.CreateAgentToken)
	admin.DELETE("/settings/agents", settingsH.RevokeAgentToken)

	// 시스템 설정
	admin.GET("/settings", settingsH.GetSystemSettings)
	admin.PUT("/settings", settingsH.UpdateSystemSettings)

	// 감사 로그
	admin.GET("/audit", auditH.List)

	// 라이선스 관리
	admin.POST("/license", licenseH.Activate)
	admin.DELETE("/license", licenseH.Deactivate)

	// ─── Graceful shutdown ───
	go func() {
		addr := ":" + cfg.Port
		slog.Info("서버 시작", "addr", addr)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			slog.Error("서버 에러", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("서버 종료 중...")
	sched.Stop()
	syslogCancel()
	_ = syslogReceiver.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(ctx); err != nil {
		slog.Error("서버 종료 에러", "error", err)
	}
	slog.Info("서버 종료 완료")
}
