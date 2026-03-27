package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/stone14/go_digi/internal/llm"
)

type LLM struct {
	pool     *pgxpool.Pool
	provider llm.Provider // can be nil if not configured
}

func NewLLM(pool *pgxpool.Pool) *LLM {
	return &LLM{pool: pool}
}

// initProvider reads llm_* settings from system_settings and creates a provider.
func (h *LLM) initProvider(ctx context.Context) (llm.Provider, error) {
	if h.provider != nil {
		return h.provider, nil
	}

	rows, err := h.pool.Query(ctx,
		`SELECT key, value FROM system_settings WHERE key LIKE 'llm_%'`)
	if err != nil {
		return nil, fmt.Errorf("failed to read LLM settings: %w", err)
	}
	defer rows.Close()

	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			continue
		}
		settings[k] = v
	}

	if settings["llm_enabled"] != "true" {
		return nil, fmt.Errorf("LLM is not enabled")
	}

	cfg := llm.Config{
		Provider: settings["llm_provider"],
		APIURL:   settings["llm_api_url"],
		APIKey:   settings["llm_api_key"],
		Model:    settings["llm_model"],
	}

	p := llm.NewProvider(cfg)
	if p == nil {
		return nil, fmt.Errorf("unsupported LLM provider: %s", cfg.Provider)
	}

	h.provider = p
	return p, nil
}

// GetConfig returns the current LLM configuration with the API key masked.
func (h *LLM) GetConfig(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT key, value FROM system_settings WHERE key LIKE 'llm_%' ORDER BY key`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	config := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			continue
		}
		// Mask API key
		if k == "llm_api_key" && len(v) > 8 {
			v = v[:4] + strings.Repeat("*", len(v)-8) + v[len(v)-4:]
		}
		config[k] = v
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"config": config})
}

// UpdateConfig updates llm_* settings in system_settings.
func (h *LLM) UpdateConfig(c echo.Context) error {
	var body map[string]string
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	allowed := map[string]bool{
		"llm_enabled": true, "llm_provider": true, "llm_api_url": true,
		"llm_api_key": true, "llm_model": true,
	}

	for key, value := range body {
		if !allowed[key] {
			continue
		}
		h.pool.Exec(ctx,
			`INSERT INTO system_settings (key, value) VALUES ($1, $2)
			 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
			key, value)
	}

	// Reset cached provider so it gets re-created with new settings.
	h.provider = nil

	return c.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// Chat handles a POST request with messages, calling the LLM provider.
// If the Accept header includes text/event-stream, it streams via SSE.
func (h *LLM) Chat(c echo.Context) error {
	var req struct {
		Messages []llm.Message `json:"messages"`
		Model    string        `json:"model"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if len(req.Messages) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "messages required"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 120*time.Second)
	defer cancel()

	provider, err := h.initProvider(ctx)
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
	}

	opts := llm.Options{Model: req.Model}

	// Check if client wants SSE streaming.
	accept := c.Request().Header.Get("Accept")
	if strings.Contains(accept, "text/event-stream") {
		return h.streamChat(c, ctx, provider, req.Messages, opts)
	}

	text, err := provider.Chat(ctx, req.Messages, opts)
	if err != nil {
		slog.Error("llm chat error", "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"response": text,
	})
}

func (h *LLM) streamChat(c echo.Context, ctx context.Context, provider llm.Provider, messages []llm.Message, opts llm.Options) error {
	ch, err := provider.Stream(ctx, messages, opts)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)

	flusher, ok := c.Response().Writer.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	for chunk := range ch {
		data, _ := json.Marshal(map[string]string{"text": chunk})
		fmt.Fprintf(c.Response().Writer, "data: %s\n\n", data)
		flusher.Flush()
	}

	fmt.Fprintf(c.Response().Writer, "data: [DONE]\n\n")
	flusher.Flush()

	return nil
}

// ListPredictions returns LLM predictions for an asset.
func (h *LLM) ListPredictions(c echo.Context) error {
	assetID, _ := strconv.Atoi(c.QueryParam("asset_id"))
	if assetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id required"})
	}

	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	rows, err := h.pool.Query(ctx,
		`SELECT id, asset_id, analysis_type, prompt, response, model, created_at
		 FROM llm_predictions WHERE asset_id = $1
		 ORDER BY created_at DESC LIMIT $2`, assetID, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type predRow struct {
		ID           int64     `json:"id"`
		AssetID      int       `json:"asset_id"`
		AnalysisType string    `json:"analysis_type"`
		Prompt       string    `json:"prompt"`
		Response     string    `json:"response"`
		Model        *string   `json:"model"`
		CreatedAt    time.Time `json:"created_at"`
	}

	var predictions []predRow
	for rows.Next() {
		var p predRow
		if err := rows.Scan(&p.ID, &p.AssetID, &p.AnalysisType, &p.Prompt, &p.Response, &p.Model, &p.CreatedAt); err != nil {
			continue
		}
		predictions = append(predictions, p)
	}
	if predictions == nil {
		predictions = []predRow{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"predictions": predictions})
}

// Analyze gathers data for an asset, sends it to the LLM, and stores the result.
func (h *LLM) Analyze(c echo.Context) error {
	var req struct {
		AssetID      int    `json:"asset_id"`
		AnalysisType string `json:"analysis_type"` // predict, log_analyze, capacity
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if req.AssetID == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "asset_id required"})
	}
	if req.AnalysisType == "" {
		req.AnalysisType = "predict"
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 120*time.Second)
	defer cancel()

	provider, err := h.initProvider(ctx)
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
	}

	// Gather context data for the asset.
	prompt, err := h.buildAnalysisPrompt(ctx, req.AssetID, req.AnalysisType)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	messages := []llm.Message{
		{Role: "system", Content: "You are an infrastructure monitoring AI. Analyze the provided server data and give actionable insights in Korean."},
		{Role: "user", Content: prompt},
	}

	opts := llm.Options{MaxTokens: 4096}

	text, err := provider.Chat(ctx, messages, opts)
	if err != nil {
		slog.Error("llm analyze error", "error", err, "asset_id", req.AssetID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Store the prediction.
	var model *string
	var predID int64
	h.pool.QueryRow(ctx,
		`INSERT INTO llm_predictions (asset_id, analysis_type, prompt, response, model)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		req.AssetID, req.AnalysisType, prompt, text, model,
	).Scan(&predID)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":       predID,
		"response": text,
	})
}

