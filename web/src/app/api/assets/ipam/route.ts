import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subnetId = req.nextUrl.searchParams.get('subnet_id')

  const subnets = await query<{
    id: number; subnet: string; name: string | null; vlan: number | null
    location: string | null; description: string | null
    total: number; used: number; reserved: number
  }>(
    `SELECT s.id, s.subnet::text AS subnet, s.name, s.vlan, s.location, s.description,
            (SELECT COUNT(*) FROM ip_allocations WHERE subnet_id = s.id)::int AS total,
            (SELECT COUNT(*) FROM ip_allocations WHERE subnet_id = s.id AND status = 'used')::int AS used,
            (SELECT COUNT(*) FROM ip_allocations WHERE subnet_id = s.id AND status = 'reserved')::int AS reserved
     FROM ip_subnets s WHERE s.is_active = true ORDER BY s.subnet`
  )

  const allocations = await query<{
    id: number; subnet_id: number; ip_address: string
    asset_id: number | null; hostname: string | null
    purpose: string | null; status: string; notes: string | null
  }>(
    subnetId
      ? `SELECT id, subnet_id, ip_address::text, asset_id, hostname, purpose, status, notes
         FROM ip_allocations WHERE subnet_id = $1 ORDER BY ip_address`
      : `SELECT id, subnet_id, ip_address::text, asset_id, hostname, purpose, status, notes
         FROM ip_allocations ORDER BY ip_address`,
    subnetId ? [subnetId] : []
  )

  return NextResponse.json({ subnets, allocations })
}

export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subnet, name, vlan, location, description } = await req.json()
  if (!subnet) return NextResponse.json({ error: 'subnet required' }, { status: 400 })

  const row = await queryOne<{ id: number }>(
    `INSERT INTO ip_subnets (subnet, name, vlan, location, description)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [subnet, name ?? null, vlan ?? null, location ?? null, description ?? null]
  )
  return NextResponse.json({ ok: true, id: row?.id })
}

export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, ip_address, asset_id, hostname, purpose, status, notes, subnet_id } = await req.json()
  if (!id && !ip_address) return NextResponse.json({ error: 'id or ip required' }, { status: 400 })

  if (id) {
    await execute(
      `UPDATE ip_allocations SET hostname=$1, purpose=$2, status=$3, notes=$4, updated_at=now() WHERE id=$5`,
      [hostname ?? null, purpose ?? null, status ?? 'used', notes ?? null, id]
    )
  } else {
    await execute(
      `INSERT INTO ip_allocations (subnet_id, ip_address, asset_id, hostname, purpose, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (ip_address) DO UPDATE SET hostname=$4, purpose=$5, status=$6, notes=$7, updated_at=now()`,
      [subnet_id, ip_address, asset_id ?? null, hostname ?? null, purpose ?? null, status ?? 'used', notes ?? null]
    )
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(`DELETE FROM ip_allocations WHERE id=$1`, [id])
  return NextResponse.json({ ok: true })
}
