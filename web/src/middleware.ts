import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/agent', '/api/metrics']

// Edge Runtime 호환 JWT 만료 확인 (서명 검증은 API 라우트에서 수행)
function isTokenValid(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp > Date.now() / 1000
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    const token = req.cookies.get('argus_token')?.value
    if (!token || !isTokenValid(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  const token = req.cookies.get('argus_token')?.value
  if (!token || !isTokenValid(token)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
