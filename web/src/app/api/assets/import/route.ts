import { NextRequest, NextResponse } from 'next/server'
import { transaction } from '@/lib/db'
import { requireRole } from '@/lib/auth'

const VALID_TYPES = ['server', 'switch', 'router', 'firewall', 'storage', 'fc_switch', 'load_balancer']

export async function POST(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: '관리자만 가져오기 기능을 사용할 수 있습니다' }, { status: 403 })
  }

  let body: { assets?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { assets } = body
  if (!Array.isArray(assets) || assets.length === 0) {
    return NextResponse.json({ error: 'assets 배열이 필요합니다' }, { status: 400 })
  }
  if (assets.length > 500) {
    return NextResponse.json({ error: '최대 500건까지 가져올 수 있습니다' }, { status: 400 })
  }

  // Validate all rows
  const errors: { row: number; error: string }[] = []
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i] as Record<string, unknown>
    if (!a.name) errors.push({ row: i + 1, error: '장비명 필수' })
    if (!a.ip_address) errors.push({ row: i + 1, error: 'IP 주소 필수' })
    if (!a.asset_type || !VALID_TYPES.includes(String(a.asset_type))) {
      errors.push({ row: i + 1, error: `타입 오류: ${a.asset_type ?? '(없음)'}` })
    }
  }
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, created: 0, errors }, { status: 400 })
  }

  try {
    const created = await transaction(async (client) => {
      let count = 0
      for (const raw of assets) {
        const a = raw as Record<string, unknown>
        await client.query(
          `INSERT INTO assets
            (name, hostname, ip_address, type, os, location,
             manufacturer, model, serial_number,
             monitoring_enabled, introduced_at, registration_source,
             manager, user_name, user_team,
             status, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'offline',true)`,
          [
            a.name,
            a.hostname || '',
            a.ip_address,
            a.asset_type,
            a.os_type || '',
            a.location || '',
            a.manufacturer || null,
            a.model || null,
            a.serial_number || null,
            a.monitoring_enabled ?? true,
            a.introduced_at || null,
            'import',
            a.manager || null,
            a.user_name || null,
            a.user_team || null,
          ]
        )
        count++
      }
      return count
    })

    return NextResponse.json({ ok: true, created, errors: [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, created: 0, errors: [{ row: 0, error: msg }] }, { status: 500 })
  }
}
