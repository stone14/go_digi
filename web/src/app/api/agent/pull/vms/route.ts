import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await query<{
    id: number
    hostname: string
    ip_address: string | null
    os: string | null
    status: string
    cpu_usage: number | null
    mem_usage: number | null
    disk_usage_pct: number | null
    last_seen: string | null
  }>(`
    SELECT
      a.id, a.hostname, a.ip_address::text, a.os, a.status, a.last_seen::text,
      m.cpu_usage, m.mem_usage, m.disk_usage_pct
    FROM assets a
    LEFT JOIN LATERAL (
      SELECT cpu_usage, mem_usage, disk_usage_pct
      FROM metrics WHERE asset_id = a.id
      ORDER BY collected_at DESC LIMIT 1
    ) m ON true
    WHERE a.type = 'server' AND a.is_active = true
      AND a.node_type IN ('vm', 'cloud')
    ORDER BY a.status DESC, a.hostname ASC
  `)
  return NextResponse.json(rows)
}
