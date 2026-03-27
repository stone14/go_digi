import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { signToken, setAuthCookie, COOKIE_NAME } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import bcrypt from 'bcryptjs'

const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 30

// POST /api/auth — login
export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()
    if (!username || !password)
      return NextResponse.json({ error: '아이디/비밀번호를 입력하세요' }, { status: 400 })

    const user = await queryOne<{
      id: number; username: string; email: string
      role: string; password_hash: string; is_active: boolean
      failed_attempts: number; locked_until: string | null
    }>(
      `SELECT id, username, email, role, password_hash, is_active, failed_attempts, locked_until
       FROM users WHERE username = $1 OR email = $1 LIMIT 1`,
      [username]
    )

    if (!user || !user.is_active)
      return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' }, { status: 401 })

    // Check lockout
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until)
      if (lockedUntil > new Date()) {
        const remaining = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000)
        return NextResponse.json(
          { error: `로그인이 잠겼습니다. ${remaining}분 후 다시 시도하세요` },
          { status: 429 }
        )
      }
      // Lockout expired — reset
      await execute(`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id])
      user.failed_attempts = 0
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      const attempts = user.failed_attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await execute(
          `UPDATE users SET failed_attempts = $1, locked_until = now() + interval '${LOCKOUT_MINUTES} minutes' WHERE id = $2`,
          [attempts, user.id]
        )
        return NextResponse.json(
          { error: `${MAX_ATTEMPTS}회 로그인 실패. ${LOCKOUT_MINUTES}분간 잠금됩니다` },
          { status: 429 }
        )
      }
      await execute(`UPDATE users SET failed_attempts = $1 WHERE id = $2`, [attempts, user.id])
      return NextResponse.json(
        { error: `아이디 또는 비밀번호가 올바르지 않습니다 (${attempts}/${MAX_ATTEMPTS})` },
        { status: 401 }
      )
    }

    // Success — reset failed attempts
    await execute(`UPDATE users SET last_login = now(), failed_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id])

    const token = signToken({
      id: user.id, username: user.username,
      email: user.email, role: user.role as 'admin' | 'operator' | 'readonly',
    })

    await logAudit({ userId: user.id, action: 'login', targetType: 'user', targetId: user.id, detail: { username: user.username } })

    const res = NextResponse.json({ ok: true, username: user.username, role: user.role })
    res.cookies.set(setAuthCookie(token))
    return res
  } catch (err) {
    console.error('[Auth] Login error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// GET /api/auth — current user info
export async function GET() {
  try {
    const { getAuthUser } = await import('@/lib/auth')
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ user: null }, { status: 401 })
    return NextResponse.json({ user: { username: user.username, email: user.email, role: user.role } })
  } catch {
    return NextResponse.json({ user: null }, { status: 401 })
  }
}

// DELETE /api/auth — logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: COOKIE_NAME, value: '', maxAge: 0, path: '/' })
  return res
}
