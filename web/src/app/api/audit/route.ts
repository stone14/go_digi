import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

interface AuditRow {
  id: number
  user_id: number | null
  username: string | null
  action: string
  target_type: string | null
  target_id: number | null
  detail: Record<string, unknown> | null
  ip_address: string | null
  occurred_at: string
}

// GET /api/audit?action=&target_type=&limit=&offset=&from=&to=
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const action     = searchParams.get('action')
  const targetType = searchParams.get('target_type')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const search     = searchParams.get('search')
  const limit      = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const offset     = parseInt(searchParams.get('offset') || '0')

  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (action) {
    conditions.push(`al.action = $${idx++}`)
    params.push(action)
  }
  if (targetType) {
    conditions.push(`al.target_type = $${idx++}`)
    params.push(targetType)
  }
  if (from) {
    conditions.push(`al.occurred_at >= $${idx++}`)
    params.push(from)
  }
  if (to) {
    conditions.push(`al.occurred_at <= $${idx++}`)
    params.push(to + 'T23:59:59Z')
  }
  if (search) {
    conditions.push(`(u.username ILIKE $${idx} OR al.action ILIKE $${idx} OR al.target_type ILIKE $${idx})`)
    params.push(`%${search}%`)
    idx++
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await query<AuditRow>(
    `SELECT al.id, al.user_id, u.username, al.action, al.target_type, al.target_id,
            al.detail, al.ip_address::text, al.occurred_at::text
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.occurred_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  )

  // Get total count for pagination
  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ${where}`,
    params
  )

  // Get distinct actions for filter dropdown
  const actions = await query<{ action: string }>(
    `SELECT DISTINCT action FROM audit_logs ORDER BY action`
  )

  return NextResponse.json({
    logs: rows,
    total: countResult[0]?.cnt ?? 0,
    actions: actions.map(a => a.action),
  })
}
