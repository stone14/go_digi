import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/reports/compliance — ISMS 컴플라이언스 현황 데이터
// GET /api/reports/compliance?detail=<type> — 세부 내역
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const detail = req.nextUrl.searchParams.get('detail')
  if (detail) return getDetail(detail)

  // 자산 완성도
  const assetCompleteness = await queryOne<{
    total: number
    with_manager: number
    with_contract: number
    with_org: number
  }>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(NULLIF(manager, ''))::int AS with_manager,
      (SELECT COUNT(DISTINCT asset_id)::int FROM maintenance_contracts WHERE is_active = true) AS with_contract,
      COUNT(org_id)::int AS with_org
    FROM assets WHERE is_active = true
  `)

  // 인시던트 MTTD/MTTR (최근 90일)
  const incidentMetrics = await queryOne<{
    total: number
    resolved: number
    avg_mttr_minutes: number
    open: number
  }>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(resolved_at)::int AS resolved,
      COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - opened_at)) / 60) FILTER (WHERE resolved_at IS NOT NULL), 0)::int AS avg_mttr_minutes,
      COUNT(*) FILTER (WHERE status != 'resolved')::int AS open
    FROM incidents
    WHERE opened_at >= now() - interval '90 days'
  `)

  // 접근 제어 현황
  const accessControl = await queryOne<{
    total_users: number
    admin_count: number
    operator_count: number
    readonly_count: number
    locked_count: number
  }>(`
    SELECT
      COUNT(*)::int AS total_users,
      COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_count,
      COUNT(*) FILTER (WHERE role = 'operator')::int AS operator_count,
      COUNT(*) FILTER (WHERE role = 'readonly')::int AS readonly_count,
      COUNT(*) FILTER (WHERE locked_until IS NOT NULL AND locked_until > now())::int AS locked_count
    FROM users WHERE is_active = true
  `)

  // 감사 로그 요약 (최근 30일)
  const auditSummary = await query<{ action: string; cnt: number }>(`
    SELECT action, COUNT(*)::int AS cnt
    FROM audit_logs
    WHERE occurred_at >= now() - interval '30 days'
    GROUP BY action ORDER BY cnt DESC LIMIT 10
  `)

  const auditTotal = await queryOne<{ cnt: number }>(`
    SELECT COUNT(*)::int AS cnt FROM audit_logs WHERE occurred_at >= now() - interval '30 days'
  `)

  // 에이전트 커버리지
  const agentCoverage = await queryOne<{
    total_servers: number
    with_agent: number
  }>(`
    SELECT
      COUNT(*)::int AS total_servers,
      COUNT(agent_version)::int AS with_agent
    FROM assets WHERE is_active = true AND type = 'server'
  `)

  return NextResponse.json({
    assetCompleteness: assetCompleteness ?? { total: 0, with_manager: 0, with_contract: 0, with_org: 0 },
    incidentMetrics: incidentMetrics ?? { total: 0, resolved: 0, avg_mttr_minutes: 0, open: 0 },
    accessControl: accessControl ?? { total_users: 0, admin_count: 0, operator_count: 0, readonly_count: 0, locked_count: 0 },
    auditSummary: auditSummary ?? [],
    auditTotal: auditTotal?.cnt ?? 0,
    agentCoverage: agentCoverage ?? { total_servers: 0, with_agent: 0 },
  })
}

// 세부 내역 조회
async function getDetail(type: string) {
  switch (type) {
    case 'assets_all': {
      const rows = await query(`SELECT id, hostname, type, ip_address, manager, user_team FROM assets WHERE is_active = true ORDER BY hostname LIMIT 200`)
      return NextResponse.json({ title: '전체 자산', rows })
    }
    case 'assets_no_manager': {
      const rows = await query(`SELECT id, hostname, type, ip_address FROM assets WHERE is_active = true AND (manager IS NULL OR manager = '') ORDER BY hostname LIMIT 200`)
      return NextResponse.json({ title: '담당자 미지정 자산', rows })
    }
    case 'assets_no_contract': {
      const rows = await query(`
        SELECT a.id, a.hostname, a.type, a.ip_address
        FROM assets a WHERE a.is_active = true
          AND NOT EXISTS (SELECT 1 FROM maintenance_contracts mc WHERE mc.asset_id = a.id AND mc.is_active = true)
        ORDER BY a.hostname LIMIT 200
      `)
      return NextResponse.json({ title: '유지보수 계약 미등록 자산', rows })
    }
    case 'assets_no_org': {
      const rows = await query(`SELECT id, hostname, type, ip_address FROM assets WHERE is_active = true AND org_id IS NULL ORDER BY hostname LIMIT 200`)
      return NextResponse.json({ title: '조직 미배정 자산', rows })
    }
    case 'incidents_all': {
      const rows = await query(`
        SELECT i.id, i.title, i.severity, i.status, i.opened_at,
          CASE WHEN i.resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (i.resolved_at - i.opened_at))::int / 60 END AS mttr_minutes
        FROM incidents i WHERE i.opened_at >= now() - interval '90 days' ORDER BY i.opened_at DESC LIMIT 200
      `)
      return NextResponse.json({ title: '장애 내역 (최근 90일)', rows })
    }
    case 'incidents_resolved': {
      const rows = await query(`
        SELECT i.id, i.title, i.severity, i.status, i.opened_at, i.resolved_at,
          EXTRACT(EPOCH FROM (i.resolved_at - i.opened_at))::int / 60 AS mttr_minutes
        FROM incidents i WHERE i.opened_at >= now() - interval '90 days' AND i.resolved_at IS NOT NULL ORDER BY i.resolved_at DESC LIMIT 200
      `)
      return NextResponse.json({ title: '해결된 장애', rows })
    }
    case 'incidents_open': {
      const rows = await query(`
        SELECT i.id, i.title, i.severity, i.status, i.opened_at
        FROM incidents i WHERE i.opened_at >= now() - interval '90 days' AND i.status != 'resolved' ORDER BY i.opened_at DESC LIMIT 200
      `)
      return NextResponse.json({ title: '미해결 장애', rows })
    }
    case 'users_admin': {
      const rows = await query(`SELECT id, username, display_name, role FROM users WHERE is_active = true AND role = 'admin' ORDER BY username`)
      return NextResponse.json({ title: '관리자 계정', rows })
    }
    case 'users_operator': {
      const rows = await query(`SELECT id, username, display_name, role FROM users WHERE is_active = true AND role = 'operator' ORDER BY username`)
      return NextResponse.json({ title: '운영자 계정', rows })
    }
    case 'users_readonly': {
      const rows = await query(`SELECT id, username, display_name, role FROM users WHERE is_active = true AND role = 'readonly' ORDER BY username`)
      return NextResponse.json({ title: '읽기전용 계정', rows })
    }
    case 'users_locked': {
      const rows = await query(`SELECT id, username, display_name, role, locked_until FROM users WHERE is_active = true AND locked_until IS NOT NULL AND locked_until > now() ORDER BY username`)
      return NextResponse.json({ title: '잠긴 계정', rows })
    }
    case 'servers_no_agent': {
      const rows = await query(`SELECT id, hostname, type, ip_address FROM assets WHERE is_active = true AND type = 'server' AND agent_version IS NULL ORDER BY hostname LIMIT 200`)
      return NextResponse.json({ title: 'Agent 미설치 서버', rows })
    }
    default:
      return NextResponse.json({ error: 'Unknown detail type' }, { status: 400 })
  }
}
