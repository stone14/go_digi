import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  const limit   = parseInt(req.nextUrl.searchParams.get('limit') ?? '100')

  const changes = await query<{
    id: number; asset_id: number | null; asset_name: string | null
    field_name: string; old_value: string | null; new_value: string | null
    changed_by: string | null; note: string | null; changed_at: string
  }>(
    assetId
      ? `SELECT id, asset_id, asset_name, field_name, old_value, new_value,
                changed_by, note, changed_at::text
         FROM asset_changes WHERE asset_id=$1 ORDER BY changed_at DESC LIMIT $2`
      : `SELECT id, asset_id, asset_name, field_name, old_value, new_value,
                changed_by, note, changed_at::text
         FROM asset_changes ORDER BY changed_at DESC LIMIT $1`,
    assetId ? [assetId, limit] : [limit]
  )

  return NextResponse.json({ changes })
}

export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { asset_id, asset_name, field_name, old_value, new_value, changed_by, note } = await req.json()
  if (!field_name) return NextResponse.json({ error: 'field_name required' }, { status: 400 })

  await execute(
    `INSERT INTO asset_changes (asset_id, asset_name, field_name, old_value, new_value, changed_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [asset_id ?? null, asset_name ?? null, field_name, old_value ?? null,
     new_value ?? null, changed_by ?? null, note ?? null]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(`DELETE FROM asset_changes WHERE id=$1`, [id])
  return NextResponse.json({ ok: true })
}
