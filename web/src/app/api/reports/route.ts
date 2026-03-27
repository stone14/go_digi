import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const daysRaw = parseInt(searchParams.get('days') || '7')
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 7
  const since = `now() - interval '${days} days'`

  try {
  const [
    assetSummary,
    alertStats,
    alertRecent,
    diskTop,
    cpuTop,
    memTop,
    predictions,
    uptime,
    storageTop,
  ] = await Promise.all([
    // 자산 현황
    query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE is_active = true)        AS active,
        COUNT(*) FILTER (WHERE status = 'online')       AS online,
        COUNT(*) FILTER (WHERE status = 'offline')      AS offline,
        COUNT(*) FILTER (WHERE type = 'server')         AS servers,
        COUNT(*) FILTER (WHERE type = 'network')        AS networks,
        COUNT(*) FILTER (WHERE type = 'storage')        AS storages,
        COUNT(*) FILTER (WHERE type = 'vm')             AS vms
      FROM assets
      WHERE is_active = true
    `),

    // 알림 통계
    query(`
      SELECT
        COUNT(*)                                            AS total,
        COUNT(*) FILTER (WHERE severity = 'critical')      AS critical,
        COUNT(*) FILTER (WHERE severity = 'warning')       AS warning,
        COUNT(*) FILTER (WHERE severity = 'info')          AS info,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)    AS resolved,
        COUNT(*) FILTER (WHERE resolved_at IS NULL)        AS unresolved
      FROM alerts
      WHERE fired_at >= ${since}
    `),

    // 최근 알림 목록
    query(`
      SELECT a.severity, a.message, a.fired_at, a.resolved_at,
             ast.name AS asset_name
      FROM alerts a
      JOIN assets ast ON ast.id = a.asset_id
      WHERE a.fired_at >= ${since}
      ORDER BY a.fired_at DESC
      LIMIT 15
    `),

    // 디스크 TOP 10
    query(`
      SELECT DISTINCT ON (d.asset_id, d.mount_point)
             a.name AS asset_name, d.mount_point,
             ROUND((d.used_gb / NULLIF(d.total_gb, 0) * 100)::numeric, 1) AS pct,
             ROUND(d.used_gb::numeric, 1)  AS used_gb,
             ROUND(d.total_gb::numeric, 1) AS total_gb
      FROM disk_metrics d
      JOIN assets a ON a.id = d.asset_id
      WHERE d.collected_at >= now() - interval '${days} days'
        AND d.total_gb > 0
      ORDER BY d.asset_id, d.mount_point, d.collected_at DESC
      LIMIT 10
    `),

    // CPU TOP 10 (30일 최대)
    query(`
      SELECT a.name AS asset_name,
             ROUND(MAX(m.cpu_max)::numeric, 1) AS cpu_max,
             ROUND(AVG(m.cpu_avg)::numeric, 1) AS cpu_avg
      FROM metrics_1h m
      JOIN assets a ON a.id = m.asset_id
      WHERE m.bucket >= now() - interval '30 days'
        AND a.is_active = true AND a.type = 'server'
      GROUP BY a.id, a.name
      ORDER BY cpu_max DESC
      LIMIT 10
    `),

    // 메모리 TOP 10 (30일 최대)
    query(`
      SELECT a.name AS asset_name,
             ROUND(MAX(m.mem_max)::numeric, 1) AS mem_max,
             ROUND(AVG(m.mem_avg)::numeric, 1) AS mem_avg
      FROM metrics_1h m
      JOIN assets a ON a.id = m.asset_id
      WHERE m.bucket >= now() - interval '30 days'
        AND a.is_active = true AND a.type = 'server'
      GROUP BY a.id, a.name
      ORDER BY mem_max DESC
      LIMIT 10
    `),

    // LLM 예측 이력
    query(`
      SELECT p.issue_type, p.severity, p.confidence, p.summary,
             p.predicted_at, a.name AS asset_name, p.alert_sent
      FROM llm_predictions p
      JOIN assets a ON a.id = p.asset_id
      WHERE p.predicted_at >= ${since}
      ORDER BY p.predicted_at DESC
      LIMIT 20
    `),

    // 가용성 (온라인 비율 추이 - 일별)
    query(`
      SELECT DATE_TRUNC('day', fired_at)::text AS day,
             COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
             COUNT(*) FILTER (WHERE severity = 'warning')  AS warning
      FROM alerts
      WHERE fired_at >= ${since}
      GROUP BY day
      ORDER BY day
    `),

    // 스토리지 장비 사용량
    query(`
      SELECT a.name AS asset_name, v.volume_name,
             ROUND(v.used_gb::numeric, 1) AS used_gb,
             ROUND(v.total_gb::numeric, 1) AS total_gb,
             ROUND((v.used_gb / NULLIF(v.total_gb, 0) * 100)::numeric, 1) AS pct
      FROM storage_volumes v
      JOIN assets a ON a.id = v.asset_id
      WHERE v.total_gb > 0
      ORDER BY (v.used_gb / NULLIF(v.total_gb, 0)) DESC
      LIMIT 15
    `),
  ])

  return NextResponse.json({
    period: { days },
    assets:      assetSummary[0] ?? {},
    alertStats:  alertStats[0] ?? {},
    alertRecent,
    diskTop,
    cpuTop,
    memTop,
    storageTop,
    predictions,
    alertTrend: uptime,
  })
  } catch (err) {
    console.error('[Reports API]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
