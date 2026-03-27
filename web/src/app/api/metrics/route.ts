import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

interface MetricPayload {
  asset_id:       number
  token:          string
  collected_at:   string   // ISO 8601
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
  // 토폴로지 데이터
  mac_addresses?: Array<{ mac: string; interface: string; ip?: string }>
  arp_cache?:     Array<{ ip: string; mac: string; interface: string }>
  // SMART 데이터
  smart?: Array<{
    device: string; model?: string; serial?: string
    health_status: string; temperature_c?: number
    reallocated_sectors?: number; pending_sectors?: number
    uncorrectable?: number; power_on_hours?: number
    raw?: Record<string, unknown>
  }>
  // FC/SAN WWN
  wwn?: Array<{ wwn: string; wwn_type: string; port_name?: string }>
  // 서버 로그
  logs?: Array<{ level: string; source: string; message: string; ts: string }>
}

export async function POST(req: NextRequest) {
  try {
    const body: MetricPayload = await req.json()
    const { asset_id, token } = body

    // 토큰 검증
    const tokenRow = await queryOne<{ id: number }>(
      'SELECT id FROM agent_tokens WHERE token = $1 AND asset_id = $2 AND revoked = false',
      [token, asset_id]
    )
    if (!tokenRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ts = body.collected_at || new Date().toISOString()

    // 메트릭 저장
    await execute(
      `INSERT INTO metrics
         (asset_id, collected_at, cpu_usage, mem_usage, mem_total_mb, mem_used_mb,
          disk_read_bps, disk_write_bps, disk_usage_pct, net_rx_bps, net_tx_bps,
          load_avg_1m, process_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT DO NOTHING`,
      [
        asset_id, ts,
        body.cpu_usage, body.mem_usage, body.mem_total_mb, body.mem_used_mb,
        body.disk_read_bps, body.disk_write_bps, body.disk_usage_pct,
        body.net_rx_bps, body.net_tx_bps,
        body.load_avg_1m ?? null, body.process_count ?? null,
      ]
    )

    // MAC 주소 저장
    if (body.mac_addresses?.length) {
      for (const m of body.mac_addresses) {
        await execute(
          `INSERT INTO mac_addresses (asset_id, mac, interface, first_seen, last_seen)
           VALUES ($1, $2, $3, now(), now())
           ON CONFLICT (asset_id, mac) DO UPDATE SET interface = $3, last_seen = now()`,
          [asset_id, m.mac, m.interface]
        )
      }
    }

    // ARP 캐시 → L3 토폴로지용 MAC 저장
    if (body.arp_cache?.length) {
      for (const a of body.arp_cache) {
        if (!a.mac || a.mac === '00:00:00:00:00:00') continue
        await execute(
          `INSERT INTO mac_addresses (asset_id, mac, interface, ip_address, first_seen, last_seen)
           VALUES ($1, $2, $3, $4, now(), now())
           ON CONFLICT (asset_id, mac) DO UPDATE
             SET ip_address = $4, interface = $3, last_seen = now()`,
          [asset_id, a.mac, a.interface, a.ip]
        )
      }
    }

    // WWN 저장
    if (body.wwn?.length) {
      for (const w of body.wwn) {
        await execute(
          `INSERT INTO wwn_entries (asset_id, wwn, wwn_type, port_name, first_seen, last_seen)
           VALUES ($1, $2, $3, $4, now(), now())
           ON CONFLICT (asset_id, wwn) DO UPDATE
             SET wwn_type = $3, port_name = $4, last_seen = now()`,
          [asset_id, w.wwn, w.wwn_type, w.port_name ?? null]
        )
      }
    }

    // SMART 데이터 저장
    if (body.smart?.length) {
      for (const s of body.smart) {
        await execute(
          `INSERT INTO disk_smart
             (asset_id, device, model, serial, health_status, temperature_c,
              reallocated_sectors, pending_sectors, uncorrectable, power_on_hours, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            asset_id, s.device, s.model ?? null, s.serial ?? null,
            s.health_status, s.temperature_c ?? null,
            s.reallocated_sectors ?? 0, s.pending_sectors ?? 0,
            s.uncorrectable ?? 0, s.power_on_hours ?? null,
            s.raw ? JSON.stringify(s.raw) : null,
          ]
        )
      }
    }

    // 서버 로그 저장 (배치)
    if (body.logs?.length) {
      for (const l of body.logs) {
        await execute(
          `INSERT INTO server_logs (asset_id, collected_at, level, source, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [asset_id, l.ts, l.level, l.source, l.message]
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Metrics]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// GET: 최근 메트릭 조회
// ?asset_id=N&range=30m|1h|6h|24h|7d|30d
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const assetId = searchParams.get('asset_id')
  const range   = searchParams.get('range') || '1h'

  if (!assetId) {
    return NextResponse.json({ error: 'asset_id required' }, { status: 400 })
  }

  const intervalMap: Record<string, string> = {
    '30m': '30 minutes', '1h': '1 hour', '6h': '6 hours',
    '24h': '24 hours', '7d': '7 days', '30d': '30 days',
  }
  const interval = intervalMap[range] || '1 hour'

  const { query } = await import('@/lib/db')
  let rows: unknown[]

  // 범위에 따라 raw vs 집계 선택, UI 컬럼명으로 alias
  if (['30m', '1h', '6h'].includes(range)) {
    rows = await query(
      `SELECT collected_at AS ts,
              cpu_usage   AS cpu_pct,
              mem_usage   AS mem_pct,
              disk_read_bps, disk_write_bps,
              net_rx_bps, net_tx_bps
       FROM metrics
       WHERE asset_id = $1 AND collected_at > now() - interval '${interval}'
       ORDER BY collected_at ASC`,
      [assetId]
    )
  } else if (['24h', '7d'].includes(range)) {
    rows = await query(
      `SELECT bucket AS ts,
              cpu_avg        AS cpu_pct,
              mem_avg        AS mem_pct,
              disk_read_avg  AS disk_read_bps,
              disk_write_avg AS disk_write_bps,
              net_rx_avg     AS net_rx_bps,
              net_tx_avg     AS net_tx_bps
       FROM metrics_5m
       WHERE asset_id = $1 AND bucket > now() - interval '${interval}'
       ORDER BY bucket ASC`,
      [assetId]
    )
  } else {
    rows = await query(
      `SELECT bucket AS ts,
              cpu_avg        AS cpu_pct,
              mem_avg        AS mem_pct,
              disk_read_avg  AS disk_read_bps,
              disk_write_avg AS disk_write_bps,
              net_rx_avg     AS net_rx_bps,
              net_tx_avg     AS net_tx_bps
       FROM metrics_1h
       WHERE asset_id = $1 AND bucket > now() - interval '${interval}'
       ORDER BY bucket ASC`,
      [assetId]
    )
  }

  return NextResponse.json({ metrics: rows })
}
