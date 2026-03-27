import { NextRequest, NextResponse } from 'next/server'
import { execute, query, queryOne } from '@/lib/db'

// agent /all 응답 타입
interface AgnetAllResponse {
  node_type:     string
  hostname:      string
  os:            string
  arch:          string
  agent_version: string
  collected_at:  string
  metrics: {
    collected_at:   string
    cpu_usage:      number
    mem_usage:      number
    mem_total_mb:   number
    mem_used_mb:    number
    disk_read_bps:  number
    disk_write_bps: number
    disk_usage_pct: number
    net_rx_bps:     number
    net_tx_bps:     number
    load_avg_1m?:   number
    process_count?: number
  }
  smart: Array<{
    device: string; model?: string; serial?: string
    health_status: string; temperature_c?: number
    reallocated_sectors?: number; pending_sectors?: number
    uncorrectable?: number; power_on_hours?: number
  }>
  network: {
    mac_addresses: Array<{ mac: string; interface: string; ip?: string }>
    arp_cache:     Array<{ ip: string; mac: string; interface: string }>
    wwn_entries:   Array<{ wwn: string; wwn_type: string; port_name?: string }>
  }
  logs: Array<{ level: string; source: string; message: string; ts: string }>
  app_logs: Array<{
    label:    string
    log_type: string
    lines?:   string[]
    gc_events?: Array<{
      timestamp:    string
      gc_type:      string
      cause?:       string
      pause_ms:     number
      heap_before_mb: number
      heap_after_mb:  number
      heap_total_mb:  number
    }>
    json_lines?: unknown[]
    error?: string
  }>
  cloud_meta?: {
    provider:      string
    instance_id?:  string
    instance_type?: string
    region?:       string
    zone?:         string
    public_ip?:    string
    iam_role?:     string
  }
}

