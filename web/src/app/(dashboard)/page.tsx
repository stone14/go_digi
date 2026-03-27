export const dynamic = 'force-dynamic'

import { query, queryOne } from '@/lib/db'
import Link from 'next/link'
import { Server, AlertTriangle, Clock, TrendingUp, Database, HardDrive,
         Network, Shield, Archive, Box } from 'lucide-react'

interface AssetCatRow {
  category: string
  node_type: string | null
  total: number
  online: number
  offline: number
}

interface SummaryStats {
  active_alerts: number
  critical_alerts: number
  expiring_contracts: number
}

async function getAssetCategories(): Promise<AssetCatRow[]> {
  return query(`
    SELECT
      CASE type
        WHEN 'server'   THEN 'server'
        WHEN 'network'  THEN 'network'
        WHEN 'security' THEN 'security'
        WHEN 'nas'      THEN 'storage'
        WHEN 'san'      THEN 'storage'
        WHEN 'das'      THEN 'storage'
        WHEN 'storage'  THEN 'storage'
        WHEN 'backup'   THEN 'backup'
        ELSE 'etc'
      END AS category,
      COALESCE(node_type, '') AS node_type,
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE status = 'online')         AS online,
      COUNT(*) FILTER (WHERE status IN ('offline','warning')) AS offline
    FROM assets
    WHERE is_active = true
    GROUP BY category, node_type
    ORDER BY category, node_type
  `)
}

async function getSummary(): Promise<SummaryStats> {
  const stats = await queryOne<SummaryStats>(`
    SELECT
      (SELECT COUNT(*) FROM alerts WHERE status = 'active')                                        AS active_alerts,
      (SELECT COUNT(*) FROM alerts WHERE status = 'active' AND severity = 'critical')              AS critical_alerts,
      (SELECT COUNT(*) FROM maintenance_contracts
       WHERE has_contract = true AND contract_end BETWEEN now() AND now() + interval '30 days')    AS expiring_contracts
  `)
  return stats ?? { active_alerts: 0, critical_alerts: 0, expiring_contracts: 0 }
}

async function getTopCpu() {
  return query(`
    SELECT a.id, a.name, a.ip_address::text, m.cpu_usage, m.mem_usage, a.status
    FROM assets a
    JOIN LATERAL (
      SELECT cpu_usage, mem_usage FROM metrics
      WHERE asset_id = a.id ORDER BY collected_at DESC LIMIT 1
    ) m ON true
    WHERE a.type = 'server' AND a.is_active = true
    ORDER BY m.cpu_usage DESC NULLS LAST
    LIMIT 10
  `)
}

async function getTopMem() {
  return query(`
    SELECT a.id, a.name, a.ip_address::text, m.cpu_usage, m.mem_usage, a.status
    FROM assets a
    JOIN LATERAL (
      SELECT cpu_usage, mem_usage FROM metrics
      WHERE asset_id = a.id ORDER BY collected_at DESC LIMIT 1
    ) m ON true
    WHERE a.type = 'server' AND a.is_active = true
    ORDER BY m.mem_usage DESC NULLS LAST
    LIMIT 10
  `)
}

async function getStorageCapacity() {
  return query(`
    SELECT
      a.id, a.name,
      COUNT(sv.id)                                 AS vol_count,
      COALESCE(SUM(sv.total_gb), 0)::numeric(12,1) AS total_gb,
      COALESCE(SUM(sv.used_gb),  0)::numeric(12,1) AS used_gb,
      CASE WHEN SUM(sv.total_gb) > 0
           THEN ROUND(SUM(sv.used_gb) / SUM(sv.total_gb) * 100, 1)
           ELSE 0 END AS used_pct
    FROM assets a
    LEFT JOIN storage_volumes sv ON sv.asset_id = a.id
    WHERE a.type IN ('nas','san','das','storage','backup') AND a.is_active = true
    GROUP BY a.id, a.name
    ORDER BY total_gb DESC
  `)
}

async function getRecentAlerts() {
  return query(`
    SELECT al.id, al.title, al.severity, al.status, al.fired_at,
           a.name AS asset_name
    FROM alerts al
    LEFT JOIN assets a ON a.id = al.asset_id
    ORDER BY al.fired_at DESC
    LIMIT 8
  `)
}

async function getExpiringContracts() {
  return query(`
    SELECT a.name, mc.contract_end::text, mc.contact_name,
           EXTRACT(day FROM mc.contract_end - now())::int AS days_left
    FROM maintenance_contracts mc
    JOIN assets a ON a.id = mc.asset_id
    WHERE mc.has_contract = true
      AND mc.contract_end BETWEEN now() AND now() + interval '30 days'
    ORDER BY mc.contract_end ASC
    LIMIT 5
  `)
}

