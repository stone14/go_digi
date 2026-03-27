import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { asset_id, token } = await req.json()

    if (!asset_id || !token) {
      return NextResponse.json({ error: 'asset_id and token required' }, { status: 400 })
    }

    // 토큰 + asset_id 검증
    const tokenRow = await queryOne<{ id: number }>(
      'SELECT id FROM agent_tokens WHERE token = $1 AND asset_id = $2 AND revoked = false',
      [token, asset_id]
    )
    if (!tokenRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await execute(
      `UPDATE assets SET status = 'online', last_seen = now() WHERE id = $1`,
      [asset_id]
    )
    await execute(
      'UPDATE agent_tokens SET last_seen = now() WHERE id = $1',
      [tokenRow.id]
    )

    return NextResponse.json({ ok: true, ts: new Date().toISOString() })
  } catch (err) {
    console.error('[Agent Heartbeat]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
