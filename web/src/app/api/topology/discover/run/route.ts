import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, transaction } from '@/lib/db'
import type { PoolClient } from 'pg'

interface Discovery {
  source: string
  source_port: string
  source_mac?: string
  target: string
  target_port: string
  confidence: number
  is_new: boolean
  method: string
}

// POST — 디스커버리 실행
export async function POST(req: NextRequest) {
  try {
    const { scope = 'all', dry_run = false } = await req.json().catch(() => ({})) as {
      scope?: 'ethernet' | 'san' | 'all'
      dry_run?: boolean
    }

    const ethernetResult = { edges_created: 0, edges_updated: 0, discoveries: [] as Discovery[] }
    const sanResult = { edges_created: 0, edges_updated: 0, discoveries: [] as Discovery[] }

    if (scope === 'ethernet' || scope === 'all') {
      const r = await discoverEthernet(dry_run)
      Object.assign(ethernetResult, r)
    }

    if (scope === 'san' || scope === 'all') {
      const r = await discoverSan(dry_run)
      Object.assign(sanResult, r)
    }

    // 로그 기록
    if (!dry_run) {
      await query(
        `INSERT INTO discovery_logs (discovery_type, status, nodes_created, edges_created, edges_updated, detail)
         VALUES ($1, 'completed', 0, $2, $3, $4)`,
        [
          scope,
          ethernetResult.edges_created + sanResult.edges_created,
          ethernetResult.edges_updated + sanResult.edges_updated,
          JSON.stringify({ ethernet: ethernetResult.discoveries.length, san: sanResult.discoveries.length }),
        ]
      )
    }

    return NextResponse.json({
      dry_run,
      ethernet: ethernetResult,
      san: sanResult,
    })
  } catch (err) {
    console.error('[DiscoverRun]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// ─── Ethernet (MAC/ARP) 디스커버리 ──────────────────

async function discoverEthernet(dryRun: boolean) {
  // Step 1: 서버 MAC 수집
  const serverMacs = await query<{
    asset_id: number; mac: string; interface: string; name: string
  }>(
    `SELECT m.asset_id, m.mac::text, m.interface, a.name
     FROM mac_addresses m
     JOIN assets a ON a.id = m.asset_id
     WHERE a.type = 'server' AND a.is_active = true
       AND m.mac::text != '00:00:00:00:00:00'`
  )
  const serverMacMap = new Map<string, { asset_id: number; iface: string; name: string }>()
  for (const s of serverMacs) {
    serverMacMap.set(s.mac, { asset_id: s.asset_id, iface: s.interface, name: s.name })
  }

  // Step 2: 네트워크 장비 MAC 테이블
  const deviceMacs = await query<{
    asset_id: number; mac: string; port_name: string; device_name: string
  }>(
    `SELECT d.asset_id, d.mac::text, d.port_name, a.name AS device_name
     FROM device_mac_table d
     JOIN assets a ON a.id = d.asset_id
     WHERE d.entry_type != 'self'`
  )

  // Step 3: 네트워크 장비 자체 MAC (inter-switch)
  const deviceSelfMacs = await query<{ asset_id: number; mac: string; name: string }>(
    `SELECT d.asset_id, d.mac::text, a.name
     FROM device_mac_table d JOIN assets a ON a.id = d.asset_id
     WHERE d.entry_type = 'self'
     UNION
     SELECT m.asset_id, m.mac::text, a.name
     FROM mac_addresses m JOIN assets a ON a.id = m.asset_id
     WHERE a.type IN ('network', 'security')`
  )
  const deviceSelfMap = new Map<string, { asset_id: number; name: string }>()
  for (const d of deviceSelfMacs) {
    deviceSelfMap.set(d.mac, { asset_id: d.asset_id, name: d.name })
  }

  // Step 4: 포트별 MAC 수 계산 (신뢰도용)
  const portMacCount = new Map<string, number>()
  for (const d of deviceMacs) {
    const key = `${d.asset_id}:${d.port_name}`
    portMacCount.set(key, (portMacCount.get(key) || 0) + 1)
  }

  // Step 5: 매칭
  const discoveries: Discovery[] = []
  const seen = new Set<string>() // 중복 방지

  for (const dm of deviceMacs) {
    const server = serverMacMap.get(dm.mac)
    const device = deviceSelfMap.get(dm.mac)

    if (server) {
      const key = `${dm.asset_id}-${server.asset_id}`
      if (seen.has(key)) continue
      seen.add(key)

      const macCount = portMacCount.get(`${dm.asset_id}:${dm.port_name}`) || 1
      const confidence = macCount === 1 ? 95 : macCount <= 3 ? 80 : 70

      discoveries.push({
        source: dm.device_name,
        source_port: dm.port_name,
        source_mac: dm.mac,
        target: server.name,
        target_port: server.iface,
        confidence,
        is_new: true,
        method: 'auto_arp',
      })
    } else if (device && device.asset_id !== dm.asset_id) {
      const key = [dm.asset_id, device.asset_id].sort().join('-')
      if (seen.has(key)) continue
      seen.add(key)

      discoveries.push({
        source: dm.device_name,
        source_port: dm.port_name,
        target: device.name,
        target_port: '',
        confidence: 90,
        is_new: true,
        method: 'auto_arp',
      })
    }
  }

  // Step 6: topology_nodes/edges 생성
  let edgesCreated = 0, edgesUpdated = 0

  if (!dryRun && discoveries.length > 0) {
    await transaction(async (client: PoolClient) => {
      for (const d of discoveries) {
        // Source device node
        const srcAsset = await clientQueryOne(client,
          `SELECT id FROM assets WHERE name = $1 LIMIT 1`, [d.source])
        const tgtAsset = await clientQueryOne(client,
          `SELECT id FROM assets WHERE name = $1 LIMIT 1`, [d.target])
        if (!srcAsset || !tgtAsset) continue

        const srcNode = await ensureNode(client, srcAsset.id as number, 'physical')
        const tgtNode = await ensureNode(client, tgtAsset.id as number, 'physical')
        if (!srcNode || !tgtNode) continue

        // Check existing (either direction)
        const existing = await clientQueryOne(client,
          `SELECT id, method FROM topology_edges
           WHERE layer = 'physical' AND is_active = true
             AND ((source_node = $1 AND target_node = $2) OR (source_node = $2 AND target_node = $1))
           LIMIT 1`,
          [srcNode.id as number, tgtNode.id as number]
        )

        if (existing) {
          // LLDP 우선 — auto_lldp이면 덮어쓰지 않음
          if (existing.method === 'auto_lldp') {
            d.is_new = false
            continue
          }
          await client.query(
            `UPDATE topology_edges
             SET source_port = $1, target_port = $2, method = 'auto_arp',
                 confidence = $3, is_active = true, updated_at = now()
             WHERE id = $4`,
            [d.source_port, d.target_port, d.confidence, existing.id]
          )
          d.is_new = false
          edgesUpdated++
        } else {
          await client.query(
            `INSERT INTO topology_edges
               (layer, source_node, target_node, source_port, target_port,
                link_type, method, confidence, is_active)
             VALUES ('physical', $1, $2, $3, $4, 'ethernet', 'auto_arp', $5, true)`,
            [srcNode.id, tgtNode.id, d.source_port, d.target_port, d.confidence]
          )
          edgesCreated++
        }
      }
    })
  }

  return { edges_created: edgesCreated, edges_updated: edgesUpdated, discoveries }
}

// ─── SAN (WWN) 디스커버리 ──────────────────────────

async function discoverSan(dryRun: boolean) {
  // Step 1: HBA WWN (서버)
  const hbaWwns = await query<{
    asset_id: number; wwn: string; port_name: string; name: string
  }>(
    `SELECT w.asset_id, w.wwn, w.port_name, a.name
     FROM wwn_entries w JOIN assets a ON a.id = w.asset_id
     WHERE w.wwn_type = 'hba'`
  )

  // Step 2: FC 스위치 포트 WWN
  const switchWwns = await query<{
    asset_id: number; wwn: string; port_name: string; name: string
  }>(
    `SELECT w.asset_id, w.wwn, w.port_name, a.name
     FROM wwn_entries w JOIN assets a ON a.id = w.asset_id
     WHERE w.wwn_type = 'switch_port'`
  )

  // Step 3: 스토리지 Target WWN
  const targetWwns = await query<{
    asset_id: number; wwn: string; port_name: string; name: string
  }>(
    `SELECT w.asset_id, w.wwn, w.port_name, a.name
     FROM wwn_entries w JOIN assets a ON a.id = w.asset_id
     WHERE w.wwn_type = 'target'`
  )

  const discoveries: Discovery[] = []
  const seen = new Set<string>()

  // HBA ↔ FC Switch 매칭
  // 같은 FC 스위치의 서로 다른 포트에 HBA와 Target이 보이면 연결
  const switchAssets = new Map<number, string>() // asset_id → name
  for (const sw of switchWwns) {
    switchAssets.set(sw.asset_id, sw.name)
  }

  // 서버 HBA → FC 스위치 포트 (WWN이 같은 것은 직접 연결)
  for (const hba of hbaWwns) {
    for (const sw of switchWwns) {
      // FC 스위치 포트에서 HBA WWN이 보이면 → 서버-FC스위치 연결
      // 실제로는 FC zoning이나 nsshow에서 같은 포트에 로그인된 WWN을 매칭
      // 간단히: 같은 FC스위치에 HBA WWN이 nsshow에 등록되어 있으면 연결
      if (hba.wwn === sw.wwn) {
        const key = `san-${hba.asset_id}-${sw.asset_id}`
        if (seen.has(key)) continue
        seen.add(key)
        discoveries.push({
          source: hba.name,
          source_port: hba.port_name || 'hba',
          source_mac: hba.wwn,
          target: sw.name,
          target_port: sw.port_name || '',
          confidence: 90,
          is_new: true,
          method: 'auto_wwn',
        })
      }
    }
  }

  // FC 스위치 ↔ 스토리지 Target
  for (const tgt of targetWwns) {
    for (const sw of switchWwns) {
      if (tgt.wwn === sw.wwn) {
        const key = `san-${sw.asset_id}-${tgt.asset_id}`
        if (seen.has(key)) continue
        seen.add(key)
        discoveries.push({
          source: sw.name,
          source_port: sw.port_name || '',
          target: tgt.name,
          target_port: tgt.port_name || 'target',
          confidence: 90,
          is_new: true,
          method: 'auto_wwn',
        })
      }
    }
  }

  // HBA ↔ Target 직접 (FC 스위치 없이 DAS FC)
  if (switchWwns.length === 0) {
    for (const hba of hbaWwns) {
      for (const tgt of targetWwns) {
        const key = `san-direct-${hba.asset_id}-${tgt.asset_id}`
        if (seen.has(key)) continue
        seen.add(key)
        discoveries.push({
          source: hba.name,
          source_port: hba.port_name || 'hba',
          target: tgt.name,
          target_port: tgt.port_name || 'target',
          confidence: 80,
          is_new: true,
          method: 'auto_wwn',
        })
      }
    }
  }

  let edgesCreated = 0, edgesUpdated = 0

  if (!dryRun && discoveries.length > 0) {
    await transaction(async (client: PoolClient) => {
      for (const d of discoveries) {
        const srcAsset = await clientQueryOne(client,
          `SELECT id FROM assets WHERE name = $1 LIMIT 1`, [d.source])
        const tgtAsset = await clientQueryOne(client,
          `SELECT id FROM assets WHERE name = $1 LIMIT 1`, [d.target])
        if (!srcAsset || !tgtAsset) continue

        // SAN layer + Physical layer 둘 다
        for (const layer of ['physical', 'san'] as const) {
          const srcNode = await ensureNode(client, srcAsset.id as number, layer)
          const tgtNode = await ensureNode(client, tgtAsset.id as number, layer)
          if (!srcNode || !tgtNode) continue

          const existing = await clientQueryOne(client,
            `SELECT id FROM topology_edges
             WHERE layer = $1 AND is_active = true
               AND ((source_node = $2 AND target_node = $3) OR (source_node = $3 AND target_node = $2))
             LIMIT 1`,
            [layer, srcNode.id as number, tgtNode.id as number]
          )

          if (existing) {
            await client.query(
              `UPDATE topology_edges
               SET source_port = $1, target_port = $2, method = 'auto_wwn',
                   confidence = $3, link_type = 'fc', is_active = true, updated_at = now()
               WHERE id = $4`,
              [d.source_port, d.target_port, d.confidence, existing.id]
            )
            if (layer === 'san') edgesUpdated++
          } else {
            await client.query(
              `INSERT INTO topology_edges
                 (layer, source_node, target_node, source_port, target_port,
                  link_type, method, confidence, is_active)
               VALUES ($1, $2, $3, $4, $5, 'fc', 'auto_wwn', $6, true)`,
              [layer, srcNode.id, tgtNode.id, d.source_port, d.target_port, d.confidence]
            )
            if (layer === 'san') edgesCreated++
          }
        }
      }
    })
  }

  return { edges_created: edgesCreated, edges_updated: edgesUpdated, discoveries }
}

// ─── 헬퍼 ──────────────────────────────────────────

async function ensureNode(client: PoolClient, assetId: number, layer: string) {
  const existing = await clientQueryOne(client,
    `SELECT id FROM topology_nodes WHERE asset_id = $1 AND layer = $2 LIMIT 1`,
    [assetId, layer]
  )
  if (existing) return existing

  const asset = await clientQueryOne(client,
    `SELECT name, type FROM assets WHERE id = $1`, [assetId]
  )
  if (!asset) return null

  return clientQueryOne(client,
    `INSERT INTO topology_nodes (asset_id, layer, node_type, label)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [assetId, layer, asset.type, asset.name]
  )
}

async function clientQueryOne(
  client: PoolClient, sql: string, params?: unknown[]
): Promise<Record<string, unknown> | null> {
  const res = await client.query(sql, params)
  return res.rows[0] ?? null
}
