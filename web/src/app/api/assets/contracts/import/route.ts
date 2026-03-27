import { NextRequest, NextResponse } from 'next/server'
import { transaction } from '@/lib/db'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: '관리자만 가져오기 기능을 사용할 수 있습니다' }, { status: 403 })
  }

  let body: { items?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { items } = body
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items 배열이 필요합니다' }, { status: 400 })
  }
  if (items.length > 500) {
    return NextResponse.json({ error: '최대 500건까지 가져올 수 있습니다' }, { status: 400 })
  }

  const errors: { row: number; error: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const a = items[i] as Record<string, unknown>
    if (!a.software_name) errors.push({ row: i + 1, error: 'SW명 필수' })
    if (!a.vendor) errors.push({ row: i + 1, error: '벤더 필수' })
  }
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, created: 0, errors }, { status: 400 })
  }

  try {
    const created = await transaction(async (client) => {
      let count = 0
      for (const raw of items) {
        const a = raw as Record<string, unknown>
        await client.query(
          `INSERT INTO maintenance_contracts
            (vendor, contract_type, software_name, software_version, license_count,
             contract_start, contract_end, contact_name, contact_email, contact_phone, notes, is_active)
           VALUES ($1,'software',$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
          [
            a.vendor,
            a.software_name,
            a.software_version || null,
            a.license_count ? parseInt(String(a.license_count)) : null,
            a.start_date || null,
            a.end_date || null,
            a.contact_name || null,
            a.contact_email || null,
            a.contact_phone || null,
            a.notes || null,
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
