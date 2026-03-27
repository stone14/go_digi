import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/disk-metrics?asset_id=N&limit=1
// Returns latest disk metrics per mount_point for a server
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const asset_id = searchParams.get('asset_id')
  if (!asset_id) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  // Latest snapshot per mount point
  const rows = await query<{
    mount_point: string
    device: string | null
    filesystem: string | null
    total_gb: number | null
    used_gb: number | null
    collected_at: string
  }>(
    `SELECT DISTINCT ON (mount_point)
       mount_point, device, filesystem, total_gb, used_gb,
       collected_at::text
     FROM disk_metrics
     WHERE asset_id = $1
     ORDER BY mount_point, collected_at DESC`,
    [asset_id]
  )

  return NextResponse.json({ disks: rows })
}

// POST /api/disk-metrics — agent submits disk data
export async function POST(req: NextRequest) {
  // Token auth for agents
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)

  const { query: dbQuery } = await import('@/lib/db')
  const tokenRow = await dbQuery<{ asset_id: number }>(
    `SELECT asset_id FROM agent_tokens WHERE token=$1 AND revoked=false LIMIT 1`, [token]
  )
  if (!tokenRow.length) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const asset_id = tokenRow[0].asset_id
  const body = await req.json()
  const disks: Array<{
    mount_point: string; device?: string; filesystem?: string
    total_gb: number; used_gb: number
  }> = body.disks || []

  if (!disks.length) return NextResponse.json({ ok: true })

  for (const d of disks) {
    await dbQuery(
      `INSERT INTO disk_metrics (asset_id, mount_point, device, filesystem, total_gb, used_gb)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [asset_id, d.mount_point, d.device || null, d.filesystem || null, d.total_gb, d.used_gb]
    )
  }

  return NextResponse.json({ ok: true })
}
