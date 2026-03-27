import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

interface AnalyzeRequest {
  asset_id:   number
  asset_name: string
  type:       'cpu' | 'memory'
  provider:   'ollama' | 'openai' | 'anthropic'
  history:    { day: string; avg: number; max: number }[]
}

interface AnalysisResult {
  risk:           'danger' | 'warn' | 'ok'
  pattern:        string
  peak_7d:        number
  peak_30d:       number
  recommendation: string
}

// system_settings에서 LLM 설정 로드
async function loadSettings(): Promise<Record<string, string>> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings
     WHERE key IN ('llm_api_url','llm_api_key','llm_model','llm_provider')`
  )
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

// Ollama 호출
async function callOllama(apiUrl: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${apiUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 512 },
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Ollama 오류: HTTP ${res.status}`)
  const data = await res.json()
  return data.response || ''
}

// OpenAI 호출
async function callOpenAI(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       model || 'gpt-4o-mini',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens:  512,
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`OpenAI 오류: HTTP ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// Anthropic 호출
async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      model || 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Anthropic 오류: HTTP ${res.status}`)
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// JSON 파싱
function parseResult(text: string): AnalysisResult | null {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const obj = JSON.parse(match[0])
    return {
      risk:           obj.risk           || 'ok',
      pattern:        obj.pattern        || '불규칙',
      peak_7d:        parseFloat(obj.peak_7d)  || 0,
      peak_30d:       parseFloat(obj.peak_30d) || 0,
      recommendation: obj.recommendation || '',
    }
  } catch {
    return null
  }
}

// POST /api/assets/capacity/analyze
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as AnalyzeRequest
  const { asset_id, asset_name, type, provider, history } = body

  if (!asset_id || !type || !provider || !history?.length) {
    return NextResponse.json({ error: '필수 파라미터가 누락되었습니다' }, { status: 400 })
  }

  // 1. 캐시 확인 (1시간 이내 동일 asset + issue_type)
  const issueType = type === 'cpu' ? 'cpu_capacity' : 'mem_capacity'
  const cached = await queryOne<{ summary: string; raw_response: string; predicted_at: string }>(
    `SELECT summary, raw_response, predicted_at
     FROM llm_predictions
     WHERE asset_id = $1 AND issue_type = $2
       AND predicted_at >= now() - interval '1 hour'
     ORDER BY predicted_at DESC LIMIT 1`,
    [asset_id, issueType]
  )
  if (cached?.raw_response) {
    const parsed = parseResult(cached.raw_response)
    if (parsed) return NextResponse.json({ ...parsed, cached: true, analyzed_at: cached.predicted_at })
  }

  // 2. LLM 설정 로드
  const settings = await loadSettings()

  // 3. provider별 설정 검증 및 호출 준비
  const apiUrl   = settings.llm_api_url  || 'http://localhost:11434'
  const apiKey   = settings.llm_api_key  || ''
  const cfgModel = settings.llm_model    || ''

  const defaultModel: Record<string, string> = {
    ollama:    'llama3.2',
    openai:    'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
  }
  const model = cfgModel || defaultModel[provider]

  if ((provider === 'openai' || provider === 'anthropic') && !apiKey) {
    return NextResponse.json(
      { error: `${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API 키가 설정되지 않았습니다. 설정 > LLM 프로바이더 메뉴에서 입력해 주세요.` },
      { status: 400 }
    )
  }

  // 4. 프롬프트 생성
  const typeLabel = type === 'cpu' ? 'CPU' : '메모리'
  const current   = history[history.length - 1]?.avg ?? 0
  const max30     = Math.max(...history.map(h => h.max))
  const recent14  = history.slice(-14)

  const prompt = `서버 "${asset_name}"의 최근 30일 ${typeLabel} 사용률 트렌드를 분석하세요.
최근 14일 일별 데이터(day/avg/max): ${JSON.stringify(recent14)}
현재(최신일) 평균: ${current}%  /  30일 최대: ${max30}%

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"risk":"danger|warn|ok","pattern":"지속증가|급증반복|안정적|점진증가|불규칙","peak_7d":<숫자>,"peak_30d":<숫자>,"recommendation":"<한국어 2문장 이내>"}`

  // 5. LLM 호출
  let rawText = ''
  try {
    if (provider === 'ollama') {
      rawText = await callOllama(apiUrl, model, prompt)
    } else if (provider === 'openai') {
      rawText = await callOpenAI(apiKey, model, prompt)
    } else {
      rawText = await callAnthropic(apiKey, model, prompt)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `LLM 호출 실패: ${msg}` }, { status: 502 })
  }

  // 6. 파싱
  const result = parseResult(rawText)
  if (!result) {
    return NextResponse.json({ error: 'LLM 응답을 파싱할 수 없습니다', raw: rawText }, { status: 422 })
  }

  // 7. DB 캐싱
  const severity = result.risk === 'danger' ? 'critical' : result.risk === 'warn' ? 'warning' : 'info'
  await execute(
    `INSERT INTO llm_predictions (asset_id, issue_type, severity, confidence, summary, raw_response)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [asset_id, issueType, severity, 0.85, result.recommendation, rawText]
  ).catch(() => {})  // 캐싱 실패는 무시

  return NextResponse.json({ ...result, cached: false, provider, model })
}