// buildAnalysisPrompt gathers relevant data for the asset and analysis type.
func (h *LLM) buildAnalysisPrompt(ctx context.Context, assetID int, analysisType string) (string, error) {
	var sb strings.Builder

	// Asset info
	var name, hostname, assetType, status string
	var os, osVer *string
	err := h.pool.QueryRow(ctx,
		`SELECT name, COALESCE(hostname,''), type, status, os, os_version
		 FROM assets WHERE id = $1`, assetID,
	).Scan(&name, &hostname, &assetType, &status, &os, &osVer)
	if err != nil {
		return "", fmt.Errorf("asset not found: %w", err)
	}

	sb.WriteString(fmt.Sprintf("Asset: %s (hostname: %s, type: %s, status: %s)\n", name, hostname, assetType, status))
	if os != nil {
		sb.WriteString(fmt.Sprintf("OS: %s", *os))
		if osVer != nil {
			sb.WriteString(fmt.Sprintf(" %s", *osVer))
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\n")

	switch analysisType {
	case "predict":
		sb.WriteString("Recent metrics (last 24h):\n")
		h.appendMetrics(ctx, &sb, assetID)
		sb.WriteString("\nAnalyze trends and predict potential issues in the next 7 days.\n")

	case "log_analyze":
		sb.WriteString("Recent logs:\n")
		h.appendLogs(ctx, &sb, assetID)
		sb.WriteString("\nAnalyze the logs for errors, warnings, and anomalies.\n")

	case "capacity":
		sb.WriteString("Current resource usage:\n")
		h.appendMetrics(ctx, &sb, assetID)
		sb.WriteString("\nDisk usage:\n")
		h.appendDisks(ctx, &sb, assetID)
		sb.WriteString("\nProvide capacity planning recommendations.\n")

	default:
		sb.WriteString("Provide a general health assessment.\n")
	}

	return sb.String(), nil
}

func (h *LLM) appendMetrics(ctx context.Context, sb *strings.Builder, assetID int) {
	rows, err := h.pool.Query(ctx,
		`SELECT collected_at, cpu_usage, mem_usage, disk_usage_pct, load_avg_1m
		 FROM metrics WHERE asset_id = $1 AND collected_at >= now() - interval '24 hours'
		 ORDER BY collected_at DESC LIMIT 50`, assetID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ts time.Time
		var cpu, mem, disk, load *float64
		if err := rows.Scan(&ts, &cpu, &mem, &disk, &load); err != nil {
			continue
		}
		sb.WriteString(fmt.Sprintf("  %s: cpu=%.1f%% mem=%.1f%% disk=%.1f%% load=%.2f\n",
			ts.Format("15:04"),
			ptrFloat(cpu), ptrFloat(mem), ptrFloat(disk), ptrFloat(load)))
	}
}

func (h *LLM) appendLogs(ctx context.Context, sb *strings.Builder, assetID int) {
	rows, err := h.pool.Query(ctx,
		`SELECT collected_at, level, source, message
		 FROM server_logs WHERE asset_id = $1
		 ORDER BY collected_at DESC LIMIT 50`, assetID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ts time.Time
		var level, source, msg *string
		if err := rows.Scan(&ts, &level, &source, &msg); err != nil {
			continue
		}
		sb.WriteString(fmt.Sprintf("  [%s] %s %s: %s\n",
			ts.Format("15:04"), ptrStr(level), ptrStr(source), ptrStr(msg)))
	}
}

func (h *LLM) appendDisks(ctx context.Context, sb *strings.Builder, assetID int) {
	rows, err := h.pool.Query(ctx,
		`SELECT DISTINCT ON (mount_point) mount_point, total_gb, used_gb
		 FROM disk_metrics WHERE asset_id = $1
		 ORDER BY mount_point, collected_at DESC`, assetID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var mp string
		var total, used *float64
		if err := rows.Scan(&mp, &total, &used); err != nil {
			continue
		}
		sb.WriteString(fmt.Sprintf("  %s: %.1f / %.1f GB\n", mp, ptrFloat(used), ptrFloat(total)))
	}
}

func ptrFloat(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
