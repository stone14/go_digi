import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'
import { sendAlert } from '@/lib/notify'

export async function POST(req: NextRequest) {
  try {
    const { hostname, message } = await req.json()

    const asset = await queryOne<{ id: number; name: string }>(
      `SELECT id, name FROM assets
       WHERE hostname = $1 OR ip_address::text = $1 LIMIT 1`,
      [hostname]
    )
    if (!asset) return NextResponse.json({ ok: true })

    await execute(
      `INSERT INTO config_changes (asset_id, change_type, summary, raw_log, source)
       VALUES ($1, 'config_change', $2, $3, 'syslog')`,
      [asset.id, `설정 변경 감지: ${asset.name}`, message]
    )

    const alertRow = await queryOne<{ id: number }>(
      `INSERT INTO alerts (asset_id, severity, title, message, source)
       VALUES ($1, 'info', $2, $3, 'topology')
       RETURNING id`,
      [asset.id, `설정 변경 감지: ${asset.name}`, message?.slice(0, 300)]
    )
    if (alertRow) {
      await sendAlert(alertRow.id, {
        title:     `설정 변경: ${asset.name}`,
        message:   message?.slice(0, 200),
        severity:  'info',
        assetName: asset.name,
      }, ['slack'])
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ConfigChange]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
