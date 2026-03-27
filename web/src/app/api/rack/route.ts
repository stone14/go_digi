import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/rack — racks + units (+ optional ?assets=1 for available assets)
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)

  // Return all active assets with rack placement status
  if (url.searchParams.get('assets') === '1') {
    const assets = await query<{
      id: number; name: string; ip_address: string | null; type: string; status: string
      in_rack: boolean; rack_name: string | null
    }>(
      `SELECT a.id, a.name, a.ip_address::text AS ip_address, a.type, a.status,
              ru.id IS NOT NULL AS in_rack, r.name AS rack_name
       FROM assets a
       LEFT JOIN rack_units ru ON ru.asset_id = a.id
       LEFT JOIN racks r ON r.id = ru.rack_id
       WHERE a.is_active = true
       ORDER BY a.name`
    )
    return NextResponse.json({ assets })
  }

  const racks = await query<{ id: number; name: string; location: string | null; row_no: string | null; total_u: number; description: string | null }>(
    `SELECT id, name, location, row_no, total_u, description FROM racks ORDER BY name`
  )

  const units = await query<{
    id: number; rack_id: number; asset_id: number | null
    start_u: number; size_u: number; label: string; unit_type: string
    asset_status: string | null; asset_ip: string | null
    asset_name: string | null; manufacturer: string | null; model: string | null
  }>(
    `SELECT ru.id, ru.rack_id, ru.asset_id, ru.start_u, ru.size_u, ru.label, ru.unit_type,
            a.status AS asset_status, a.ip_address::text AS asset_ip,
            a.name AS asset_name, a.manufacturer, a.model
     FROM rack_units ru
     LEFT JOIN assets a ON a.id = ru.asset_id
     ORDER BY ru.rack_id, ru.start_u DESC`
  )

  return NextResponse.json({ racks, units })
}

// POST /api/rack — create rack or unit
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  if (action === 'create_rack') {
    const { name, location, row_no, total_u = 42, description } = body
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const row = await queryOne<{ id: number }>(
      `INSERT INTO racks (name, location, row_no, total_u, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, location ?? null, row_no ?? null, total_u, description ?? null]
    )
    return NextResponse.json({ ok: true, id: row?.id })
  }

  if (action === 'create_unit') {
    const { rack_id, start_u, size_u = 1, label, unit_type = 'server', asset_id } = body
    if (!rack_id || !start_u || !label) {
      return NextResponse.json({ error: 'rack_id, start_u, label required' }, { status: 400 })
    }

    // Validate rack exists and range fits
    const rack = await queryOne<{ total_u: number }>(
      `SELECT total_u FROM racks WHERE id = $1`, [rack_id]
    )
    if (!rack) return NextResponse.json({ error: 'rack not found' }, { status: 404 })
    if (start_u < 1 || start_u > rack.total_u || start_u - size_u + 1 < 1) {
      return NextResponse.json({ error: 'invalid U range' }, { status: 400 })
    }

    // Overlap check
    const overlap = await queryOne<{ id: number }>(
      `SELECT id FROM rack_units
       WHERE rack_id = $1
         AND start_u - size_u + 1 < $2 + 1
         AND $2 - $3 + 1 < start_u + 1`,
      [rack_id, start_u, size_u]
    )
    if (overlap) return NextResponse.json({ error: 'slot overlap' }, { status: 409 })

    const row = await queryOne<{ id: number }>(
      `INSERT INTO rack_units (rack_id, start_u, size_u, label, unit_type, asset_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [rack_id, start_u, size_u, label, unit_type, asset_id ?? null]
    )
    return NextResponse.json({ ok: true, id: row?.id })
  }

  return NextResponse.json({ error: 'invalid action' }, { status: 400 })
}

// PUT /api/rack — update rack or unit
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  if (action === 'update_rack') {
    const { id, name, location, row_no, total_u, description } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await execute(
      `UPDATE racks SET name = COALESCE($2, name), location = $3, row_no = $4,
              total_u = COALESCE($5, total_u), description = $6
       WHERE id = $1`,
      [id, name, location ?? null, row_no ?? null, total_u, description ?? null]
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'update_unit') {
    const { id, start_u, size_u, label, unit_type, asset_id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Get current unit for rack_id
    const current = await queryOne<{ rack_id: number; start_u: number; size_u: number }>(
      `SELECT rack_id, start_u, size_u FROM rack_units WHERE id = $1`, [id]
    )
    if (!current) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

    const newStartU = start_u ?? current.start_u
    const newSizeU = size_u ?? current.size_u

    // Validate range
    const rack = await queryOne<{ total_u: number }>(
      `SELECT total_u FROM racks WHERE id = $1`, [current.rack_id]
    )
    if (rack && (newStartU < 1 || newStartU > rack.total_u || newStartU - newSizeU + 1 < 1)) {
      return NextResponse.json({ error: 'invalid U range' }, { status: 400 })
    }

    // Overlap check (exclude self)
    if (start_u !== undefined || size_u !== undefined) {
      const overlap = await queryOne<{ id: number }>(
        `SELECT id FROM rack_units
         WHERE rack_id = $1 AND id != $2
           AND start_u - size_u + 1 < $3 + 1
           AND $3 - $4 + 1 < start_u + 1`,
        [current.rack_id, id, newStartU, newSizeU]
      )
      if (overlap) return NextResponse.json({ error: 'slot overlap' }, { status: 409 })
    }

    await execute(
      `UPDATE rack_units
       SET start_u = $2, size_u = $3, label = COALESCE($4, label),
           unit_type = COALESCE($5, unit_type), asset_id = $6
       WHERE id = $1`,
      [id, newStartU, newSizeU, label, unit_type, asset_id === undefined ? null : asset_id]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'invalid action' }, { status: 400 })
}

// DELETE /api/rack?type=rack&id=N or type=unit&id=N
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const id = url.searchParams.get('id')
  if (!type || !id) return NextResponse.json({ error: 'type, id required' }, { status: 400 })

  if (type === 'rack') {
    await execute(`DELETE FROM racks WHERE id = $1`, [id])
  } else if (type === 'unit') {
    await execute(`DELETE FROM rack_units WHERE id = $1`, [id])
  } else {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
