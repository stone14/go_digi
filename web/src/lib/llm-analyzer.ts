/**
 * Digicap LLM 예측 분석기
 *
 * 수집된 메트릭/로그 트렌드를 LLM으로 분석하여
 * 이슈 발생 전에 예측 알림을 발송합니다.
 *
 * 지원 프로바이더: Ollama (내부) | OpenAI | Anthropic
 */
import { query, queryOne, execute } from './db'
import { sendSlack, sendEmail } from './notify'

interface LLMConfig {
  enabled:        boolean
  provider:       'ollama' | 'openai' | 'anthropic'
  apiUrl:         string
  apiKey:         string
  model:          string
  predictEnabled: boolean
}

interface MetricTrend {
  assetId:   number
  assetName: string
  samples:   Array<{
    ts:           string
    cpu:          number
    mem:          number
    diskPct:      number
    netRxBps:     number
    netTxBps:     number
    loadAvg1m:    number | null
    processCount: number | null
  }>
  recentLogs: string[]
}

interface Prediction {
  issueType:  string
  severity:   'critical' | 'warning' | 'info'
  confidence: number
  summary:    string
}

export async function runLLMPrediction() {
  const cfg = await loadConfig()
  if (!cfg.enabled || !cfg.predictEnabled) return

  try {
    const trends = await collectTrends()
    if (!trends.length) return

    for (const trend of trends) {
      const prediction = await analyzeTrend(cfg, trend)
      if (!prediction || prediction.confidence < 0.6) continue
      if (prediction.severity === 'info') continue  // info는 알림 생략

      await savePrediction(trend.assetId, prediction)
      await sendPredictionAlert(trend.assetName, prediction)
    }
  } catch (err) {
    console.error('[LLM Predict]', err)
  }
}

// 설정 로드
async function loadConfig(): Promise<LLMConfig> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings
     WHERE key IN (
       'llm_enabled','llm_provider','llm_api_url','llm_api_key',
       'llm_model','llm_predict_enabled'
     )`
  )
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    enabled:        cfg.llm_enabled        === 'true',
    provider:       (cfg.llm_provider      || 'ollama') as LLMConfig['provider'],
    apiUrl:         cfg.llm_api_url        || 'http://localhost:11434',
    apiKey:         cfg.llm_api_key        || '',
    model:          cfg.llm_model          || 'llama3.2',
    predictEnabled: cfg.llm_predict_enabled === 'true',
  }
}

// 최근 30분 메트릭 트렌드 수집 (모든 온라인 자산)
async function collectTrends(): Promise<MetricTrend[]> {
  const assets = await query<{ id: number; name: string }>(
    `SELECT id, name FROM assets
     WHERE status = 'online'
       AND last_seen > now() - interval '10 minutes'`
  )

  const trends: MetricTrend[] = []

  for (const asset of assets) {
    const samples = await query<{
      ts: string; cpu: number; mem: number; disk_usage_pct: number
      net_rx_bps: number; net_tx_bps: number
      load_avg_1m: number | null; process_count: number | null
    }>(
      `SELECT
         collected_at AS ts,
         cpu_usage    AS cpu,
         mem_usage    AS mem,
         disk_usage_pct,
         net_rx_bps,
         net_tx_bps,
         load_avg_1m,
         process_count
       FROM metrics
       WHERE asset_id = $1
         AND collected_at > now() - interval '30 minutes'
       ORDER BY collected_at ASC`,
      [asset.id]
    )

    if (samples.length < 3) continue  // 데이터 부족

    // 최근 로그 오류 수집
    const logs = await query<{ message: string }>(
      `SELECT message FROM server_logs
       WHERE asset_id = $1
         AND collected_at > now() - interval '10 minutes'
         AND level IN ('ERROR','WARN')
       ORDER BY collected_at DESC
       LIMIT 20`,
      [asset.id]
    )

    trends.push({
      assetId:   asset.id,
      assetName: asset.name,
      samples: samples.map(s => ({
        ts:           s.ts,
        cpu:          s.cpu,
        mem:          s.mem,
        diskPct:      s.disk_usage_pct,
        netRxBps:     s.net_rx_bps,
        netTxBps:     s.net_tx_bps,
        loadAvg1m:    s.load_avg_1m,
        processCount: s.process_count,
      })),
      recentLogs: logs.map(l => l.message),
    })
  }

  return trends
}

// LLM으로 트렌드 분석
async function analyzeTrend(cfg: LLMConfig, trend: MetricTrend): Promise<Prediction | null> {
  const prompt = buildPrompt(trend)

  try {
    let responseText: string

    if (cfg.provider === 'ollama') {
      responseText = await callOllama(cfg, prompt)
    } else if (cfg.provider === 'openai') {
      responseText = await callOpenAI(cfg, prompt)
    } else if (cfg.provider === 'anthropic') {
      responseText = await callAnthropic(cfg, prompt)
    } else {
      return null
    }

    return parsePrediction(responseText)
  } catch (err) {
    console.error(`[LLM] ${trend.assetName} 분석 실패:`, err)
    return null
  }
}

function buildPrompt(trend: MetricTrend): string {
  const latest = trend.samples[trend.samples.length - 1]
  const first  = trend.samples[0]

  const cpuTrend  = (latest.cpu   - first.cpu  ).toFixed(1)
  const memTrend  = (latest.mem   - first.mem  ).toFixed(1)
  const diskTrend = (latest.diskPct - first.diskPct).toFixed(1)

  const logSummary = trend.recentLogs.length
    ? `\n최근 오류 로그 (${trend.recentLogs.length}건):\n` +
      trend.recentLogs.slice(0, 5).map(l => `- ${l.slice(0, 120)}`).join('\n')
    : '\n최근 오류 로그: 없음'

  return `당신은 서버 모니터링 전문가입니다. 아래 서버 메트릭 트렌드를 분석하고 향후 15분 내 이슈를 예측하세요.

