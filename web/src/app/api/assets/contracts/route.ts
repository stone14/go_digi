import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

const SELECT_COLS = `
  id, asset_id, vendor, contract_type,
  contract_start::text AS start_date,
  contract_end::text   AS end_date,
  contact_name, contact_email, contact_phone, notes,
  software_name, software_version, license_count`

// GET /api/assets/contracts
//   ?asset_id=N   — single asset contracts (HW maintenance)
//   ?type=software — SW inventory list
//   (none)        — all active contracts
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId  = req.nextUrl.searchParams.get('asset_id')
  const typeFilter = req.nextUrl.searchParams.get('type')

  let contracts
  if (assetId) {
    contracts = await query(
      `SELECT ${SELECT_COLS}
       FROM maintenance_contracts
       WHERE asset_id = $1 AND is_active = true
       ORDER BY contract_end DESC`,
      [assetId]
    )
  } else if (typeFilter === 'software') {
    contracts = await query(
      `SELECT mc.id, mc.asset_id, mc.vendor, mc.contract_type,
              mc.contract_start::text AS start_date,
              mc.contract_end::text   AS end_date,
              mc.contact_name, mc.contact_email, mc.contact_phone, mc.notes,
              mc.software_name, mc.software_version, mc.license_count,
              COALESCE(si.installed_servers, '[]'::json) AS installed_servers
       FROM maintenance_contracts mc
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'asset_id', a.id, 'name', a.name, 'ip_address', a.ip_address
         )) AS installed_servers
         FROM software_installations s
         JOIN assets a ON a.id = s.asset_id
         WHERE s.contract_id = mc.id
       ) si ON true
       WHERE mc.contract_type = 'software' AND mc.is_active = true
       ORDER BY mc.contract_end ASC`
    )
  } else {
    contracts = await query(
      `SELECT ${SELECT_COLS}
       FROM maintenance_contracts
       WHERE is_active = true
       ORDER BY contract_end ASC`
    )
  }

  return NextResponse.json({ contracts })
}

// POST /api/assets/contracts — create or upsert
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    asset_id,
    vendor,
    contract_type = 'maintenance',
    start_date,
    end_date,
    contact_name, contact_email, contact_phone, notes,
    software_name, software_version, license_count,
  } = await req.json()

  if (!vendor) {
    return NextResponse.json({ error: 'vendor required' }, { status: 400 })
  }
  if (contract_type !== 'software' && !asset_id) {
    return NextResponse.json({ error: 'asset_id required for non-software contracts' }, { status: 400 })
  }

  // Deactivate existing contracts for same asset+vendor (HW) or same sw+vendor (SW)
  if (asset_id) {
    await execute(
      `UPDATE maintenance_contracts SET is_active = false
       WHERE asset_id = $1 AND vendor = $2`,
      [asset_id, vendor]
    )
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO maintenance_contracts
       (asset_id, vendor, contract_type,
        contract_start, contract_end,
        contact_name, contact_email, contact_phone, notes,
        software_name, software_version, license_count,
        has_contract, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,true)
     RETURNING id`,
    [
      asset_id ?? null,
      vendor,
      contract_type,
      start_date   ?? null,
      end_date     ?? null,
      contact_name  ?? null,
      contact_email ?? null,
      contact_phone ?? null,
      notes         ?? null,
      software_name    ?? null,
      software_version ?? null,
      license_count    ?? null,
    ]
  )

  return NextResponse.json({ ok: true, id: row?.id })
}

// PUT /api/assets/contracts — update existing
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    id, vendor, contract_type,
    start_date, end_date,
    contact_name, contact_email, contact_phone, notes,
    software_name, software_version, license_count,
  } = await req.json()

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(
    `UPDATE maintenance_contracts SET
       vendor          = $1,
       contract_type   = $2,
       contract_start  = $3,
       contract_end    = $4,
       contact_name    = $5,
       contact_email   = $6,
       contact_phone   = $7,
       notes           = $8,
       software_name    = $9,
       software_version = $10,
       license_count    = $11,
       updated_at      = now()
     WHERE id = $12`,
    [
      vendor, contract_type,
      start_date   ?? null,
      end_date     ?? null,
      contact_name  ?? null,
      contact_email ?? null,
      contact_phone ?? null,
      notes         ?? null,
      software_name    ?? null,
      software_version ?? null,
      license_count    ?? null,
      id,
    ]
  )

  return NextResponse.json({ ok: true })
}

// DELETE /api/assets/contracts?id=N
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(
    `UPDATE maintenance_contracts SET is_active = false WHERE id = $1`,
    [id]
  )
  return NextResponse.json({ ok: true })
}
