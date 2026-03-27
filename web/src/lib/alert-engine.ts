/**
 * Digicap Alert Engine
 * - 메트릭 임계치 평가
 * - Agent offline 감지
 * - 알림 발송 (Slack / Email)
 * - 에스컬레이션 처리
 * node-cron으로 스케줄 실행
 */
import { query, queryOne, execute } from './db'
import { sendAlert } from './notify'

interface AlertRule {
  id: number
  name: string
  asset_id: number | null
  group_tag: string | null          // legacy, keep for SELECT *
  asset_type_filter: string | null  // added in migration 002
  metric: string
  operator: string
  threshold: number
  duration_s: number
  severity: 'critical' | 'warning' | 'info'
  notify_channels: string[]         // added in migration 002
}

interface LatestMetric {
  asset_id: number
  cpu_usage: number
  mem_usage: number
  disk_read_bps: number
  disk_write_bps: number
  disk_usage_pct: number
  net_rx_bps: number
  net_tx_bps: number
  collected_at: string
}

function evaluate(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case '>':  return value > threshold
    case '>=': return value >= threshold
    case '<':  return value < threshold
    case '<=': return value <= threshold
    case '=':  return value === threshold
    default:   return false
  }
}

export async function runAlertEvaluation() {
  try {
    const rules = await query<AlertRule>(
      'SELECT * FROM alert_rules WHERE is_active = true'
    )
    if (!rules.length) return

    // 최근 메트릭 (각 자산의 최신값)
    const metrics = await query<LatestMetric>(
      `SELECT DISTINCT ON (asset_id)
         asset_id, cpu_usage, mem_usage, disk_read_bps, disk_write_bps,
         disk_usage_pct, net_rx_bps, net_tx_bps, collected_at
       FROM metrics
       WHERE collected_at > now() - interval '5 minutes'
       ORDER BY asset_id, collected_at DESC`
    )

    const metricMap = new Map(metrics.map(m => [m.asset_id, m]))

    // 쿨다운 설정
    const cooldownSetting = await queryOne<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'alert_cooldown_s'"
    )
    const cooldownS = parseInt(cooldownSetting?.value || '300')

    for (const rule of rules) {
      // Build candidate metric list
      let candidates = rule.asset_id
        ? [metricMap.get(rule.asset_id)].filter(Boolean) as LatestMetric[]
        : [...metricMap.values()]

      // Filter by asset_type if specified (migration 002+)
      if (!rule.asset_id && rule.asset_type_filter) {
        const assetIds = await query<{ id: number }>(
          `SELECT id FROM assets WHERE type = $1 AND is_active = true`,
          [rule.asset_type_filter]
        )
        const allowed = new Set(assetIds.map(a => a.id))
        candidates = candidates.filter(m => allowed.has(m.asset_id))
      }

      const targets = candidates

      for (const metric of targets as LatestMetric[]) {
        const value = (metric as unknown as Record<string, unknown>)[rule.metric] as number
        if (value === undefined || value === null) continue

        if (!evaluate(value, rule.operator, rule.threshold)) continue

        // 이미 active 알림 있는지 확인 (쿨다운)
        const existing = await queryOne<{ id: number }>(
          `SELECT id FROM alerts
           WHERE rule_id = $1 AND asset_id = $2
             AND status = 'active'
             AND fired_at > now() - interval '${cooldownS} seconds'
           LIMIT 1`,
          [rule.id, metric.asset_id]
        )
        if (existing) continue

        // 알림 생성
        const assetRow = await queryOne<{ name: string; id: number }>(
          'SELECT id, name FROM assets WHERE id = $1',
          [metric.asset_id]
        )

        const title   = `${assetRow?.name || `Asset#${metric.asset_id}`} — ${rule.name}`
        const message = `${rule.metric} = ${value.toFixed(1)} (임계치: ${rule.operator} ${rule.threshold})`

        const alertRow = await queryOne<{ id: number }>(
          `INSERT INTO alerts (rule_id, asset_id, severity, title, message, source)
           VALUES ($1, $2, $3, $4, $5, 'threshold')
           RETURNING id`,
          [rule.id, metric.asset_id, rule.severity, title, message]
        )

        if (alertRow) {
          const channels = (rule.notify_channels?.length ? rule.notify_channels : ['slack']) as Array<'slack' | 'email' | 'webhook'>
          await sendAlert(alertRow.id, {
            title, message,
            severity: rule.severity,
            assetName: assetRow?.name,
            alertId: alertRow.id,
          }, channels)
        }
      }
    }
  } catch (err) {
    console.error('[AlertEngine] Evaluation error:', err)
  }
}

