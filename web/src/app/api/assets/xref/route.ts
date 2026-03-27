import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/assets/xref?id=N — 자산 교차 참조 (랙 위치, 토폴로지, 에이전트)
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const [rack, topology, agent] = await Promise.all([
    queryOne<{ rack_name: string; start_u: number; size_u: number }>(
      `SELECT r.name AS rack_name, ru.start_u, ru.size_u
       FROM rack_units ru JOIN racks r ON r.id = ru.rack_id
       WHERE ru.asset_id = $1 LIMIT 1`,
      [id]
    ),
    queryOne<{ in_topology: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM topology_nodes WHERE asset_id = $1) AS in_topology`,
      [id]
    ),
    queryOne<{ last_seen: string }>(
      `SELECT at.last_seen::text
       FROM agent_tokens at
       WHERE at.asset_id = $1 AND at.revoked = false
       ORDER BY at.last_seen DESC NULLS LAST LIMIT 1`,
      [id]
    ),
  ])

  return NextResponse.json({
    rack: rack ?? null,
    in_topology: topology?.in_topology ?? false,
    agent: agent ?? null,
  })
}
