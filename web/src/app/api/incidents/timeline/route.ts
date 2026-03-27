import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/incidents/timeline?incident_id=N
export async function GET(req: NextRequest) {
  await requireAuth()
  const id = new URL(req.url).searchParams.get('incident_id')
  if (!id) return NextResponse.json({ error: 'incident_id required' }, { status: 400 })

  const rows = await query<{
    id: number; event_type: string; content: string | null
    occurred_at: string; username: string | null
  }>(
    `SELECT t.id, t.event_type, t.content, t.occurred_at, u.username
     FROM incident_timeline t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.incident_id = $1
     ORDER BY t.occurred_at ASC`,
    [id]
  )

  return NextResponse.json({ timeline: rows })
}
