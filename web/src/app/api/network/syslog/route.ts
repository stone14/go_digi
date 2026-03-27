import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// RFC 5424: severity is SMALLINT 0-7
// Map string name → numeric level for DB query
const SEV_NUM: Record<string, number> = {
  emergency: 0, alert: 1, critical: 2, error: 3,
  warning: 4, notice: 5, info: 6, debug: 7,
}

// Map numeric → string label for response
const SEV_LABEL: Record<number, string> = {
  0: 'emergency', 1: 'alert', 2: 'critical', 3: 'error',
  4: 'warning', 5: 'notice', 6: 'info', 7: 'debug',
}

// GET /api/network/syslog?asset_id=N&limit=200&severity=error&search=
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const assetId  = searchParams.get('asset_id')
  const sevLabel = searchParams.get('severity') ?? ''    // string name
  const search   = searchParams.get('search')   ?? ''
  const limit    = parseInt(searchParams.get('limit') ?? '200')

  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const conditions = ['s.asset_id = $1']
  const params: unknown[] = [assetId]
  let idx = 2

  // Convert string severity label → SMALLINT for DB
  if (sevLabel && SEV_NUM[sevLabel] !== undefined) {
    conditions.push(`s.severity = $${idx++}`)
    params.push(SEV_NUM[sevLabel])
  }
  if (search) {
    conditions.push(`s.message ILIKE $${idx++}`)
    params.push(`%${search}%`)
  }

  const where = conditions.join(' AND ')

  const rows = await query<{
    id: number | string
    received_at: string
    severity: number     // SMALLINT from DB
    facility: number | null
    hostname: string
    program: string | null
    message: string
    raw: string | null
  }>(
    `SELECT id, received_at, severity, facility, hostname, program, message, raw
     FROM syslog_entries s
     WHERE ${where}
     ORDER BY received_at DESC
     LIMIT ${limit}`,
    params
  )

  // Convert numeric severity to string label before returning
  const logs = rows.map(r => ({
    ...r,
    severity: SEV_LABEL[r.severity] ?? String(r.severity),
  }))

  return NextResponse.json({ logs })
}
