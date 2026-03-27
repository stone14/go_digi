import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

const STORAGE_SELECT = `
  a.id, a.name, a.hostname,
  a.ip_address::text AS ip_address,
  a.type             AS storage_type,
  a.status, a.location,
  a.manufacturer, a.model, a.serial_number,
  a.monitoring_enabled, a.last_seen,
  (SELECT COUNT(*) FROM storage_connections sc
   WHERE sc.storage_asset_id = a.id AND sc.is_active = true) AS connected_servers,
  (SELECT COALESCE(SUM(sv.total_gb), 0) FROM storage_volumes sv WHERE sv.asset_id = a.id) AS total_gb,
  (SELECT COALESCE(SUM(sv.used_gb), 0)  FROM storage_volumes sv WHERE sv.asset_id = a.id) AS used_gb`

// GET /api/storage?type=nas&search=
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type   = searchParams.get('type')   // nas | san | das
  const search = searchParams.get('search') || ''
  const id     = searchParams.get('id')

  if (id) {
    const asset = await queryOne<Record<string, unknown>>(
      `SELECT ${STORAGE_SELECT} FROM assets a WHERE a.id = $1 AND a.type IN ('nas','san','das')`, [id]
    )
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const volumes = await query<Record<string, unknown>>(
      `SELECT id, volume_name, total_gb, used_gb, filesystem, raid_level, status
       FROM storage_volumes WHERE asset_id = $1 ORDER BY volume_name`, [id]
    )
    const connections = await query<Record<string, unknown>>(
      `SELECT sc.id, sc.connection_type, sc.mount_point, sc.is_active,
              a.id AS server_id, a.name AS server_name,
              a.ip_address::text AS server_ip, a.status AS server_status
       FROM storage_connections sc
       JOIN assets a ON a.id = sc.server_asset_id
       WHERE sc.storage_asset_id = $1
       ORDER BY a.name`, [id]
    )
    return NextResponse.json({ asset, volumes, connections })
  }

  const conds: string[] = [`a.type IN ('nas','san','das')`, `a.is_active = true`]
  const params: unknown[] = []

  if (type) { params.push(type); conds.push(`a.type = $${params.length}`) }
  if (search) { params.push(`%${search}%`); conds.push(`(a.name ILIKE $${params.length} OR a.ip_address::text ILIKE $${params.length})`) }

  const rows = await query<Record<string, unknown>>(
    `SELECT ${STORAGE_SELECT} FROM assets a WHERE ${conds.join(' AND ')} ORDER BY a.type, a.name`,
    params
  )
  return NextResponse.json({ storage: rows })
}

// POST /api/storage — create storage asset
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, hostname, ip_address, storage_type, location, manufacturer, model, serial_number } = body

  if (!name || !storage_type) return NextResponse.json({ error: 'name, storage_type required' }, { status: 400 })
  if (!['nas', 'san', 'das'].includes(storage_type)) return NextResponse.json({ error: 'Invalid storage_type' }, { status: 400 })

  const asset = await queryOne<{ id: number }>(
    `INSERT INTO assets (name, hostname, ip_address, type, location, manufacturer, model, serial_number, status)
     VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, 'unknown')
     RETURNING id`,
    [name, hostname || null, ip_address || null, storage_type, location || null, manufacturer || null, model || null, serial_number || null]
  )
  return NextResponse.json({ id: asset!.id }, { status: 201 })
}

// PUT /api/storage — update asset or add volume
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Add/update volume
  if (body.action === 'upsert_volume') {
    const { asset_id, volume_name, total_gb, used_gb, filesystem, raid_level } = body
    await execute(
      `INSERT INTO storage_volumes (asset_id, volume_name, total_gb, used_gb, filesystem, raid_level)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [asset_id, volume_name, total_gb || null, used_gb || null, filesystem || null, raid_level || null]
    )
    return NextResponse.json({ ok: true })
  }

  // Add connection
  if (body.action === 'connect') {
    const { storage_asset_id, server_asset_id, connection_type, mount_point } = body
    await execute(
      `INSERT INTO storage_connections (storage_asset_id, server_asset_id, connection_type, mount_point)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (storage_asset_id, server_asset_id) DO UPDATE
       SET connection_type = EXCLUDED.connection_type,
           mount_point = EXCLUDED.mount_point,
           is_active = true`,
      [storage_asset_id, server_asset_id, connection_type || 'nfs', mount_point || null]
    )
    return NextResponse.json({ ok: true })
  }

  // Disconnect
  if (body.action === 'disconnect') {
    await execute(
      `UPDATE storage_connections SET is_active = false
       WHERE storage_asset_id = $1 AND server_asset_id = $2`,
      [body.storage_asset_id, body.server_asset_id]
    )
    return NextResponse.json({ ok: true })
  }

  // Update asset fields
  const { id, name, location, monitoring_enabled } = body
  await execute(
    `UPDATE assets SET name=$2, location=$3, monitoring_enabled=$4, updated_at=now()
     WHERE id=$1`,
    [id, name, location || null, monitoring_enabled ?? true]
  )
  return NextResponse.json({ ok: true })
}

// DELETE /api/storage?id=N
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(`UPDATE assets SET is_active=false WHERE id=$1`, [id])
  return NextResponse.json({ ok: true })
}
