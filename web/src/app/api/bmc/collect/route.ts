import { NextRequest, NextResponse } from 'next/server'
import { query, execute, queryOne } from '@/lib/db'
import { RedfishClient } from '@/lib/redfish'
import { sendAlert } from '@/lib/notify'

// POST /api/bmc/collect  — 스케줄러가 호출 (단일 or 전체 수집)
// body: { asset_id?: number }  (없으면 전체 BMC 활성 장비)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const targetId = body?.asset_id as number | undefined

    const assets = await query<{
      id: number; name: string; bmc_ip: string; bmc_type: string
    }>(
      `SELECT a.id, a.name, a.bmc_ip::text, a.bmc_type,
              bc.username, bc.password
       FROM assets a
       JOIN bmc_credentials bc ON bc.asset_id = a.id
       WHERE a.bmc_enabled = true
         AND a.is_active = true
         ${targetId ? 'AND a.id = $1' : ''}`,
      targetId ? [targetId] : []
    )

    const results = await Promise.allSettled(
      assets.map(a => collectOne(a as unknown as Record<string, string>))
    )

    const summary = results.map((r, i) => ({
      asset_id: assets[i].id,
      status:   r.status,
      error:    r.status === 'rejected' ? String(r.reason) : undefined,
    }))

    return NextResponse.json({ ok: true, results: summary })
  } catch (err) {
    console.error('[BMC Collect]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function collectOne(asset: Record<string, string>) {
  const client = new RedfishClient(asset.bmc_ip, asset.username, asset.password)
  const now    = new Date().toISOString()

  // 병렬 수집
  const [thermal, power, health] = await Promise.all([
    client.getThermal().catch(() => null),
    client.getPower().catch(() => null),
    client.getHealth().catch(() => null),
  ])

  // CPU 온도 추출
  const cpu1 = thermal?.temperatures.find(t =>
    t.physicalContext === 'CPU' || t.name.toLowerCase().includes('cpu1') || t.name.toLowerCase().includes('cpu 1')
  )
  const cpu2 = thermal?.temperatures.find(t =>
    t.name.toLowerCase().includes('cpu2') || t.name.toLowerCase().includes('cpu 2')
  )
  const inlet  = thermal?.temperatures.find(t =>
    t.physicalContext === 'Intake' || t.name.toLowerCase().includes('inlet')
  )
  const outlet = thermal?.temperatures.find(t =>
    t.physicalContext === 'Exhaust' || t.name.toLowerCase().includes('exhaust') || t.name.toLowerCase().includes('outlet')
  )

  // 팬 속도 JSONB
  const fanSpeeds = thermal?.fans.reduce((acc, f) => {
    acc[f.name] = f.reading
    return acc
  }, {} as Record<string, number | null>)

  const psu1 = power?.powerSupplies[0]
  const psu2 = power?.powerSupplies[1]

  // bmc_metrics 저장
  await execute(
    `INSERT INTO bmc_metrics
       (asset_id, collected_at, power_watts, psu1_status, psu2_status,
        cpu1_temp_c, cpu2_temp_c, inlet_temp_c, outlet_temp_c, fan_speeds, overall_health)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      asset.id, now,
      power?.powerConsumedWatts ?? null,
      psu1?.status ?? null,
      psu2?.status ?? null,
      cpu1?.readingCelsius ?? null,
      cpu2?.readingCelsius ?? null,
      inlet?.readingCelsius ?? null,
      outlet?.readingCelsius ?? null,
      fanSpeeds ? JSON.stringify(fanSpeeds) : null,
      health?.overall ?? null,
    ]
  )

  // hw_health 업데이트
  const healthComponents = [
    { component: 'CPU',     name: 'CPU',     status: health?.cpu     ?? 'Unknown' },
    { component: 'Memory',  name: 'Memory',  status: health?.memory  ?? 'Unknown' },
    { component: 'Storage', name: 'Storage', status: health?.storage ?? 'Unknown' },
    { component: 'Network', name: 'Network', status: health?.network ?? 'Unknown' },
  ]
  if (psu1) healthComponents.push({ component: 'PSU', name: psu1.name || 'PSU1', status: psu1.status })
  if (psu2) healthComponents.push({ component: 'PSU', name: psu2.name || 'PSU2', status: psu2.status })

  for (const hc of healthComponents) {
    const status = mapRedfishHealth(hc.status)
    await execute(
      `INSERT INTO hw_health (asset_id, component, name, status, checked_at)
       VALUES ($1, $2, $3, $4, now())`,
      [asset.id, hc.component, hc.name, status]
    )

    // Critical 상태 → 알림
    if (status === 'critical') {
      const existing = await queryOne<{ id: number }>(
        `SELECT id FROM alerts
         WHERE asset_id = $1 AND title LIKE $2 AND status = 'active'
         LIMIT 1`,
        [asset.id, `%하드웨어 장애%${hc.name}%`]
      )
      if (!existing) {
        const alertRow = await queryOne<{ id: number }>(
          `INSERT INTO alerts (asset_id, severity, title, message, source)
           VALUES ($1, 'critical', $2, $3, 'threshold')
           RETURNING id`,
          [
            asset.id,
            `하드웨어 장애: ${asset.name} ${hc.name}`,
            `${hc.name} 상태가 Critical입니다 (Redfish)`,
          ]
        )
        if (alertRow) {
          await sendAlert(alertRow.id, {
            title:     `하드웨어 장애: ${asset.name} ${hc.name}`,
            message:   `${hc.name} 상태 Critical`,
            severity:  'critical',
            assetName: asset.name,
          }, ['slack', 'email'])
        }
      }
    }
  }

  // SEL 증분 수집 (최근 20개만)
  try {
    const selEntries = await client.getSEL()
    for (const sel of selEntries.slice(0, 20)) {
      await execute(
        `INSERT INTO bmc_sel (asset_id, event_id, occurred_at, severity, message, raw)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          asset.id,
          sel.id,
          sel.created || now,
          mapRedfishHealth(sel.severity),
          sel.message,
          JSON.stringify(sel),
        ]
      )
    }
  } catch {
    // SEL 수집 실패는 무시
  }
}

function mapRedfishHealth(status: string): string {
  const s = status.toLowerCase()
  if (s === 'critical')  return 'critical'
  if (s === 'warning')   return 'warning'
  if (s === 'ok')        return 'ok'
  return 'unknown'
}
