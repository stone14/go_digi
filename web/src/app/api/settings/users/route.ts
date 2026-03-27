import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import bcrypt from 'bcryptjs'

// GET /api/settings/users
export async function GET() {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const users = await query<{
    id: number; username: string; email: string
    role: string; is_active: boolean; last_login: string | null; created_at: string
  }>(
    `SELECT id, username, email, role, is_active, last_login, created_at
     FROM users ORDER BY created_at ASC`
  )
  return NextResponse.json({ users })
}

// POST /api/settings/users — create
export async function POST(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { username, email, password, role = 'readonly' } = await req.json()
  if (!username || !email || !password) {
    return NextResponse.json({ error: 'username, email, password required' }, { status: 400 })
  }
  if (!['admin', 'operator', 'readonly'].includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1',
    [username, email]
  )
  if (existing) return NextResponse.json({ error: '이미 존재하는 사용자입니다' }, { status: 409 })

  const hash = await bcrypt.hash(password, 12)
  const row  = await queryOne<{ id: number }>(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
    [username, email, hash, role]
  )
  return NextResponse.json({ ok: true, id: row?.id })
}

// PUT /api/settings/users — update role / active state / password
export async function PUT(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, role, is_active, password } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (role !== undefined) {
    if (!['admin', 'operator', 'readonly'].includes(role)) {
      return NextResponse.json({ error: 'invalid role' }, { status: 400 })
    }
    await execute('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, id])
  }
  if (is_active !== undefined) {
    await execute('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2', [is_active, id])
  }
  if (password) {
    const hash = await bcrypt.hash(password, 12)
    await execute('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, id])
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/settings/users?id=N
export async function DELETE(req: NextRequest) {
  try {
    await requireRole('admin')
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await execute('UPDATE users SET is_active = false, updated_at = now() WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