export async function runOfflineCheck() {
  try {
    const setting = await queryOne<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'agent_check_interval'"
    )
    const thresholdMin = parseInt(setting?.value || '5')

    // 서버 + 네트워크 장비 오프라인 감지
    const offlineAssets = await query<{ id: number; name: string; type: string }>(
      `UPDATE assets
       SET status = 'offline'
       WHERE type IN ('server', 'switch', 'router', 'firewall')
         AND status = 'online'
         AND (last_seen IS NULL OR last_seen < now() - ($1 || ' minutes')::interval)
       RETURNING id, name, type`,
      [thresholdMin]
    )

    for (const asset of offlineAssets) {
      const isNetwork = ['switch', 'router', 'firewall'].includes(asset.type)
      const title     = isNetwork
        ? `${asset.name} — 네트워크 장비 중단`
        : `${asset.name} — 서버 중단`
      const message   = isNetwork
        ? `네트워크 장비 응답 없음 (${thresholdMin}분 이상)`
        : `Agent 응답 없음 (${thresholdMin}분 이상)`

      // 이미 active 알림 있는지 확인
      const existingAlert = await queryOne<{ id: number }>(
        `SELECT id FROM alerts
         WHERE asset_id = $1 AND source = 'threshold'
           AND status = 'active' AND title LIKE '%중단%'
         LIMIT 1`,
        [asset.id]
      )
      if (!existingAlert) {
        const alertRow = await queryOne<{ id: number }>(
          `INSERT INTO alerts (asset_id, severity, title, message, source)
           VALUES ($1, 'critical', $2, $3, 'threshold')
           RETURNING id`,
          [asset.id, title, message]
        )
        if (alertRow) {
          await sendAlert(alertRow.id, { title, message, severity: 'critical', assetName: asset.name },
            ['slack', 'email'])
        }
      }

      // 이미 open 장애내역 있는지 확인
      const existingIncident = await queryOne<{ id: number }>(
        `SELECT id FROM incidents
         WHERE $1 = ANY(asset_ids) AND status != 'resolved'
         LIMIT 1`,
        [asset.id]
      )
      if (!existingIncident) {
        const incident = await queryOne<{ id: number }>(
          `INSERT INTO incidents (title, severity, asset_ids, status)
           VALUES ($1, 'critical', $2, 'open')
           RETURNING id`,
          [title, [asset.id]]
        )
        if (incident) {
          await execute(
            `INSERT INTO incident_timeline (incident_id, event_type, content)
             VALUES ($1, 'status_change', $2)`,
            [incident.id, `[자동] ${message}`]
          )
        }
      }
    }

    // 복구된 자산 — 알림 & 장애내역 자동 해결
    const recoveredAssets = await query<{ id: number; name: string }>(
      `SELECT id, name FROM assets
       WHERE status = 'online'
         AND type IN ('server', 'switch', 'router', 'firewall')`
    )

    for (const asset of recoveredAssets) {
      // 알림 해결
      await execute(
        `UPDATE alerts SET status = 'resolved', resolved_at = now()
         WHERE asset_id = $1 AND source = 'threshold'
           AND status = 'active' AND title LIKE '%중단%'`,
        [asset.id]
      )

      // 장애내역 자동 해결
      const openIncident = await queryOne<{ id: number }>(
        `SELECT id FROM incidents
         WHERE $1 = ANY(asset_ids) AND status != 'resolved'
         LIMIT 1`,
        [asset.id]
      )
      if (openIncident) {
        await execute(
          `UPDATE incidents SET status = 'resolved', resolved_at = now()
           WHERE id = $1`,
          [openIncident.id]
        )
        await execute(
          `INSERT INTO incident_timeline (incident_id, event_type, content)
           VALUES ($1, 'status_change', $2)`,
          [openIncident.id, `[자동] ${asset.name} 복구 감지 — 장애 자동 해결`]
        )
      }
    }
  } catch (err) {
    console.error('[AlertEngine] Offline check error:', err)
  }
}

