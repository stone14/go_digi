import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status') // active|decommission_pending|decommissioned

  const assets = await query<{
    id: number; name: string; hostname: string; ip_address: string
    asset_type: string; location: string; introduced_at: string | null
    lifecycle_status: string; decommission_at: string | null; decommission_note: string | null
    manufacturer: string | null; model: string | null
  }>(
    status
      ? `SELECT id, name, hostname, ip_address::text, type AS asset_type, location,
                introduced_at::text, lifecycle_status, decommission_at::text, decommission_note,
                manufacturer, model
         FROM assets WHERE lifecycle_status=$1 AND is_active=true ORDER BY name`
      : `SELECT id, name, hostname, ip_address::text, type AS asset_type, location,
                introduced_at::text, lifecycle_status, decommission_at::text, decommission_note,
                manufacturer, model
         FROM assets WHERE is_active=true ORDER BY lifecycle_status, name`,
    status ? [status] : []
  )

  return NextResponse.json({ assets })
}

export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, lifecycle_status, decommission_at, decommission_note } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(
    `UPDATE assets SET lifecycle_status=$1, decommission_at=$2, decommission_note=$3, updated_at=now() WHERE id=$4`,
    [lifecycle_status, decommission_at ?? null, decommission_note ?? null, id]
  )
  return NextResponse.json({ ok: true })
}
