import { NextRequest, NextResponse } from 'next/server'
import { query, execute, queryOne } from '@/lib/db'

// GET /api/alerts
// ?status=active|acknowledged|resolved|all
// ?count=true  → { count: N } only
// ?asset_id=N
// ?severity=critical|warning|info
// ?search=    → title/message/asset_name ILIKE
// ?limit=50&offset=0
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status') || 'active'
  const countOnly   = searchParams.get('count')     === 'true'
  const assetId     = searchParams.get('asset_id')
  const severity    = searchParams.get('severity')
  const search      = searchParams.get('search')    || ''
  const limit       = Math.min(parseInt(searchParams.get('limit')  || '50'), 200)
  const offset      = parseInt(searchParams.get('offset') || '0')

  // UI uses 'acknowledged', DB stores 'acked'
  const dbStatus = statusParam === 'acknowledged' ? 'acked' : statusParam

  const conditions: string[] = []
  const params: unknown[]    = []
  let p = 1

  if (dbStatus !== 'all') {
    conditions.push(`al.status = $${p++}`)
    params.push(dbStatus)
  }
  if (assetId) {
    conditions.push(`al.asset_id = $${p++}`)
    params.push(parseInt(assetId))
  }
  if (severity) {
    conditions.push(`al.severity = $${p++}`)
    params.push(severity)
  }
  if (search) {
    conditions.push(`(al.title ILIKE $${p} OR al.message ILIKE $${p} OR a.name ILIKE $${p})`)
    params.push(`%${search}%`)
    p++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  if (countOnly) {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM alerts al LEFT JOIN assets a ON a.id = al.asset_id ${where}`,
      params
    )
    return NextResponse.json({ count: parseInt(row?.count || '0') })
  }

  const [rows, total] = await Promise.all([
    query(
      `SELECT al.id, al.asset_id, al.severity, al.title, al.message, al.source,
              -- normalize status back to UI convention
              CASE al.status WHEN 'acked' THEN 'acknowledged' ELSE al.status END AS status,
              al.fired_at      AS created_at,
              al.resolved_at,
              al.acked_at      AS acknowledged_at,
              a.name           AS asset_name,
              a.ip_address::text AS asset_ip
       FROM alerts al
       LEFT JOIN assets a ON a.id = al.asset_id
       ${where}
       ORDER BY al.fired_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM alerts al LEFT JOIN assets a ON a.id = al.asset_id ${where}`,
      params
    ),
  ])

  return NextResponse.json({
    alerts: rows,
    total:  parseInt(total?.count || '0'),
    limit, offset,
  })
}

// POST /api/alerts — ack or resolve
// body: { id, action: 'ack'|'resolve' }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const id     = body.id ?? body.alert_id
  const action = body.action

  if (!id || !action) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 })
  }

  if (action === 'ack') {
    await execute(
      `UPDATE alerts SET status = 'acked', acked_at = now()
       WHERE id = $1 AND status = 'active'`,
      [id]
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'resolve') {
    await execute(
      `UPDATE alerts SET status = 'resolved', resolved_at = now()
       WHERE id = $1 AND status IN ('active','acked')`,
      [id]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
