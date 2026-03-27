import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

// POST /api/syslog  — Syslog Receiver가 전송
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      hostname, remote_addr, severity, facility,
      program, message, raw, received_at,
      event_type, parsed_data,
    } = body

    // hostname → asset_id 조회
    const asset = await queryOne<{ id: number }>(
      `SELECT id FROM assets
       WHERE hostname = $1 OR ip_address::text = $1
       LIMIT 1`,
      [hostname || remote_addr]
    )

    await execute(
      `INSERT INTO syslog_entries
         (asset_id, received_at, severity, facility, hostname, program,
          message, raw, event_type, parsed_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        asset?.id ?? null,
        received_at || new Date().toISOString(),
        severity ?? null,
        facility ?? null,
        hostname ?? remote_addr,
        program  ?? null,
        message,
        raw ?? message,
        event_type ?? 'generic',
        parsed_data ? JSON.stringify(parsed_data) : null,
      ]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Syslog API]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// GET /api/syslog?asset_id=N&limit=100&severity=3&event_type=PORT_STATUS
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const assetId   = searchParams.get('asset_id')
  const limit     = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const severity  = searchParams.get('severity')
  const eventType = searchParams.get('event_type')
  const since     = searchParams.get('since') // ISO 날짜

  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (assetId) { conditions.push(`asset_id = $${p++}`); params.push(parseInt(assetId)) }
  if (severity) { conditions.push(`severity <= $${p++}`); params.push(parseInt(severity)) }
  if (eventType) { conditions.push(`event_type = $${p++}`); params.push(eventType) }
  if (since) { conditions.push(`received_at > $${p++}`); params.push(since) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const { query } = await import('@/lib/db')
  const rows = await query(
    `SELECT id, asset_id, received_at, severity, facility,
            hostname, program, message, event_type, parsed_data
     FROM syslog_entries ${where}
     ORDER BY received_at DESC
     LIMIT $${p}`,
    [...params, limit]
  )

  return NextResponse.json(rows)
}
