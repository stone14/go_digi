import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// duration: UI uses minutes (duration_m), DB stores seconds (duration_s)
const toSeconds  = (m: number) => m * 60
const toMinutes  = (s: number) => Math.round(s / 60)

// GET /api/alerts/rules
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rules = await query<{
    id: number; name: string
    asset_id: number | null; asset_name: string | null
    asset_type_filter: string | null
    metric: string; operator: string; threshold: number
    duration_m: number       // converted from duration_s
    severity: string
    notify_channels: string[]
    is_active: boolean
  }>(
    `SELECT ar.id, ar.name, ar.asset_id, a.name AS asset_name,
            ar.asset_type_filter,
            ar.metric, ar.operator, ar.threshold,
            ar.duration_s,               -- will convert below
            ar.severity,
            ar.notify_channels,
            ar.is_active
     FROM alert_rules ar
     LEFT JOIN assets a ON a.id = ar.asset_id
     ORDER BY ar.severity, ar.name`
  )

  // Convert duration_s → duration_m for UI
  const result = (rules as unknown as Array<Record<string, unknown>>).map(r => ({
    ...r,
    duration_m: toMinutes(r.duration_s as number),
    duration_s: undefined,
  }))

  return NextResponse.json({ rules: result })
}

// POST /api/alerts/rules — create
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    name, asset_id, asset_type_filter,
    metric, operator, threshold,
    duration_m = 5,             // UI sends minutes → convert to seconds
    severity = 'critical',
    notify_channels = ['slack'],
  } = await req.json()

  if (!name || !metric || !operator || threshold == null) {
    return NextResponse.json(
      { error: 'name, metric, operator, threshold required' },
      { status: 400 }
    )
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO alert_rules
       (name, asset_id, asset_type_filter, metric, operator, threshold,
        duration_s, severity, notify_channels, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
     RETURNING id`,
    [
      name,
      asset_id ?? null,
      asset_type_filter ?? null,
      metric, operator, threshold,
      toSeconds(duration_m),   // minutes → seconds
      severity,
      notify_channels,         // TEXT[] — pg driver handles array
    ]
  )

  return NextResponse.json({ ok: true, id: row?.id })
}

// PUT /api/alerts/rules — update
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // duration_m (UI, minutes) → duration_s (DB, seconds)
  if ('duration_m' in fields) {
    fields.duration_s = toSeconds(fields.duration_m as number)
    delete fields.duration_m
  }

  const allowed = [
    'name','asset_id','asset_type_filter','metric','operator',
    'threshold','duration_s','severity','notify_channels','is_active',
  ]

  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = $${idx++}`)
      params.push(fields[key])
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  params.push(id)
  await execute(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = $${idx}`, params)

  return NextResponse.json({ ok: true })
}

// DELETE /api/alerts/rules?id=N
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(`DELETE FROM alert_rules WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
