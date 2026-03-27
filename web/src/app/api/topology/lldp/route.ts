import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

// POST /api/topology/lldp — called by syslog processor on LLDP_NEIGHBOR events
export async function POST(req: NextRequest) {
  try {
    const {
      hostname,         // source device hostname
      local_port,       // source port (e.g. GigabitEthernet1/0/1)
      neighbor_hostname,
      neighbor_port,
      neighbor_ip,
    } = await req.json()

    // Resolve source asset
    const srcAsset = await queryOne<{ id: number; name: string; node_type: string }>(
      `SELECT id, name, type AS node_type FROM assets WHERE hostname = $1 OR ip_address::text = $1 LIMIT 1`,
      [hostname]
    )
    if (!srcAsset) return NextResponse.json({ ok: true })

    // Resolve or look up neighbor asset (may not exist in assets)
    const nbAsset = neighbor_hostname
      ? await queryOne<{ id: number; name: string; node_type: string }>(
          `SELECT id, name, type AS node_type FROM assets
           WHERE hostname = $1 OR ip_address::text = $1 OR ip_address::text = $2
           LIMIT 1`,
          [neighbor_hostname, neighbor_ip ?? '']
        )
      : null

    // Ensure topology_node exists for source
    let srcNode = await queryOne<{ id: number }>(
      `SELECT id FROM topology_nodes WHERE asset_id = $1 AND layer = 'physical' LIMIT 1`,
      [srcAsset.id]
    )
    if (!srcNode) {
      srcNode = await queryOne<{ id: number }>(
        `INSERT INTO topology_nodes (asset_id, layer, node_type, label)
         VALUES ($1, 'physical', $2, $3)
         RETURNING id`,
        [srcAsset.id, srcAsset.node_type, srcAsset.name]
      )
    }

    // Ensure topology_node exists for neighbor
    let nbNode: { id: number } | null = null
    if (nbAsset) {
      nbNode = await queryOne<{ id: number }>(
        `SELECT id FROM topology_nodes WHERE asset_id = $1 AND layer = 'physical' LIMIT 1`,
        [nbAsset.id]
      )
      if (!nbNode) {
        nbNode = await queryOne<{ id: number }>(
          `INSERT INTO topology_nodes (asset_id, layer, node_type, label)
           VALUES ($1, 'physical', $2, $3)
           RETURNING id`,
          [nbAsset.id, nbAsset.node_type, nbAsset.name]
        )
      }
    } else {
      // Unknown neighbor — create a placeholder node without asset_id
      nbNode = await queryOne<{ id: number }>(
        `SELECT id FROM topology_nodes
         WHERE asset_id IS NULL AND label = $1 AND layer = 'physical' LIMIT 1`,
        [neighbor_hostname ?? neighbor_ip ?? 'unknown']
      )
      if (!nbNode) {
        nbNode = await queryOne<{ id: number }>(
          `INSERT INTO topology_nodes (layer, node_type, label)
           VALUES ('physical', 'unknown', $1)
           RETURNING id`,
          [neighbor_hostname ?? neighbor_ip ?? 'unknown']
        )
      }
    }

    if (!srcNode || !nbNode) return NextResponse.json({ ok: true })

    // Upsert edge
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM topology_edges
       WHERE source_node = $1 AND target_node = $2 AND layer = 'physical'
       LIMIT 1`,
      [srcNode.id, nbNode.id]
    )

    if (existing) {
      await execute(
        `UPDATE topology_edges
         SET source_port = $1, target_port = $2, method = 'auto_lldp',
             is_active = true, updated_at = now()
         WHERE id = $3`,
        [local_port ?? null, neighbor_port ?? null, existing.id]
      )
    } else {
      await execute(
        `INSERT INTO topology_edges
           (layer, source_node, target_node, source_port, target_port,
            link_type, method, confidence)
         VALUES ('physical', $1, $2, $3, $4, 'ethernet', 'auto_lldp', 90)`,
        [srcNode.id, nbNode.id, local_port ?? null, neighbor_port ?? null]
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[LLDP Topology]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
