import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import crypto from 'crypto'

// GET /api/settings/agents
// GET /api/settings/agents?list=servers — 서버 목록 (Agent 설치 대상 선택용)
export async function GET(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const list = req.nextUrl.searchParams.get('list')

  if (list === 'servers') {
    const servers = await query<{
      id: number; hostname: string; ip_address: string | null
      type: string; os: string | null; agent_version: string | null
    }>(
      `SELECT id, hostname, ip_address::text, type, os, agent_version
       FROM assets WHERE is_active = true AND type IN ('server')
       ORDER BY hostname`
    )
    return NextResponse.json({ servers })
  }

  const agents = await query<{
    id: number; token: string; label: string | null
    asset_id: number | null; asset_name: string | null
    ip_address: string | null; os: string | null; agent_version: string | null
    last_seen: string | null; revoked: boolean; created_at: string
  }>(
    `SELECT t.id, t.token, t.label, t.asset_id,
            a.name AS asset_name, a.ip_address::text, a.os, a.agent_version,
            t.last_seen, t.revoked, t.created_at
     FROM agent_tokens t
     LEFT JOIN assets a ON a.id = t.asset_id
     ORDER BY t.created_at DESC`
  )
  return NextResponse.json({ agents })
}

// POST /api/settings/agents — 새 토큰 발급
export async function POST(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { label, asset_id } = await req.json().catch(() => ({}))
  const token = crypto.randomBytes(32).toString('hex')

  const row = await queryOne<{ id: number }>(
    `INSERT INTO agent_tokens (token, label, asset_id) VALUES ($1,$2,$3) RETURNING id`,
    [token, label ?? null, asset_id ?? null]
  )
  return NextResponse.json({ ok: true, id: row?.id, token })
}

// DELETE /api/settings/agents?id=N — 토큰 폐기
export async function DELETE(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute('UPDATE agent_tokens SET revoked = true WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
