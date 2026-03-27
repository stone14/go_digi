export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import Link from 'next/link'
import { Server } from 'lucide-react'

async function getServers() {
  return query(`
    SELECT
      a.id, a.name, a.hostname, a.ip_address::text,
      a.os, a.os_version, a.arch, a.status, a.last_seen,
      a.location, a.group_tag,
      m.cpu_usage, m.mem_usage, m.disk_usage_pct,
      m.net_rx_bps, m.net_tx_bps,
      mc.has_contract, mc.contract_end::text, mc.contact_name
    FROM assets a
    LEFT JOIN LATERAL (
      SELECT cpu_usage, mem_usage, disk_usage_pct, net_rx_bps, net_tx_bps
      FROM metrics WHERE asset_id = a.id
      ORDER BY collected_at DESC LIMIT 1
    ) m ON true
    LEFT JOIN maintenance_contracts mc ON mc.asset_id = a.id
    WHERE a.type = 'server' AND a.is_active = true
      AND (a.node_type IS NULL OR a.node_type = 'baremetal')
    ORDER BY a.status DESC, a.name ASC
  `)
}

function UsageBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(value ?? 0, 100)
  const barColor = pct > 90 ? 'bg-accent-red'
                : pct > 70 ? 'bg-accent-orange'
                : color
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[var(--c-hover)] rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-[var(--c-muted)] w-9 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

function formatBps(bps: number): string {
  if (!bps) return '0 B'
  if (bps > 1e9) return `${(bps / 1e9).toFixed(1)} Gb`
  if (bps > 1e6) return `${(bps / 1e6).toFixed(1)} Mb`
  if (bps > 1e3) return `${(bps / 1e3).toFixed(1)} Kb`
  return `${bps} B`
}

export default async function ServersPage() {
  const servers = await getServers() as Record<string, unknown>[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Server size={20} className="text-accent-cyan" />
            서버 모니터링
          </h1>
          <p className="text-sm text-[var(--c-faint)] mt-0.5">총 {servers.length}대</p>
        </div>
      </div>

      {/* 상태 요약 */}
      <div className="flex gap-4">
        {(['online','offline','warning','unknown'] as const).map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              s === 'online'  ? 'bg-accent-green' :
              s === 'offline' ? 'bg-accent-red'   :
              s === 'warning' ? 'bg-accent-orange' : 'bg-[var(--c-muted)]'
            }`} />
            <span className="text-xs text-[var(--c-muted)]">
              {s.charAt(0).toUpperCase() + s.slice(1)}: {servers.filter(sv => sv.status === s).length}
            </span>
          </div>
        ))}
      </div>

      {/* 서버 목록 테이블 */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide bg-[var(--c-hover)]">
              <th className="text-left px-4 py-3">상태</th>
              <th className="text-left px-4 py-3">서버명</th>
              <th className="text-left px-4 py-3">IP</th>
              <th className="text-left px-4 py-3">OS</th>
              <th className="text-left px-4 py-3 w-28">CPU</th>
              <th className="text-left px-4 py-3 w-28">MEM</th>
              <th className="text-left px-4 py-3 w-28">DISK</th>
              <th className="text-left px-4 py-3">네트워크</th>
              <th className="text-left px-4 py-3">유지보수</th>
              <th className="text-left px-4 py-3">최근 응답</th>
            </tr>
          </thead>
          <tbody>
            {servers.map(s => (
              <tr key={s.id as number}
                className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${
                      s.status === 'online'  ? 'bg-accent-green animate-pulse' :
                      s.status === 'offline' ? 'bg-accent-red' :
                      s.status === 'warning' ? 'bg-accent-orange' : 'bg-[var(--c-muted)]'
                    }`} />
                    <span className={`text-xs ${
                      s.status === 'online'  ? 'text-accent-green' :
                      s.status === 'offline' ? 'text-accent-red'   :
                      s.status === 'warning' ? 'text-accent-orange' : 'text-[var(--c-muted)]'
                    }`}>{s.status as string}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/servers/${s.id}`}
                    className="text-[var(--c-text)] hover:text-accent-cyan transition-colors font-medium">
                    {s.name as string}
                  </Link>
                  {typeof s.hostname === 'string' && s.hostname && (
                    <p className="text-xs text-[var(--c-faint)]">{s.hostname}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--c-muted)] font-mono text-xs">
                  {s.ip_address as string ?? '-'}
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-[var(--c-muted)]">{s.os as string ?? '-'}</p>
                  <p className="text-xs text-[var(--c-faint)]">{s.arch as string ?? ''}</p>
                </td>
                <td className="px-4 py-3">
                  {s.cpu_usage != null
                    ? <UsageBar value={Number(s.cpu_usage)} color="bg-accent-cyan" />
                    : <span className="text-xs text-[var(--c-faint)]">-</span>}
                </td>
                <td className="px-4 py-3">
                  {s.mem_usage != null
                    ? <UsageBar value={Number(s.mem_usage)} color="bg-accent-purple" />
                    : <span className="text-xs text-[var(--c-faint)]">-</span>}
                </td>
                <td className="px-4 py-3">
                  {s.disk_usage_pct != null
                    ? <UsageBar value={Number(s.disk_usage_pct)} color="bg-accent-orange" />
                    : <span className="text-xs text-[var(--c-faint)]">-</span>}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                  <p>↓ {formatBps(Number(s.net_rx_bps))}/s</p>
                  <p>↑ {formatBps(Number(s.net_tx_bps))}/s</p>
                </td>
                <td className="px-4 py-3">
                  {s.has_contract ? (
                    <div>
                      <span className="text-xs text-accent-green">계약중</span>
                      <p className="text-xs text-[var(--c-faint)]">{(s.contract_end as string)?.slice(0,10)}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--c-faint)]">없음</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                  {s.last_seen
                    ? new Date(s.last_seen as string).toLocaleString('ko-KR', {
                        month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
                      })
                    : '-'}
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-[var(--c-faint)]">
                등록된 서버가 없습니다
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
