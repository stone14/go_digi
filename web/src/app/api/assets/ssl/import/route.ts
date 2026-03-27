import { NextRequest, NextResponse } from 'next/server'
import { transaction } from '@/lib/db'
import { requireRole } from '@/lib/auth'

const VALID_TYPES = ['ssl', 'domain']

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
    if (!a.domain) errors.push({ row: i + 1, error: '도메인 필수' })
    if (!a.domain_type || !VALID_TYPES.includes(String(a.domain_type))) {
      errors.push({ row: i + 1, error: `구분 오류: ${a.domain_type ?? '(없음)'} — ssl 또는 domain` })
    }
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
          `INSERT INTO ssl_domains
            (domain, domain_type, issuer, issued_at, expires_at,
             auto_renew, contact_name, contact_email, notes, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
          [
            a.domain,
            a.domain_type,
            a.issuer || null,
            a.issued_at || null,
            a.expires_at || null,
            a.auto_renew === true || a.auto_renew === 'true' || a.auto_renew === 'Y',
            a.contact_name || null,
            a.contact_email || null,
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
