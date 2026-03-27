import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/network/ports?asset_id=N
// DB column: port_name, last_changed — alias to interface_name, last_change for UI
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const ports = await query<{
    id: number
    interface_name: string
    if_index: number | null
    link_status: string
    speed_mbps: number | null
    duplex: string | null
    vlan_id: number | null
    description: string | null
    last_change: string | null
    neighbor_label: string | null
    neighbor_port: string | null
  }>(
    `SELECT np.id,
            np.port_name     AS interface_name,    -- DB: port_name
            np.if_index,
            np.link_status,
            np.speed_mbps,
            np.duplex,
            np.vlan_id,
            np.description,
            np.last_changed  AS last_change,        -- DB: last_changed
            -- LLDP neighbor via topology
            nb.label         AS neighbor_label,
            te.target_port   AS neighbor_port
     FROM network_ports np
     LEFT JOIN topology_nodes src_n
       ON src_n.asset_id = np.asset_id AND src_n.layer = 'physical'
     LEFT JOIN topology_edges te
       ON te.source_node   = src_n.id
      AND te.source_port   = np.port_name      -- DB: port_name
      AND te.method        = 'auto_lldp'
      AND te.is_active     = true
     LEFT JOIN topology_nodes nb ON nb.id = te.target_node
     WHERE np.asset_id = $1
     ORDER BY np.if_index NULLS LAST, np.port_name`,
    [assetId]
  )

  return NextResponse.json({ ports })
}