// 카테고리 → 자산 타입 필터 매핑
const CAT_TYPE_FILTER: Record<string, string> = {
  'server-baremetal': 'server',
  'server-vm':        'server',
  'server-':          'server',
  'network':          'switch',
  'security':         'firewall',
  'storage':          'storage',
  'backup':           'server',
  'etc':              '',
}

// 카테고리 정의
const CAT_META: Record<string, { label: string; icon: React.ElementType; color: string; accent: string }> = {
  'server-baremetal': { label: '물리 서버',   icon: Server,  color: 'text-cyan-400',   accent: 'bg-cyan-500' },
  'server-vm':        { label: 'VM 서버',     icon: Box,     color: 'text-purple-400', accent: 'bg-purple-500' },
  'server-':          { label: '서버',        icon: Server,  color: 'text-cyan-400',   accent: 'bg-cyan-500' },
  'network':          { label: '네트워크',    icon: Network, color: 'text-blue-400',   accent: 'bg-blue-500' },
  'security':         { label: '보안',        icon: Shield,  color: 'text-orange-400', accent: 'bg-orange-500' },
  'storage':          { label: '스토리지',    icon: Database,color: 'text-green-400',  accent: 'bg-green-500' },
  'backup':           { label: '백업',        icon: Archive, color: 'text-yellow-400', accent: 'bg-yellow-500' },
  'etc':              { label: '기타',        icon: Box,     color: 'text-gray-400',   accent: 'bg-gray-500' },
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'badge-critical'
            : severity === 'warning'  ? 'badge-warning'
            : 'badge-ok'
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{severity.toUpperCase()}</span>
}

function UsageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-400' : 'bg-accent-cyan'
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 bg-[var(--c-hover)] rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-[var(--c-text)] w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  )
}