// 집계 실행 (raw → 5분, 5분 → 1시간)
export async function runAggregation() {
  try {
    // 5분 집계
    await execute(`
      INSERT INTO metrics_5m (asset_id, bucket, cpu_avg, cpu_max, mem_avg, mem_max,
        disk_read_avg, disk_write_avg, net_rx_avg, net_tx_avg, sample_count)
      SELECT
        asset_id,
        date_trunc('hour', collected_at) + INTERVAL '5 min' * (date_part('minute', collected_at)::int / 5) AS bucket,
        AVG(cpu_usage), MAX(cpu_usage),
        AVG(mem_usage), MAX(mem_usage),
        AVG(disk_read_bps)::BIGINT, AVG(disk_write_bps)::BIGINT,
        AVG(net_rx_bps)::BIGINT, AVG(net_tx_bps)::BIGINT,
        COUNT(*)
      FROM metrics
      WHERE collected_at > now() - interval '10 minutes'
        AND collected_at <= date_trunc('hour', now()) + INTERVAL '5 min' * (date_part('minute', now())::int / 5)
      GROUP BY asset_id, bucket
      ON CONFLICT (asset_id, bucket) DO UPDATE SET
        cpu_avg = EXCLUDED.cpu_avg, cpu_max = EXCLUDED.cpu_max,
        mem_avg = EXCLUDED.mem_avg, mem_max = EXCLUDED.mem_max,
        disk_read_avg = EXCLUDED.disk_read_avg, disk_write_avg = EXCLUDED.disk_write_avg,
        net_rx_avg = EXCLUDED.net_rx_avg, net_tx_avg = EXCLUDED.net_tx_avg,
        sample_count = EXCLUDED.sample_count
    `)

    // 1시간 집계
    await execute(`
      INSERT INTO metrics_1h (asset_id, bucket, cpu_avg, cpu_max, mem_avg, mem_max,
        disk_read_avg, disk_write_avg, net_rx_avg, net_tx_avg, sample_count)
      SELECT
        asset_id,
        date_trunc('hour', bucket) AS bucket,
        AVG(cpu_avg), MAX(cpu_max),
        AVG(mem_avg), MAX(mem_max),
        AVG(disk_read_avg)::BIGINT, AVG(disk_write_avg)::BIGINT,
        AVG(net_rx_avg)::BIGINT, AVG(net_tx_avg)::BIGINT,
        SUM(sample_count)
      FROM metrics_5m
      WHERE bucket > now() - interval '2 hours'
        AND bucket <= date_trunc('hour', now())
      GROUP BY asset_id, date_trunc('hour', bucket)
      ON CONFLICT (asset_id, bucket) DO UPDATE SET
        cpu_avg = EXCLUDED.cpu_avg, cpu_max = EXCLUDED.cpu_max,
        mem_avg = EXCLUDED.mem_avg, mem_max = EXCLUDED.mem_max,
        disk_read_avg = EXCLUDED.disk_read_avg, disk_write_avg = EXCLUDED.disk_write_avg,
        net_rx_avg = EXCLUDED.net_rx_avg, net_tx_avg = EXCLUDED.net_tx_avg,
        sample_count = EXCLUDED.sample_count
    `)
  } catch (err) {
    console.error('[AlertEngine] Aggregation error:', err)
  }
}
