import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/incidents?status=open&severity=&search=&limit=50
export async function GET(req: NextRequest) {
  await requireAuth()
  const p = new URL(req.url).searchParams
  const status   = p.get('status')   || ''
  const severity = p.get('severity') || ''
  const search   = p.get('search')   || ''
  const limit    = parseInt(p.get('limit') || '50')

  const conditions = ['1=1']
  const params: unknown[] = []
  let idx = 1

  if (status)   { conditions.push(`i.status = $${idx++}`);                  params.push(status) }
  if (severity) { conditions.push(`i.severity = $${idx++}`);                params.push(severity) }
  if (search)   { conditions.push(`i.title ILIKE $${idx++}`);               params.push(`%${search}%`) }

  const rows = await query<{
    id: number; title: string; severity: string; status: string
    asset_ids: number[]; alert_ids: number[]
    assigned_to: number | null; assigned_name: string | null
    root_cause: string | null; resolution: string | null
    opened_at: string; resolved_at: string | null
    timeline_count: number
  }>(
    `SELECT i.id, i.title, i.severity, i.status,
            i.asset_ids, i.alert_ids, i.assigned_to,
            u.username AS assigned_name,
            i.root_cause, i.resolution,
            i.opened_at, i.resolved_at,
            (SELECT COUNT(*) FROM incident_timeline t WHERE t.incident_id = i.id) AS timeline_count
     FROM incidents i
     LEFT JOIN users u ON u.id = i.assigned_to
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.opened_at DESC
     LIMIT ${limit}`,
    params
  )
  return NextResponse.json({ incidents: rows })
}

// POST /api/incidents
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  const { title, severity, asset_ids, alert_ids } = await req.json()

  const row = await queryOne<{ id: number }>(
    `INSERT INTO incidents (title, severity, asset_ids, alert_ids)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [title, severity, asset_ids ?? [], alert_ids ?? []]
  )

  if (row) {
    await execute(
      `INSERT INTO incident_timeline (incident_id, user_id, event_type, content)
       VALUES ($1, $2, 'status_change', '인시던트가 생성되었습니다')`,
      [row.id, user.id]
    )
  }

  return NextResponse.json({ ok: true, id: row?.id })
}

// PATCH /api/incidents
export async function PATCH(req: NextRequest) {
  const user = await requireAuth()
  const { id, action, content, assigned_to, root_cause, resolution } = await req.json()

  if (action === 'status') {
    const newStatus = content // 'investigating' | 'resolved'
    await execute(
      `UPDATE incidents SET status = $1 ${newStatus === 'resolved' ? ', resolved_at = now()' : ''}
       WHERE id = $2`,
      [newStatus, id]
    )
    await execute(
      `INSERT INTO incident_timeline (incident_id, user_id, event_type, content)
       VALUES ($1, $2, 'status_change', $3)`,
      [id, user.id, `상태 변경: ${newStatus}`]
    )
  } else if (action === 'comment') {
    await execute(
      `INSERT INTO incident_timeline (incident_id, user_id, event_type, content)
       VALUES ($1, $2, 'comment', $3)`,
      [id, user.id, content]
    )
  } else if (action === 'assign') {
    await execute(
      `UPDATE incidents SET assigned_to = $1 WHERE id = $2`,
      [assigned_to, id]
    )
    await execute(
      `INSERT INTO incident_timeline (incident_id, user_id, event_type, content)
       VALUES ($1, $2, 'assigned', $3)`,
      [id, user.id, `담당자 지정`]
    )
  } else if (action === 'update') {
    await execute(
      `UPDATE incidents SET root_cause = $1, resolution = $2 WHERE id = $3`,
      [root_cause ?? null, resolution ?? null, id]
    )
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/incidents?id=N
export async function DELETE(req: NextRequest) {
  await requireAuth()
  const id = new URL(req.url).searchParams.get('id')
  await execute(`DELETE FROM incidents WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