// GET /api/agent/collect?asset_id=N
// Digicap 스케줄러 또는 수동으로 특정 agent에서 데이터를 폴링하고 DB에 저장
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const assetIdStr = searchParams.get('asset_id')

  if (!assetIdStr) {
    return NextResponse.json({ error: 'asset_id required' }, { status: 400 })
  }
  const assetId = parseInt(assetIdStr)

  try {
    // agent_url 및 토큰 조회
    const asset = await queryOne<{ agent_url: string | null; hostname: string }>(
      'SELECT agent_url, hostname FROM assets WHERE id = $1',
      [assetId]
    )
    if (!asset?.agent_url) {
      return NextResponse.json({ error: 'agent_url not configured for this asset' }, { status: 404 })
    }

    const tokenRow = await queryOne<{ token: string }>(
      'SELECT token FROM agent_tokens WHERE asset_id = $1 AND revoked = false ORDER BY id DESC LIMIT 1',
      [assetId]
    )
    if (!tokenRow) {
      return NextResponse.json({ error: 'No active token for this asset' }, { status: 404 })
    }

    // agent에 폴링
    const url = `${asset.agent_url.replace(/\/$/, '')}/all`
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenRow.token}` },
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) {
      await execute(
        `UPDATE assets SET status = 'offline', updated_at = now() WHERE id = $1`,
        [assetId]
      )
      return NextResponse.json({ error: `agent returned ${resp.status}` }, { status: 502 })
    }

    const data: AgnetAllResponse = await resp.json()

    // assets 상태 업데이트
    await execute(
      `UPDATE assets SET
         status = 'online', last_seen = now(), updated_at = now(),
         os = $2, arch = $3, agent_version = $4
       WHERE id = $1`,
      [assetId, data.os, data.arch, data.agent_version]
    )

    // 토큰 last_seen 갱신
    await execute(
      'UPDATE agent_tokens SET last_seen = now() WHERE asset_id = $1 AND revoked = false',
      [assetId]
    )

    const ts = data.metrics?.collected_at || data.collected_at || new Date().toISOString()

    // 메트릭 저장
    if (data.metrics) {
      const m = data.metrics
      await execute(
        `INSERT INTO metrics
           (asset_id, collected_at, cpu_usage, mem_usage, mem_total_mb, mem_used_mb,
            disk_read_bps, disk_write_bps, disk_usage_pct, net_rx_bps, net_tx_bps,
            load_avg_1m, process_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT DO NOTHING`,
        [
          assetId, ts,
          m.cpu_usage, m.mem_usage, m.mem_total_mb, m.mem_used_mb,
          m.disk_read_bps, m.disk_write_bps, m.disk_usage_pct,
          m.net_rx_bps, m.net_tx_bps,
          m.load_avg_1m ?? null, m.process_count ?? null,
        ]
      )
    }

    // MAC 주소 저장
    for (const m of (data.network?.mac_addresses ?? [])) {
      await execute(
        `INSERT INTO mac_addresses (asset_id, mac, interface, first_seen, last_seen)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (asset_id, mac) DO UPDATE SET interface = $3, last_seen = now()`,
        [assetId, m.mac, m.interface]
      )
    }

    // ARP 캐시
    for (const a of (data.network?.arp_cache ?? [])) {
      if (!a.mac || a.mac === '00:00:00:00:00:00') continue
      await execute(
        `INSERT INTO mac_addresses (asset_id, mac, interface, ip_address, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (asset_id, mac) DO UPDATE
           SET ip_address = $4, interface = $3, last_seen = now()`,
        [assetId, a.mac, a.interface, a.ip ?? null]
      )
    }

    // WWN 저장
    for (const w of (data.network?.wwn_entries ?? [])) {
      await execute(
        `INSERT INTO wwn_entries (asset_id, wwn, wwn_type, port_name, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (asset_id, wwn) DO UPDATE
           SET wwn_type = $3, port_name = $4, last_seen = now()`,
        [assetId, w.wwn, w.wwn_type, w.port_name ?? null]
      )
    }

    // SMART 저장
    for (const s of (data.smart ?? [])) {
      await execute(
        `INSERT INTO disk_smart
           (asset_id, device, model, serial, health_status, temperature_c,
            reallocated_sectors, pending_sectors, uncorrectable, power_on_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          assetId, s.device, s.model ?? null, s.serial ?? null,
          s.health_status, s.temperature_c ?? null,
          s.reallocated_sectors ?? 0, s.pending_sectors ?? 0,
          s.uncorrectable ?? 0, s.power_on_hours ?? null,
        ]
      )
    }

    // 시스템 로그 저장
    for (const l of (data.logs ?? [])) {
      await execute(
        `INSERT INTO server_logs (asset_id, collected_at, level, source, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [assetId, l.ts, l.level, l.source, l.message]
      )
    }

    // 앱 로그 저장 (server_logs에 label을 source 접두어로 포함)
    for (const al of (data.app_logs ?? [])) {
      if (al.error) continue
      const source = `app:${al.label}`

      if (al.log_type === 'gc' && al.gc_events) {
        for (const ev of al.gc_events) {
          await execute(
            `INSERT INTO server_logs (asset_id, collected_at, level, source, message)
             VALUES ($1, $2, 'INFO', $3, $4)`,
            [assetId, ev.timestamp || ts, source,
             `GC ${ev.gc_type} cause=${ev.cause ?? '-'} pause=${ev.pause_ms}ms ` +
             `heap=${ev.heap_before_mb}M->${ev.heap_after_mb}M(${ev.heap_total_mb}M)`]
          )
        }
      } else if (al.log_type === 'json' && al.json_lines) {
        for (const jl of al.json_lines) {
          const msg = typeof jl === 'string' ? jl : JSON.stringify(jl)
          await execute(
            `INSERT INTO server_logs (asset_id, collected_at, level, source, message)
             VALUES ($1, $2, 'INFO', $3, $4)`,
            [assetId, ts, source, msg]
          )
        }
      } else if (al.lines) {
        for (const line of al.lines) {
          await execute(
            `INSERT INTO server_logs (asset_id, collected_at, level, source, message)
             VALUES ($1, $2, $3, $4, $5)`,
            [assetId, ts, classifyLevel(line), source, line]
          )
        }
      }
    }

    return NextResponse.json({
      ok:       true,
      asset_id: assetId,
      node_type: data.node_type,
      collected_at: ts,
    })
  } catch (err) {
    console.error('[agent collect]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

function classifyLevel(line: string): string {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('crit')) return 'ERROR'
  if (lower.includes('warn')) return 'WARN'
  if (lower.includes('debug')) return 'DEBUG'
  return 'INFO'
}
