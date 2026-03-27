import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/service-checks/all — 전체 서버의 서비스 체크 목록
export async function GET() {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const checks = await query<{
    id: number; asset_id: number; asset_name: string; asset_ip: string
    name: string; type: string; target: string
    timeout_s: number; expected_code: number | null; expected_body: string | null
    is_active: boolean
    status: string; response_ms: number | null; checked_at: string | null
  }>(
    `SELECT sc.id, sc.asset_id,
            a.name AS asset_name, a.ip_address::text AS asset_ip,
            sc.name, sc.type, sc.target,
            sc.timeout_s, sc.expected_code, sc.expected_body, sc.is_active,
            CASE COALESCE(r.status, 'unknown')
              WHEN 'ok'       THEN 'up'
              WHEN 'up'       THEN 'up'
              WHEN 'critical' THEN 'down'
              WHEN 'down'     THEN 'down'
              ELSE 'unknown'
            END AS status,
            r.response_ms, r.checked_at
     FROM service_checks sc
     JOIN assets a ON a.id = sc.asset_id
     LEFT JOIN LATERAL (
       SELECT status, response_ms, checked_at
       FROM service_check_results
       WHERE check_id = sc.id
       ORDER BY checked_at DESC
       LIMIT 1
     ) r ON true
     WHERE sc.is_active = true
     ORDER BY a.name, sc.name`
  )

  return NextResponse.json({ checks })
}
