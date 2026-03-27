import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/server-logs?asset_id=N&level=error&search=&limit=300
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const assetId = searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const level  = searchParams.get('level')  ?? ''
  const search = searchParams.get('search') ?? ''
  const limit  = parseInt(searchParams.get('limit') ?? '300')

  const conditions = ['asset_id = $1']
  const params: unknown[] = [assetId]
  let idx = 2

  if (level) {
    conditions.push(`level = $${idx++}`)
    params.push(level)
  }
  if (search) {
    conditions.push(`message ILIKE $${idx++}`)
    params.push(`%${search}%`)
  }

  const where = conditions.join(' AND ')

  const logs = await query<{
    id: number
    collected_at: string
    level: string
    source: string
    message: string
  }>(
    `SELECT id, collected_at, level, source, message
     FROM server_logs
     WHERE ${where}
     ORDER BY collected_at DESC
     LIMIT ${limit}`,
    params
  )

  return NextResponse.json({ logs })
}
