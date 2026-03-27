import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/service-checks?asset_id=N
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const checks = await query<{
    id: number; name: string; type: string; target: string
    timeout_s: number; expected_code: number | null; expected_body: string | null
    is_active: boolean
    status: string; response_ms: number | null; checked_at: string | null
  }>(
    `SELECT sc.id, sc.name, sc.type, sc.target,
            sc.timeout_s, sc.expected_code, sc.expected_body, sc.is_active,
            CASE COALESCE(r.status, 'unknown')
              WHEN 'ok'       THEN 'up'
              WHEN 'up'       THEN 'up'
              WHEN 'critical' THEN 'down'
              WHEN 'down'     THEN 'down'
              ELSE 'unknown'
            END AS status,
            r.response_ms, r.checked_at
     FROM service_checks sc
     LEFT JOIN LATERAL (
       SELECT status, response_ms, checked_at
       FROM service_check_results
       WHERE check_id = sc.id
       ORDER BY checked_at DESC
       LIMIT 1
     ) r ON true
     WHERE sc.asset_id = $1
     ORDER BY sc.name`,
    [assetId]
  )

  return NextResponse.json({ checks })
}

// POST /api/service-checks — create
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { asset_id, name, type, target, timeout_s = 10, expected_code, expected_body } = await req.json()
  if (!asset_id || !name || !type || !target) {
    return NextResponse.json({ error: 'asset_id, name, type, target required' }, { status: 400 })
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO service_checks (asset_id, name, type, target, timeout_s, expected_code, expected_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [asset_id, name, type, target, timeout_s, expected_code ?? null, expected_body ?? null]
  )

  return NextResponse.json({ ok: true, id: row?.id })
}

// DELETE /api/service-checks?id=N
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(`UPDATE service_checks SET is_active = false WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