서버: ${trend.assetName}
분석 기간: 최근 30분 (${trend.samples.length}개 샘플)

현재 상태:
- CPU: ${latest.cpu.toFixed(1)}% (30분 변화: ${cpuTrend > '0' ? '+' : ''}${cpuTrend}%)
- 메모리: ${latest.mem.toFixed(1)}% (30분 변화: ${memTrend > '0' ? '+' : ''}${memTrend}%)
- 디스크 사용률: ${latest.diskPct.toFixed(1)}% (30분 변화: ${diskTrend > '0' ? '+' : ''}${diskTrend}%)
- 네트워크 수신: ${(latest.netRxBps / 1024 / 1024).toFixed(2)} MB/s
- 네트워크 송신: ${(latest.netTxBps / 1024 / 1024).toFixed(2)} MB/s
${latest.loadAvg1m !== null ? `- Load Average: ${latest.loadAvg1m.toFixed(2)}` : ''}
${latest.processCount !== null ? `- 프로세스 수: ${latest.processCount}` : ''}
${logSummary}

다음 JSON 형식으로만 응답하세요. 다른 텍스트 없이:
{
  "issue_detected": true|false,
  "issue_type": "cpu_spike|mem_leak|disk_full|network_anomaly|process_anomaly|log_error|normal",
  "severity": "critical|warning|info",
  "confidence": 0.0~1.0,
  "summary": "한국어로 간결한 예측 설명 (2문장 이내)"
}`
}

function parsePrediction(text: string): Prediction | null {
  try {
    // JSON 블록 추출
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const obj = JSON.parse(match[0])
    if (!obj.issue_detected) return null

    return {
      issueType:  obj.issue_type  || 'anomaly',
      severity:   obj.severity    || 'warning',
      confidence: parseFloat(obj.confidence) || 0,
      summary:    obj.summary     || '',
    }
  } catch {
    return null
  }
}

// --- LLM 프로바이더별 호출 ---

async function callOllama(cfg: LLMConfig, prompt: string): Promise<string> {
  const res = await fetch(`${cfg.apiUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:  cfg.model,
      prompt: prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 512 },
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}`)
  const data = await res.json()
  return data.response || ''
}

async function callOpenAI(cfg: LLMConfig, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model:       cfg.model || 'gpt-4o-mini',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens:  512,
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callAnthropic(cfg: LLMConfig, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      cfg.model || 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}`)
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// --- DB 저장 + 알림 발송 ---

async function savePrediction(assetId: number, pred: Prediction) {
  await execute(
    `INSERT INTO llm_predictions
       (asset_id, issue_type, severity, confidence, summary)
     VALUES ($1, $2, $3, $4, $5)`,
    [assetId, pred.issueType, pred.severity, pred.confidence, pred.summary]
  )
}

async function sendPredictionAlert(assetName: string, pred: Prediction) {
  const title   = `[예측] ${assetName} - ${issueTypeLabel(pred.issueType)}`
  const message = `${pred.summary}\n신뢰도: ${(pred.confidence * 100).toFixed(0)}%`

  const payload = {
    title,
    message,
    severity: pred.severity as 'critical' | 'warning' | 'info',
    assetName,
  }

  // Slack 알림
  await sendSlack(payload).catch(() => {})

  // 이메일 수신자 조회 (system_settings.llm_alert_email)
  const emailSetting = await queryOne<{ value: string }>(
    "SELECT value FROM system_settings WHERE key = 'llm_alert_email'"
  )
  if (emailSetting?.value) {
    await sendEmail(emailSetting.value.split(','), payload).catch(() => {})
  }
}

function issueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    cpu_spike:       'CPU 급증 예측',
    mem_leak:        '메모리 누수 예측',
    disk_full:       '디스크 부족 예측',
    network_anomaly: '네트워크 이상 예측',
    process_anomaly: '프로세스 이상 예측',
    log_error:       '로그 오류 급증',
    anomaly:         '이상 징후 감지',
  }
  return labels[type] || type
}
