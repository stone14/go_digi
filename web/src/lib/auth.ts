import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import { queryOne } from './db'

const JWT_SECRET = process.env.JWT_SECRET || 'argus-secret-change-in-production'
const COOKIE_NAME = 'argus_token'

export interface AuthUser {
  id: number
  username: string
  email: string
  role: 'admin' | 'operator' | 'readonly'
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '8h' })
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser
  } catch {
    return null
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

export async function requireRole(role: 'admin' | 'operator'): Promise<AuthUser> {
  const user = await requireAuth()
  const hierarchy = { admin: 2, operator: 1, readonly: 0 }
  if (hierarchy[user.role] < hierarchy[role]) throw new Error('Forbidden')
  return user
}

export function setAuthCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.SECURE_COOKIE === 'true',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 8, // 8h
    path: '/',
  }
}

export { COOKIE_NAME }