function fmtGB(gb: number) {
  return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(0)} GB`
}

// 카테고리 행을 카드 단위로 합산
function buildCatCards(rows: AssetCatRow[]) {
  const map = new Map<string, { label: string; icon: React.ElementType; color: string; accent: string; total: number; online: number; offline: number }>()

  for (const r of rows) {
    let key: string
    if (r.category === 'server') {
      key = r.node_type === 'baremetal' ? 'server-baremetal'
          : r.node_type === 'vm'        ? 'server-vm'
          : 'server-'
    } else {
      key = r.category
    }
    const meta = CAT_META[key] ?? CAT_META['etc']
    const prev = map.get(key) ?? { ...meta, total: 0, online: 0, offline: 0 }
    map.set(key, {
      ...prev,
      total:   prev.total   + Number(r.total),
      online:  prev.online  + Number(r.online),
      offline: prev.offline + Number(r.offline),
    })
  }

  // 없는 카테고리도 0으로 표시
  const always = ['server-baremetal','server-vm','network','security','backup','etc']
  for (const k of always) {
    if (!map.has(k)) map.set(k, { ...CAT_META[k], total: 0, online: 0, offline: 0 })
  }

  const order = ['server-baremetal','server-vm','network','security','storage','backup','etc']
  return order.map(k => ({ key: k, ...(map.get(k) ?? { ...CAT_META['etc'], total: 0, online: 0, offline: 0 }) }))
}

export default async function DashboardPage() {
  const [catRows, topCpu, topMem, storageCapacity, recentAlerts, expiring] = await Promise.all([
    getAssetCategories() as Promise<AssetCatRow[]>,
    getTopCpu(), getTopMem(), getStorageCapacity(), getRecentAlerts(), getExpiringContracts(),
  ])

  const catCards = buildCatCards(catRows)
  type Row = Record<string, unknown>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--c-text)]">대시보드</h1>
        <p className="text-sm text-[var(--c-faint)] mt-0.5">인프라 전체 현황</p>
      </div>

      {/* 장비 카테고리 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {catCards.map(({ key, label, icon: Icon, color, accent, total, online, offline }) => {
          const typeParam = CAT_TYPE_FILTER[key] ?? ''
          const href = typeParam ? `/assets?type=${typeParam}` : '/assets'
          return (
            <Link key={key} href={href} className="card p-4 flex flex-col gap-2 hover:bg-[var(--c-hover)] transition-colors cursor-pointer">
              <div className="flex items-center gap-1.5">
                <Icon size={13} className={color} />
                <span className="text-xs text-[var(--c-muted)] font-medium">{label}</span>
              </div>
              <p className={`text-3xl font-bold ${color}`}>{total}</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-green-400">▲ {online} 기동</span>
                <span className={offline > 0 ? 'text-red-400' : 'text-[var(--c-faint)]'}>▼ {offline} 중지</span>
              </div>
              {total > 0 && (
                <div className="w-full bg-[var(--c-border)] rounded-full h-1">
                  <div className={`h-1 rounded-full ${accent}`}
                    style={{ width: `${Math.round(online / total * 100)}%` }} />
                </div>
              )}
            </Link>
          )
        })}

      </div>

      {/* CPU TOP 10 + MEM TOP 10 + 최근 알림 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CPU TOP 10 */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--c-text)] mb-4 flex items-center gap-2">
            <TrendingUp size={15} className="text-accent-cyan" />
            CPU TOP 10
          </h2>
          <div className="space-y-2.5">
            {(topCpu as Row[]).map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-[var(--c-faint)] w-4 shrink-0">{i + 1}</span>
                <Link href={`/servers/${s.id}`} className="text-xs text-[var(--c-text)] w-24 truncate shrink-0 hover:text-cyan-400 transition-colors">{s.name as string}</Link>
                <UsageBar pct={Number(s.cpu_usage || 0)} />
              </div>
            ))}
            {topCpu.length === 0 && (
              <p className="text-sm text-[var(--c-faint)] text-center py-4">수집된 데이터 없음</p>
            )}
          </div>
        </div>

        {/* MEM TOP 10 */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--c-text)] mb-4 flex items-center gap-2">
            <Server size={15} className="text-purple-400" />
            메모리 TOP 10
          </h2>
          <div className="space-y-2.5">
            {(topMem as Row[]).map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-[var(--c-faint)] w-4 shrink-0">{i + 1}</span>
                <Link href={`/servers/${s.id}`} className="text-xs text-[var(--c-text)] w-24 truncate shrink-0 hover:text-cyan-400 transition-colors">{s.name as string}</Link>
                <UsageBar pct={Number(s.mem_usage || 0)} />
              </div>
            ))}
            {topMem.length === 0 && (
              <p className="text-sm text-[var(--c-faint)] text-center py-4">수집된 데이터 없음</p>
            )}
          </div>
        </div>

        {/* 최근 알림 */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--c-text)] mb-4 flex items-center gap-2">
            <AlertTriangle size={15} className="text-accent-orange" />
            최근 알림
          </h2>
          <div className="space-y-3">
            {(recentAlerts as Row[]).map((al) => (
              <Link key={al.id as number} href="/alerts" className="block border-b border-[var(--c-border)] pb-3 last:border-0 last:pb-0 hover:bg-[var(--c-hover)] -mx-1 px-1 rounded transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-[var(--c-text)] leading-snug">{al.title as string}</p>
                  <SeverityBadge severity={al.severity as string} />
                </div>
                <p className="text-xs text-[var(--c-faint)] mt-1">
                  {al.asset_name as string} · {new Date(al.fired_at as string).toLocaleString('ko-KR')}
                </p>
              </Link>
            ))}
            {recentAlerts.length === 0 && (
              <p className="text-sm text-[var(--c-faint)] text-center py-4">알림 없음</p>
            )}
          </div>
        </div>
      </div>

      {/* 스토리지 용량 */}
      {(storageCapacity as Row[]).length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--c-text)] mb-4 flex items-center gap-2">
            <Database size={15} className="text-accent-green" />
            스토리지 용량 현황
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(storageCapacity as Row[]).map((s, i) => {
              const total = Number(s.total_gb)
              const used  = Number(s.used_gb)
              const pct   = Number(s.used_pct)
              const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-400' : 'bg-accent-green'
              return (
                <div key={i} className="bg-[var(--c-hover)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <HardDrive size={14} className="text-accent-green shrink-0" />
                      <span className="text-sm font-medium text-[var(--c-text)]">{s.name as string}</span>
                    </div>
                    <span className="text-xs text-[var(--c-faint)] bg-[var(--c-border)] px-2 py-0.5 rounded">
                      {s.vol_count as number}개 볼륨
                    </span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-[var(--c-muted)] mb-1">
                      <span>{fmtGB(used)} 사용</span>
                      <span>{fmtGB(total)} 전체</span>
                    </div>
                    <div className="w-full bg-[var(--c-border)] rounded-full h-2">
                      <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[var(--c-faint)]">{fmtGB(total - used)} 여유</span>
                    <span className={`text-sm font-bold ${pct >= 90 ? 'text-red-400' : pct >= 75 ? 'text-orange-400' : 'text-accent-green'}`}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 유지보수 만료 임박 */}
      {expiring.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--c-text)] mb-4 flex items-center gap-2">
            <Clock size={15} className="text-accent-purple" />
            유지보수 계약 만료 임박 (30일 이내)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(expiring as Row[]).map((e, i) => (
              <div key={i} className="bg-[var(--c-hover)] rounded-lg p-3">
                <p className="text-sm font-medium text-[var(--c-text)]">{e.name as string}</p>
                <p className="text-xs text-[var(--c-muted)] mt-1">
                  만료: {(e.contract_end as string)?.slice(0, 10)} ({e.days_left as number}일 남음)
                </p>
                {typeof e.contact_name === 'string' && (
                  <p className="text-xs text-[var(--c-faint)] mt-0.5">담당: {e.contact_name}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
