import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const typeFilter = req.nextUrl.searchParams.get('type') // ssl | domain | (all)

  const domains = await query<{
    id: number; domain: string; domain_type: string; issuer: string | null
    issued_at: string | null; expires_at: string | null; auto_renew: boolean
    contact_name: string | null; contact_email: string | null; notes: string | null
  }>(
    typeFilter
      ? `SELECT id, domain, domain_type, issuer,
                issued_at::text, expires_at::text, auto_renew,
                contact_name, contact_email, notes
         FROM ssl_domains WHERE domain_type=$1 AND is_active=true ORDER BY expires_at ASC`
      : `SELECT id, domain, domain_type, issuer,
                issued_at::text, expires_at::text, auto_renew,
                contact_name, contact_email, notes
         FROM ssl_domains WHERE is_active=true ORDER BY expires_at ASC`,
    typeFilter ? [typeFilter] : []
  )

  return NextResponse.json({ domains })
}

export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain, domain_type = 'ssl', issuer, issued_at, expires_at,
          auto_renew = false, contact_name, contact_email, notes } = await req.json()
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  const row = await queryOne<{ id: number }>(
    `INSERT INTO ssl_domains (domain, domain_type, issuer, issued_at, expires_at,
       auto_renew, contact_name, contact_email, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [domain, domain_type, issuer ?? null, issued_at ?? null, expires_at ?? null,
     auto_renew, contact_name ?? null, contact_email ?? null, notes ?? null]
  )
  return NextResponse.json({ ok: true, id: row?.id })
}

export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, domain, domain_type, issuer, issued_at, expires_at,
          auto_renew, contact_name, contact_email, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(
    `UPDATE ssl_domains SET domain=$1, domain_type=$2, issuer=$3, issued_at=$4,
       expires_at=$5, auto_renew=$6, contact_name=$7, contact_email=$8, notes=$9
     WHERE id=$10`,
    [domain, domain_type, issuer ?? null, issued_at ?? null, expires_at ?? null,
     auto_renew, contact_name ?? null, contact_email ?? null, notes ?? null, id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute(`UPDATE ssl_domains SET is_active=false WHERE id=$1`, [id])
  return NextResponse.json({ ok: true })
}
