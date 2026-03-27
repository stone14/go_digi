import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/assets/capacity?type=disk|storage|cpu|memory
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = new URL(req.url).searchParams.get('type') ?? 'disk'

  if (type === 'cpu') {
    const rows = await query<{
      asset_id: number; asset_name: string; ip_address: string | null
      day: string; cpu_avg: number; cpu_max: number
    }>(
      `SELECT a.id AS asset_id, a.name AS asset_name,
              a.ip_address::text,
              DATE_TRUNC('day', m.bucket)::text AS day,
              ROUND(AVG(m.cpu_avg)::numeric, 1)::float AS cpu_avg,
              ROUND(MAX(m.cpu_max)::numeric, 1)::float AS cpu_max
       FROM metrics_1h m
       JOIN assets a ON a.id = m.asset_id
       WHERE m.bucket >= now() - interval '30 days'
         AND a.is_active = true
         AND a.type = 'server'
         AND m.cpu_avg IS NOT NULL
       GROUP BY a.id, a.name, a.ip_address, DATE_TRUNC('day', m.bucket)
       ORDER BY a.id, day`
    )
    // 서버별로 그루핑
    const map = new Map<number, { asset_id: number; asset_name: string; ip_address: string | null; history: { day: string; avg: number; max: number }[] }>()
    for (const r of rows) {
      if (!map.has(r.asset_id)) {
        map.set(r.asset_id, { asset_id: r.asset_id, asset_name: r.asset_name, ip_address: r.ip_address, history: [] })
      }
      map.get(r.asset_id)!.history.push({ day: r.day, avg: r.cpu_avg, max: r.cpu_max })
    }
    const items = [...map.values()].map(s => {
      const last = s.history[s.history.length - 1]
      const avg30 = s.history.length ? parseFloat((s.history.reduce((a, h) => a + h.avg, 0) / s.history.length).toFixed(1)) : 0
      const max30 = s.history.length ? Math.max(...s.history.map(h => h.max)) : 0
      return { ...s, current: last?.avg ?? 0, avg_30d: avg30, max_30d: max30 }
    })
    return NextResponse.json({ items })
  }

  if (type === 'memory') {
    const rows = await query<{
      asset_id: number; asset_name: string; ip_address: string | null
      day: string; mem_avg: number; mem_max: number; mem_total_mb: number
    }>(
      `SELECT a.id AS asset_id, a.name AS asset_name,
              a.ip_address::text,
              DATE_TRUNC('day', m.bucket)::text AS day,
              ROUND(AVG(m.mem_avg)::numeric, 1)::float AS mem_avg,
              ROUND(MAX(m.mem_max)::numeric, 1)::float AS mem_max,
              COALESCE(
                (SELECT MAX(mt.mem_total_mb)::int
                 FROM metrics mt
                 WHERE mt.asset_id = a.id
                   AND mt.collected_at >= now() - interval '7 days'),
                0
              ) AS mem_total_mb
       FROM metrics_1h m
       JOIN assets a ON a.id = m.asset_id
       WHERE m.bucket >= now() - interval '30 days'
         AND a.is_active = true
         AND a.type = 'server'
         AND m.mem_avg IS NOT NULL
       GROUP BY a.id, a.name, a.ip_address, DATE_TRUNC('day', m.bucket)
       ORDER BY a.id, day`
    )
    const map = new Map<number, { asset_id: number; asset_name: string; ip_address: string | null; mem_total_mb: number; history: { day: string; avg: number; max: number }[] }>()
    for (const r of rows) {
      if (!map.has(r.asset_id)) {
        map.set(r.asset_id, { asset_id: r.asset_id, asset_name: r.asset_name, ip_address: r.ip_address, mem_total_mb: r.mem_total_mb, history: [] })
      }
      const entry = map.get(r.asset_id)!
      entry.mem_total_mb = Math.max(entry.mem_total_mb, r.mem_total_mb)
      entry.history.push({ day: r.day, avg: r.mem_avg, max: r.mem_max })
    }
    const items = [...map.values()].map(s => {
      const last = s.history[s.history.length - 1]
      const avg30 = s.history.length ? parseFloat((s.history.reduce((a, h) => a + h.avg, 0) / s.history.length).toFixed(1)) : 0
      const max30 = s.history.length ? Math.max(...s.history.map(h => h.max)) : 0
      return { ...s, current: last?.avg ?? 0, avg_30d: avg30, max_30d: max30 }
    })
    return NextResponse.json({ items })
  }

  if (type === 'disk') {
    // 서버 디스크: 최근 30일 disk_metrics 반환
    const rows = await query<{
      asset_id: number
      asset_name: string
      mount_point: string
      total_gb: number
      used_gb: number
      collected_at: string
    }>(
      `SELECT dm.asset_id, a.name AS asset_name, dm.mount_point,
              dm.total_gb::float, dm.used_gb::float,
              dm.collected_at::text
       FROM disk_metrics dm
       JOIN assets a ON a.id = dm.asset_id
       WHERE dm.collected_at >= now() - interval '30 days'
         AND a.is_active = true
       ORDER BY dm.asset_id, dm.mount_point, dm.collected_at`
    )
    return NextResponse.json({ items: rows })
  }

  // type === 'storage'
  // 히스토리가 있는 자산은 최근 30일 이력, 없으면 storage_volumes 현재값
  const histRows = await query<{
    asset_id: number
    asset_name: string
    volume_name: string
    total_gb: number
    used_gb: number
    recorded_at: string
  }>(
    `SELECT h.asset_id, a.name AS asset_name, h.volume_name,
            h.total_gb::float, h.used_gb::float,
            h.recorded_at::text
     FROM storage_volume_history h
     JOIN assets a ON a.id = h.asset_id
     WHERE h.recorded_at >= now() - interval '30 days'
       AND a.is_active = true
     ORDER BY h.asset_id, h.volume_name, h.recorded_at`
  )

  // 히스토리 없는 자산은 storage_volumes 최신값으로
  const histAssetIds = [...new Set(histRows.map(r => r.asset_id))]
  const notInClause = histAssetIds.length > 0
    ? `AND sv.asset_id NOT IN (${histAssetIds.join(',')})`
    : ''

  const snapRows = await query<{
    asset_id: number
    asset_name: string
    volume_name: string
    total_gb: number
    used_gb: number
    recorded_at: string
  }>(
    `SELECT sv.asset_id, a.name AS asset_name, sv.volume_name,
            sv.total_gb::float, sv.used_gb::float,
            now()::text AS recorded_at
     FROM storage_volumes sv
     JOIN assets a ON a.id = sv.asset_id
     WHERE a.is_active = true ${notInClause}
     ORDER BY sv.asset_id, sv.volume_name`
  )

  return NextResponse.json({ items: [...histRows, ...snapRows] })
}

// POST /api/assets/capacity/snapshot — storage_volumes 현재값을 이력에 기록
export async function POST(_req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await execute(
    `INSERT INTO storage_volume_history (asset_id, volume_name, total_gb, used_gb)
     SELECT sv.asset_id, sv.volume_name, sv.total_gb, sv.used_gb
     FROM storage_volumes sv
     JOIN assets a ON a.id = sv.asset_id
     WHERE a.is_active = true`
  )

  return NextResponse.json({ ok: true })
}
