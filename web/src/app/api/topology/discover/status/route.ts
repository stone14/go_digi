import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET — 디스커버리 데이터 현황
export async function GET() {
  try {
    const serversWithMac = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT m.asset_id) AS count
       FROM mac_addresses m JOIN assets a ON a.id = m.asset_id
       WHERE a.type = 'server' AND a.is_active = true`
    )

    const devicesWithMac = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT asset_id) AS count FROM device_mac_table`
    )

    const devicesWithWwn = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT asset_id) AS count
       FROM wwn_entries WHERE wwn_type IN ('switch_port', 'target')`
    )

    const lastDiscovery = await queryOne<{
      discovery_type: string; created_at: string; edges_created: number
    }>(
      `SELECT discovery_type, created_at::text, edges_created
       FROM discovery_logs WHERE status = 'completed'
       ORDER BY created_at DESC LIMIT 1`
    )

    // 네트워크/보안/스토리지 장비별 상세
    const devices = await query<{
      asset_id: number; name: string; type: string
      mac_entries: number; wwn_entries: number; last_updated: string
    }>(
      `SELECT a.id AS asset_id, a.name, a.type,
              COALESCE(dm.cnt, 0)::int AS mac_entries,
              COALESCE(wn.cnt, 0)::int AS wwn_entries,
              GREATEST(dm.last_up, wn.last_up)::text AS last_updated
       FROM assets a
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_up
         FROM device_mac_table WHERE asset_id = a.id
       ) dm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt, MAX(last_seen) AS last_up
         FROM wwn_entries WHERE asset_id = a.id AND wwn_type IN ('switch_port','target')
       ) wn ON true
       WHERE a.type IN ('network','security','san','fc_switch')
         AND a.is_active = true
       ORDER BY a.name`
    )

    return NextResponse.json({
      servers_with_mac: Number(serversWithMac?.count ?? 0),
      devices_with_mac_table: Number(devicesWithMac?.count ?? 0),
      devices_with_wwn: Number(devicesWithWwn?.count ?? 0),
      last_discovery: lastDiscovery ?? null,
      devices,
    })
  } catch (err) {
    console.error('[DiscoverStatus]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
