import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/topology?layer=physical
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const layer = new URL(req.url).searchParams.get('layer') || 'physical'

  // topology_nodes / topology_edges 에서 조회
  const nodes = await query<{
    id: number
    asset_id: number | null
    node_type: string
    label: string
    pos_x: number
    pos_y: number
    status: string | null
    ip_address: string | null
  }>(
    `SELECT n.id, n.asset_id, n.node_type, n.label,
            n.pos_x, n.pos_y,
            a.status, a.ip_address::text AS ip_address
     FROM topology_nodes n
     LEFT JOIN assets a ON a.id = n.asset_id
     WHERE n.layer = $1
     ORDER BY n.id`,
    [layer]
  )

  const edges = await query<{
    id: number
    source_node: number
    target_node: number
    source_port: string | null
    target_port: string | null
    link_type: string | null
    method: string | null
    confidence: number
    is_active: boolean
  }>(
    `SELECT id, source_node, target_node, source_port, target_port,
            link_type, method, confidence, is_active
     FROM topology_edges
     WHERE layer = $1 AND is_active = true
     ORDER BY id`,
    [layer]
  )

  return NextResponse.json({ nodes, edges })
}

// PUT /api/topology — 노드 위치 저장
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { positions } = await req.json() as {
    positions: Array<{ id: number; x: number; y: number }>
  }

  for (const p of positions) {
    await query(
      `UPDATE topology_nodes SET pos_x = $1, pos_y = $2, updated_at = now() WHERE id = $3`,
      [p.x, p.y, p.id]
    )
  }

  return NextResponse.json({ ok: true })
}
