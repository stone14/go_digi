import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/virtual?topology=1  → 토폴로지용 호스트+VM
// GET /api/virtual?host_id=N   → 특정 호스트의 VM 목록
// GET /api/virtual              → 전체 현황 요약
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)

  // 토폴로지용 데이터
  if (searchParams.get('topology')) {
    const hosts = await query<{
      id: number; platform: string; hostname: string | null
      ip_address: string | null; version: string | null
      cpu_total: number | null; mem_total_gb: number | null
      vm_count: number; status: string
      asset_name: string | null
    }>(
      `SELECT vh.id, vh.platform, vh.hostname, vh.ip_address::text,
              vh.version, vh.cpu_total, vh.mem_total_gb, vh.vm_count, vh.status,
              a.name AS asset_name
       FROM virtual_hosts vh
       LEFT JOIN assets a ON a.id = vh.asset_id
       ORDER BY vh.platform, vh.hostname`
    )

    const vms = await query<{
      id: number; host_id: number; vm_name: string; guest_os: string | null
      cpu_count: number | null; mem_mb: number | null; disk_gb: number | null
      power_state: string; ip_address: string | null
      cpu_usage_pct: number | null; mem_usage_pct: number | null
    }>(
      `SELECT id, host_id, vm_name, guest_os, cpu_count, mem_mb, disk_gb,
              power_state, ip_address::text, cpu_usage_pct, mem_usage_pct
       FROM virtual_machines
       ORDER BY host_id, vm_name`
    )

    return NextResponse.json({ hosts, vms })
  }

  // 특정 호스트의 VM
  const hostId = searchParams.get('host_id')
  if (hostId) {
    const host = await queryOne<Record<string, unknown>>(
      `SELECT vh.*, vh.ip_address::text AS ip_address, a.name AS asset_name
       FROM virtual_hosts vh LEFT JOIN assets a ON a.id = vh.asset_id
       WHERE vh.id = $1`, [hostId]
    )
    const vms = await query<Record<string, unknown>>(
      `SELECT *, ip_address::text AS ip_address FROM virtual_machines
       WHERE host_id = $1 ORDER BY vm_name`, [hostId]
    )
    return NextResponse.json({ host, vms })
  }

  // 전체 요약
  const summary = await queryOne<{
    host_count: number; vm_count: number
    running: number; stopped: number
  }>(
    `SELECT
       COUNT(DISTINCT vh.id)::int AS host_count,
       COUNT(vm.id)::int          AS vm_count,
       COUNT(vm.id) FILTER (WHERE vm.power_state = 'running')::int AS running,
       COUNT(vm.id) FILTER (WHERE vm.power_state = 'stopped')::int AS stopped
     FROM virtual_hosts vh
     LEFT JOIN virtual_machines vm ON vm.host_id = vh.id`
  )
  const hosts = await query<Record<string, unknown>>(
    `SELECT vh.id, vh.platform, vh.hostname, vh.ip_address::text,
            vh.version, vh.cpu_total, vh.mem_total_gb, vh.vm_count, vh.status,
            a.name AS asset_name,
            COUNT(vm.id)::int AS actual_vm_count,
            COUNT(vm.id) FILTER (WHERE vm.power_state='running')::int AS running_vms
     FROM virtual_hosts vh
     LEFT JOIN assets a ON a.id = vh.asset_id
     LEFT JOIN virtual_machines vm ON vm.host_id = vh.id
     GROUP BY vh.id, a.name
     ORDER BY vh.platform, vh.hostname`
  )
  return NextResponse.json({ summary, hosts })
}

// POST /api/virtual — 호스트 또는 VM 등록
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.type === 'host') {
    const { platform, hostname, ip_address, version, cpu_total, mem_total_gb, asset_id } = body
    const row = await queryOne<{ id: number }>(
      `INSERT INTO virtual_hosts (platform, hostname, ip_address, version, cpu_total, mem_total_gb, asset_id)
       VALUES ($1, $2, $3::inet, $4, $5, $6, $7) RETURNING id`,
      [platform || 'vmware', hostname || null, ip_address || null,
       version || null, cpu_total || null, mem_total_gb || null, asset_id || null]
    )
    return NextResponse.json({ id: row!.id }, { status: 201 })
  }

  if (body.type === 'vm') {
    const { host_id, vm_name, guest_os, cpu_count, mem_mb, disk_gb, power_state, ip_address } = body
    const row = await queryOne<{ id: number }>(
      `INSERT INTO virtual_machines (host_id, vm_name, guest_os, cpu_count, mem_mb, disk_gb, power_state, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet) RETURNING id`,
      [host_id, vm_name, guest_os || null, cpu_count || null, mem_mb || null,
       disk_gb || null, power_state || 'running', ip_address || null]
    )
    return NextResponse.json({ id: row!.id }, { status: 201 })
  }

  return NextResponse.json({ error: 'type required (host|vm)' }, { status: 400 })
}

// PUT /api/virtual — VM 상태 업데이트 (에이전트용)
export async function PUT(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.vm_id) {
    await execute(
      `UPDATE virtual_machines
       SET power_state=$2, cpu_usage_pct=$3, mem_usage_pct=$4, updated_at=now()
       WHERE id=$1`,
      [body.vm_id, body.power_state, body.cpu_usage_pct ?? null, body.mem_usage_pct ?? null]
    )
  } else if (body.host_id) {
    await execute(
      `UPDATE virtual_hosts SET vm_count=$2, status=$3, last_seen=now(), updated_at=now()
       WHERE id=$1`,
      [body.host_id, body.vm_count ?? 0, body.status ?? 'online']
    )
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/virtual?vm_id=N or ?host_id=N
export async function DELETE(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  if (searchParams.get('vm_id')) {
    await execute(`DELETE FROM virtual_machines WHERE id=$1`, [searchParams.get('vm_id')])
  } else if (searchParams.get('host_id')) {
    await execute(`DELETE FROM virtual_hosts WHERE id=$1`, [searchParams.get('host_id')])
  }
  return NextResponse.json({ ok: true })
}
