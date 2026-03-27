package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stone14/go_digi/internal/llm"
)

// extractJSON extracts a string value from raw JSON by key.
func extractJSON(raw, key, fallback string) string {
	search := fmt.Sprintf(`"%s"`, key)
	idx := strings.Index(raw, search)
	if idx < 0 {
		return fallback
	}
	rest := raw[idx+len(search):]
	// skip :"
	ci := strings.Index(rest, `:"`)
	if ci < 0 {
		return fallback
	}
	rest = rest[ci+2:]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return fallback
	}
	return rest[:end]
}

// extractJSONFloat extracts a float value from raw JSON by key.
func extractJSONFloat(raw, key string, fallback float64) float64 {
	search := fmt.Sprintf(`"%s"`, key)
	idx := strings.Index(raw, search)
	if idx < 0 {
		return fallback
	}
	rest := raw[idx+len(search):]
	ci := strings.Index(rest, ":")
	if ci < 0 {
		return fallback
	}
	rest = strings.TrimSpace(rest[ci+1:])
	// Find end (comma, }, or whitespace)
	end := strings.IndexAny(rest, ",} \t\n")
	if end < 0 {
		end = len(rest)
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(rest[:end]), 64)
	if err != nil {
		return fallback
	}
	return v
}

// runLLMPrediction is a stub that will be connected to internal/llm later.
// It checks whether LLM prediction is enabled, gathers recent metrics for
// online assets, and (once wired up) calls the LLM analysis pipeline.
func runLLMPrediction(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	// ── Check feature flags ────────────────────────────────────────
	var llmEnabled, predictEnabled string
	pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'llm_enabled'`,
	).Scan(&llmEnabled)
	pool.QueryRow(ctx,
		`SELECT value FROM system_settings WHERE key = 'llm_predict_enabled'`,
	).Scan(&predictEnabled)

	if llmEnabled != "true" || predictEnabled != "true" {
		return nil
	}

	// ── Gather online assets with recent data ──────────────────────
	rows, err := pool.Query(ctx,
		`SELECT a.id, a.name
		 FROM assets a
		 WHERE a.status = 'online' AND a.is_active = true
		   AND EXISTS (
		     SELECT 1 FROM metrics m
		     WHERE m.asset_id = a.id
		       AND m.collected_at >= now() - interval '30 minutes'
		   )`)
	if err != nil {
		return fmt.Errorf("llm prediction asset query: %w", err)
	}
	defer rows.Close()

	type assetInfo struct {
		ID   int
		Name string
	}

	var assets []assetInfo
	for rows.Next() {
		var a assetInfo
		if err := rows.Scan(&a.ID, &a.Name); err != nil {
			continue
		}
		assets = append(assets, a)
	}
	rows.Close()

	if len(assets) == 0 {
		return nil
	}

	for _, a := range assets {
		// Collect last 30 minutes of metrics.
		metricRows, err := pool.Query(ctx,
			`SELECT collected_at, cpu_usage, mem_usage, disk_usage_pct, load_avg_1m
			 FROM metrics
			 WHERE asset_id = $1 AND collected_at >= now() - interval '30 minutes'
			 ORDER BY collected_at ASC`, a.ID)
		if err != nil {
			slog.Warn("llm metric query 실패", "asset_id", a.ID, "error", err)
			continue
		}

		type sample struct {
			CollectedAt time.Time
			CPU         *float64
			Mem         *float64
			Disk        *float64
			Load        *float64
		}

		var samples []sample
		for metricRows.Next() {
			var s sample
			if err := metricRows.Scan(&s.CollectedAt, &s.CPU, &s.Mem, &s.Disk, &s.Load); err != nil {
				continue
			}
			samples = append(samples, s)
		}
		metricRows.Close()

		if len(samples) < 5 {
			continue // not enough data for meaningful prediction
		}

		// Build prompt from metric samples
		var prompt string
		prompt = fmt.Sprintf("서버 '%s' (ID:%d)의 최근 30분 메트릭 데이터를 분석해주세요.\n\n", a.Name, a.ID)
		prompt += "시간 | CPU%% | MEM%% | DISK%% | LOAD\n"
		for _, s := range samples {
			cpu, mem, disk, load := 0.0, 0.0, 0.0, 0.0
			if s.CPU != nil {
				cpu = *s.CPU
			}
			if s.Mem != nil {
				mem = *s.Mem
			}
			if s.Disk != nil {
				disk = *s.Disk
			}
			if s.Load != nil {
				load = *s.Load
			}
			prompt += fmt.Sprintf("%s | %.1f | %.1f | %.1f | %.2f\n",
				s.CollectedAt.Format("15:04:05"), cpu, mem, disk, load)
		}
		prompt += "\n다음을 JSON으로 답변해주세요:\n"
		prompt += `{"issue_type":"normal|cpu_high|mem_high|disk_high|anomaly","severity":"info|warning|critical","confidence":0.0-1.0,"summary":"한줄 요약"}`

		// Load LLM config from DB
		var providerName, apiURL, apiKey, model string
		pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'llm_provider'`).Scan(&providerName)
		pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'llm_api_url'`).Scan(&apiURL)
		pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'llm_api_key'`).Scan(&apiKey)
		pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'llm_model'`).Scan(&model)

		if providerName == "" {
			slog.Debug("LLM provider 미설정, prediction 건너뜀")
			break
		}

		provider := llm.NewProvider(llm.Config{
			Provider: providerName,
			APIURL:   apiURL,
			APIKey:   apiKey,
			Model:    model,
		})
		if provider == nil {
			slog.Warn("알 수 없는 LLM provider", "provider", providerName)
			break
		}

		resp, err := provider.Chat(ctx, []llm.Message{
			{Role: "system", Content: "당신은 서버 모니터링 전문가입니다. 메트릭 데이터를 분석하고 이상 징후를 탐지합니다. JSON으로만 답변하세요."},
			{Role: "user", Content: prompt},
		}, llm.Options{MaxTokens: 500, Temperature: 0.3})
		if err != nil {
			slog.Warn("LLM prediction 호출 실패", "asset_id", a.ID, "error", err)
			continue
		}

		// Parse JSON response — extract fields with simple parsing
		issueType := extractJSON(resp, "issue_type", "normal")
		severity := extractJSON(resp, "severity", "info")
		confidence := extractJSONFloat(resp, "confidence", 0.5)
		summary := extractJSON(resp, "summary", "분석 완료")

		// Skip normal predictions
		if issueType == "normal" && severity == "info" {
			continue
		}

		pool.Exec(ctx,
			`INSERT INTO llm_predictions (asset_id, issue_type, severity, confidence, summary, raw_response)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			a.ID, issueType, severity, confidence, summary, resp)

		slog.Info("LLM prediction 저장", "asset_id", a.ID, "issue", issueType, "severity", severity)
	}

	slog.Info("LLM prediction 실행 완료", "assets_checked", len(assets))
	return nil
}
