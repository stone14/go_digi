import { NextRequest, NextResponse } from 'next/server'
import { query, execute, queryOne } from '@/lib/db'

const LLM_KEYS = [
  'llm_enabled', 'llm_provider', 'llm_api_url', 'llm_api_key',
  'llm_model', 'llm_predict_enabled', 'llm_predict_interval', 'llm_alert_email',
]

// GET: LLM 설정 조회 + 최근 예측 이력
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'config'

  if (type === 'predictions') {
    const limit  = parseInt(searchParams.get('limit') || '50')
    const assetId = searchParams.get('asset_id')

    const rows = await query(
      `SELECT p.id, p.asset_id, a.name AS asset_name,
              p.predicted_at, p.issue_type, p.severity,
              p.confidence, p.summary, p.alert_sent
         FROM llm_predictions p
         JOIN assets a ON a.id = p.asset_id
        ${assetId ? 'WHERE p.asset_id = $2' : ''}
        ORDER BY p.predicted_at DESC
        LIMIT $1`,
      assetId ? [limit, assetId] : [limit]
    )
    return NextResponse.json({ predictions: rows })
  }

  // config
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
    [LLM_KEYS]
  )
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]))
  // API key는 마스킹
  if (cfg.llm_api_key) {
    cfg.llm_api_key = cfg.llm_api_key.slice(0, 6) + '••••••••'
  }
  return NextResponse.json({ config: cfg })
}

// PUT: LLM 설정 업데이트
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    for (const [key, value] of Object.entries(body)) {
      if (!LLM_KEYS.includes(key)) continue
      // API key가 마스킹된 값이면 건너뜀
      if (key === 'llm_api_key' && String(value).includes('••')) continue

      await execute(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, String(value)]
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[LLM config]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST: LLM 연결 테스트 or 수동 분석 실행
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'test'

  if (action === 'test') {
    try {
      const body = await req.json()
      const { provider, api_url, api_key, model } = body

      let testPrompt = '응답 테스트입니다. "OK"라고만 대답하세요.'
      let ok = false

      if (provider === 'ollama') {
        const res = await fetch(`${api_url}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: testPrompt, stream: false }),
          signal: AbortSignal.timeout(10000),
        })
        ok = res.ok
      } else if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api_key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: testPrompt }],
            max_tokens: 10,
          }),
          signal: AbortSignal.timeout(10000),
        })
        ok = res.ok
      } else if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: testPrompt }],
          }),
          signal: AbortSignal.timeout(10000),
        })
        ok = res.ok
      }

      return NextResponse.json({ ok, provider })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) })
    }
  }

  if (action === 'analyze') {
    // 수동 즉시 분석 실행
    try {
      const { runLLMPrediction } = await import('@/lib/llm-analyzer')
      await runLLMPrediction()
      return NextResponse.json({ ok: true, message: '분석 완료' })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
