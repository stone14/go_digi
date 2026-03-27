import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'

// GET /api/agent/service-checks?asset_id=N&token=TOKEN
// Agent가 자신의 서비스 체크 목록을 가져옴
export async function GET(req: NextRequest) {
  try {
    const assetId = req.nextUrl.searchParams.get('asset_id')
    const token   = req.nextUrl.searchParams.get('token')

    if (!assetId || !token) {
      return NextResponse.json({ error: 'asset_id and token required' }, { status: 400 })
    }

    const tokenRow = await queryOne<{ id: number }>(
      'SELECT id FROM agent_tokens WHERE token = $1 AND asset_id = $2 AND revoked = false',
      [token, assetId]
    )
    if (!tokenRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const checks = await query<{
      id: number; name: string; type: string; target: string
      interval_s: number; timeout_s: number
      expected_code: number | null; expected_body: string | null
    }>(
      `SELECT id, name, type, target, interval_s, timeout_s, expected_code, expected_body
       FROM service_checks
       WHERE asset_id = $1 AND is_active = true
       ORDER BY id`,
      [assetId]
    )

    return NextResponse.json({ checks })
  } catch (err) {
    console.error('[Agent ServiceChecks GET]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST /api/agent/service-checks
// Agent가 서비스 체크 결과를 전송
export async function POST(req: NextRequest) {
  try {
    const { asset_id, token, results } = await req.json() as {
      asset_id: number
      token: string
      results: Array<{
        check_id: number
        status: string      // ok | warn | critical
        response_ms: number
        message?: string
      }>
    }

    if (!asset_id || !token || !results?.length) {
      return NextResponse.json({ error: 'asset_id, token, results required' }, { status: 400 })
    }

    const tokenRow = await queryOne<{ id: number }>(
      'SELECT id FROM agent_tokens WHERE token = $1 AND asset_id = $2 AND revoked = false',
      [token, asset_id]
    )
    if (!tokenRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    for (const r of results) {
      await execute(
        `INSERT INTO service_check_results (check_id, checked_at, status, response_ms, message)
         VALUES ($1, now(), $2, $3, $4)`,
        [r.check_id, r.status, r.response_ms, r.message ?? null]
      )
    }

    return NextResponse.json({ ok: true, count: results.length })
  } catch (err) {
    console.error('[Agent ServiceChecks POST]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
