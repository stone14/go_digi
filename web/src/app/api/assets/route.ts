import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logAuditFromRequest } from '@/lib/audit'

const ASSET_SELECT = `
  a.id, a.name, a.hostname,
  a.ip_address::text   AS ip_address,
  a.type               AS asset_type,   -- DB: type
  a.status,
  a.os                 AS os_type,      -- DB: os
  a.location,
  a.monitoring_enabled,
  a.last_seen,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.bmc_enabled,
  a.bmc_ip::text       AS bmc_ip,
  a.introduced_at::text AS introduced_at,
  a.lifecycle_status,
  a.decommission_at::text AS decommission_at,
  a.decommission_note,
  a.agent_version,
  a.registration_source,
  a.manager,
  a.user_name,
  a.user_team,
  a.org_id`

// GET /api/assets?id=N  (single)
// GET /api/assets?type=server&search=&page=1&limit=50
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)

  const idParam = searchParams.get('id')
  if (idParam) {
    const asset = await queryOne(
      `SELECT ${ASSET_SELECT} FROM assets a
       WHERE a.id = $1 AND a.is_active = true`,
      [idParam]
    )
    return NextResponse.json({ asset: asset ?? null })
  }

  const typeFilter = searchParams.get('type')   // maps to DB column `type`
  const search     = searchParams.get('search') ?? ''
  const page       = parseInt(searchParams.get('page')  ?? '1')
  const limit      = parseInt(searchParams.get('limit') ?? '50')
  const offset     = (page - 1) * limit

  const conditions: string[] = ['a.is_active = true']
  const params: unknown[]    = []
  let idx = 1

  if (typeFilter) {
    conditions.push(`a.type = $${idx++}`)
    params.push(typeFilter)
  }
  const statusFilter    = searchParams.get('status')
  const lifecycleFilter = searchParams.get('lifecycle')
  if (statusFilter) {
    conditions.push(`a.status = $${idx++}`)
    params.push(statusFilter)
  }
  if (lifecycleFilter) {
    conditions.push(`a.lifecycle_status = $${idx++}`)
    params.push(lifecycleFilter)
  }
  if (search) {
    conditions.push(`(a.name ILIKE $${idx} OR a.hostname ILIKE $${idx} OR a.ip_address::text ILIKE $${idx} OR a.manager ILIKE $${idx} OR a.user_name ILIKE $${idx})`)
    params.push(`%${search}%`)
    idx++
  }

  const where = conditions.join(' AND ')

  const [assets, countRow] = await Promise.all([
    query(
      `SELECT ${ASSET_SELECT}
       FROM assets a
       WHERE ${where}
       ORDER BY a.name
       LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM assets a WHERE ${where}`,
      params
    ),
  ])

  return NextResponse.json({
    assets,
    total: parseInt(countRow?.count ?? '0'),
    page,
    limit,
  })
}

// POST /api/assets — create
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    name, hostname, ip_address,
    asset_type,              // → DB: type
    os_type,                 // → DB: os
    location,
    manufacturer, model, serial_number,
    bmc_enabled = false, bmc_ip, bmc_type,
    monitoring_enabled = true,
    introduced_at,
    registration_source,
    manager, user_name, user_team, org_id,
  } = body

  if (!name || !ip_address || !asset_type) {
    return NextResponse.json({ error: 'name, ip_address, asset_type required' }, { status: 400 })
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO assets
       (name, hostname, ip_address, type, os, location,
        manufacturer, model, serial_number,
        bmc_enabled, bmc_ip, bmc_type, monitoring_enabled,
        introduced_at, registration_source,
        manager, user_name, user_team, org_id,
        status, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'offline',true)
     RETURNING id`,
    [
      name, hostname ?? '', ip_address,
      asset_type,                        // → type
      os_type ?? '',                     // → os
      location ?? '',
      manufacturer ?? null, model ?? null, serial_number ?? null,
      bmc_enabled, bmc_ip ?? null, bmc_type ?? null,
      monitoring_enabled,
      introduced_at ? introduced_at : null,
      registration_source ?? 'manual',
      manager ?? null, user_name ?? null, user_team ?? null,
      org_id || null,
    ]
  )

  await logAuditFromRequest('asset.create', 'asset', row?.id, { name })
  return NextResponse.json({ ok: true, id: row?.id })
}

// PUT /api/assets — update
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Map UI field names → DB column names
  const FIELD_MAP: Record<string, string> = {
    asset_type: 'type',
    os_type:    'os',
  }

  const allowed = [
    'name','hostname','ip_address','asset_type','os_type','location',
    'manufacturer','model','serial_number',
    'bmc_enabled','bmc_ip','bmc_type','monitoring_enabled','introduced_at',
    'lifecycle_status','decommission_at','decommission_note',
    'manager','user_name','user_team','org_id',
  ]

  // Fields where empty string should become null (date, inet, nullable text)
  const NULLABLE: Set<string> = new Set([
    'introduced_at', 'decommission_at', 'decommission_note',
    'bmc_ip', 'bmc_type', 'ip_address',
    'manufacturer', 'model', 'serial_number',
    'manager', 'user_name', 'user_team', 'org_id',
  ])

  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  for (const key of allowed) {
    if (key in fields) {
      const col = FIELD_MAP[key] ?? key
      sets.push(`${col} = $${idx++}`)
      const val = fields[key]
      params.push(NULLABLE.has(key) && (val === '' || val === undefined) ? null : val)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  params.push(id)
  await execute(
    `UPDATE assets SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx}`,
    params
  )

  await logAuditFromRequest('asset.update', 'asset', id, { fields: Object.keys(fields) })
  return NextResponse.json({ ok: true })
}

// DELETE /api/assets?id=N — soft delete
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(
    `UPDATE assets SET is_active = false, updated_at = now() WHERE id = $1`,
    [id]
  )
  await logAuditFromRequest('asset.delete', 'asset', parseInt(id))
  return NextResponse.json({ ok: true })
}
