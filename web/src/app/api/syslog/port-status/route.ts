import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'
import { sendAlert } from '@/lib/notify'

export async function POST(req: NextRequest) {
  try {
    const { hostname, port_name, link_status } = await req.json()

    if (!hostname || !port_name || !link_status) {
      return NextResponse.json({ error: 'hostname, port_name, link_status required' }, { status: 400 })
    }

    const asset = await queryOne<{ id: number; name: string }>(
      `SELECT id, name FROM assets
       WHERE hostname = $1 OR ip_address::text = $1 LIMIT 1`,
      [hostname]
    )
    if (!asset) return NextResponse.json({ ok: true }) // 미등록 장비 무시

    const now = new Date().toISOString()

    // 현재 상태와 비교 (변경 시만 기록)
    const existing = await queryOne<{ link_status: string }>(
      'SELECT link_status FROM network_ports WHERE asset_id = $1 AND port_name = $2',
      [asset.id, port_name]
    )

    if (existing?.link_status === link_status) {
      return NextResponse.json({ ok: true }) // 변경 없음
    }

    // UPSERT 현재 상태
    await execute(
      `INSERT INTO network_ports (asset_id, port_name, link_status, last_changed, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (asset_id, port_name) DO UPDATE
         SET link_status = $3, last_changed = $4, updated_at = $4`,
      [asset.id, port_name, link_status, now]
    )

    // 이력 기록
    await execute(
      `INSERT INTO network_port_history (asset_id, port_name, status, changed_at)
       VALUES ($1, $2, $3, $4)`,
      [asset.id, port_name, link_status, now]
    )

    // 링크 다운 → 알림
    if (link_status === 'down') {
      const alertRow = await queryOne<{ id: number }>(
        `INSERT INTO alerts (asset_id, severity, title, message, source)
         VALUES ($1, 'warning', $2, $3, 'topology')
         RETURNING id`,
        [
          asset.id,
          `포트 다운: ${asset.name} ${port_name}`,
          `${asset.name}의 포트 ${port_name}이 다운되었습니다`,
        ]
      )
      if (alertRow) {
        await sendAlert(alertRow.id, {
          title:     `포트 다운: ${asset.name} ${port_name}`,
          message:   `포트 ${port_name}이 다운되었습니다`,
          severity:  'warning',
          assetName: asset.name,
        }, ['slack', 'email'])
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PortStatus]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
