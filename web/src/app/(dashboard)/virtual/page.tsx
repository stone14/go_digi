'use client'

import { useEffect, useState } from 'react'
import { Cpu, Server, RefreshCw, ChevronDown, ChevronRight, Monitor, HardDrive } from 'lucide-react'
import Link from 'next/link'

interface VirtualHost {
  id: number
  platform: string
  hostname: string | null
  ip_address: string | null
  version: string | null
  cpu_total: number | null
  mem_total_gb: number | null
  vm_count: number
  status: string
  asset_name: string | null
  actual_vm_count: number
  running_vms: number
}

interface VirtualMachine {
  id: number
  host_id: number
  vm_name: string
  guest_os: string | null
  cpu_count: number | null
  mem_mb: number | null
  disk_gb: number | null
  power_state: string
  ip_address: string | null
  cpu_usage_pct: number | null
  mem_usage_pct: number | null
}

interface Summary {
  host_count: number
  vm_count: number
  running: number
  stopped: number
}

interface AgentVM {
  id: number
  hostname: string
  ip_address: string | null
  os: string | null
  status: string
  cpu_usage: number | null
  mem_usage: number | null
  disk_usage_pct: number | null
  last_seen: string | null
}

function UsageBar({ value, warn = 70, crit = 90 }: { value: number | null; warn?: number; crit?: number }) {
  const pct = Math.min(Number(value) || 0, 100)
  const color = pct >= crit ? 'bg-red-500' : pct >= warn ? 'bg-orange-400' : 'bg-cyan-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[var(--c-border)] rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-[var(--c-muted)] w-9 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

function PowerBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    running: 'bg-green-500/20 text-green-400 border-green-500/30',
    stopped: 'bg-red-500/20 text-red-400 border-red-500/30',
    suspended: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    unknown: 'bg-[var(--c-hover)] text-[var(--c-muted)] border-[var(--c-border)]',
  }
  const label: Record<string, string> = { running: '실행 중', stopped: '중지', suspended: '일시정지', unknown: '알 수 없음' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${map[state] ?? map.unknown}`}>
      {label[state] ?? state}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = platform === 'vmware' ? 'text-blue-400' : platform === 'proxmox' ? 'text-orange-400' : 'text-[var(--c-muted)]'
  return <span className={`text-xs font-medium uppercase ${color}`}>{platform}</span>
}

function HostCard({ host, vms }: { host: VirtualHost; vms: VirtualMachine[] }) {
  const [open, setOpen] = useState(true)
  const hostVms = vms.filter(v => v.host_id === host.id)

  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
      {/* 호스트 헤더 */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--c-hover)] transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown size={16} className="text-[var(--c-muted)]" /> : <ChevronRight size={16} className="text-[var(--c-muted)]" />}
          <Server size={16} className="text-cyan-400" />
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--c-text)]">{host.asset_name ?? host.hostname ?? `Host-${host.id}`}</span>
              <PlatformBadge platform={host.platform} />
              <span className={`w-2 h-2 rounded-full ${host.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`} />
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {host.hostname && <span className="text-xs text-[var(--c-muted)]">{host.hostname}</span>}
              {host.ip_address && <span className="text-xs text-[var(--c-muted)] font-mono">{host.ip_address?.split('/')[0]}</span>}
              {host.version && <span className="text-xs text-[var(--c-faint)]">{host.version}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <p className="text-xs text-[var(--c-muted)]">CPU</p>
            <p className="text-sm text-[var(--c-text)]">{host.cpu_total ?? '-'} Core</p>
          </div>
          <div>
            <p className="text-xs text-[var(--c-muted)]">메모리</p>
            <p className="text-sm text-[var(--c-text)]">{host.mem_total_gb ?? '-'} GB</p>
          </div>
          <div>
            <p className="text-xs text-[var(--c-muted)]">VM</p>
            <p className="text-sm text-[var(--c-text)]">
              <span className="text-green-400">{host.running_vms}</span>
              <span className="text-[var(--c-faint)]"> / {host.actual_vm_count}</span>
            </p>
          </div>
        </div>
      </button>

      {/* VM 목록 */}
      {open && hostVms.length > 0 && (
        <div className="border-t border-[var(--c-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-[var(--c-muted)] font-semibold uppercase tracking-wide border-b border-[var(--c-border)] bg-[var(--c-hover)]">
                <th className="text-left px-5 py-2.5 pl-12">VM 이름</th>
                <th className="text-left px-4 py-2.5">Guest OS</th>
                <th className="text-left px-4 py-2.5">IP</th>
                <th className="text-center px-4 py-2.5">vCPU</th>
                <th className="text-center px-4 py-2.5">메모리</th>
                <th className="text-center px-4 py-2.5">디스크</th>
                <th className="px-4 py-2.5 w-36">CPU 사용률</th>
                <th className="px-4 py-2.5 w-36">메모리 사용률</th>
                <th className="text-center px-4 py-2.5">상태</th>
              </tr>
            </thead>
            <tbody>
              {hostVms.map(vm => (
                <tr key={vm.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                  <td className="px-5 py-3 pl-12">
                    <div className="flex items-center gap-2">
                      <Monitor size={13} className="text-[var(--c-muted)] shrink-0" />
                      <span className="text-[var(--c-text)] font-medium">{vm.vm_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{vm.guest_os ?? '-'}</td>
                  <td className="px-4 py-3 text-[var(--c-muted)] font-mono text-xs">{vm.ip_address?.split('/')[0] ?? '-'}</td>
                  <td className="px-4 py-3 text-center text-[var(--c-text)]">{vm.cpu_count ?? '-'}</td>
                  <td className="px-4 py-3 text-center text-[var(--c-text)]">
                    {vm.mem_mb ? `${(vm.mem_mb / 1024).toFixed(0)} GB` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center text-[var(--c-text)]">
                    <div className="flex items-center justify-center gap-1">
                      <HardDrive size={11} className="text-[var(--c-muted)]" />
                      {vm.disk_gb ? `${vm.disk_gb} GB` : '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {vm.power_state === 'running'
                      ? <UsageBar value={vm.cpu_usage_pct} />
                      : <span className="text-xs text-[var(--c-faint)]">-</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {vm.power_state === 'running'
                      ? <UsageBar value={vm.mem_usage_pct} />
                      : <span className="text-xs text-[var(--c-faint)]">-</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-center">
                    <PowerBadge state={vm.power_state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && hostVms.length === 0 && (
        <div className="py-8 text-center text-[var(--c-faint)] text-sm border-t border-[var(--c-border)]">
          등록된 VM이 없습니다
        </div>
      )}
    </div>
  )
}

export default function VirtualPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [hosts, setHosts] = useState<VirtualHost[]>([])
  const [vms, setVms] = useState<VirtualMachine[]>([])
  const [agentVMs, setAgentVMs] = useState<AgentVM[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [summaryRes, topoRes, agentRes] = await Promise.all([
        fetch('/api/virtual'),
        fetch('/api/virtual?topology=1'),
        fetch('/api/agent/pull/vms'),
      ])
      const summaryData = await summaryRes.json()
      const topoData    = await topoRes.json()
      const agentData   = agentRes.ok ? await agentRes.json() : []
      setSummary(summaryData.summary)
      setHosts(summaryData.hosts)
      setVms(topoData.vms)
      setAgentVMs(agentData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const agentOnline  = agentVMs.filter(v => v.status === 'online').length
  const agentOffline = agentVMs.length - agentOnline

  const stats = [
    { label: '하이퍼바이저',  value: summary?.host_count ?? 0,                           color: 'text-[var(--c-text)]' },
    { label: '에이전트 VM',   value: agentVMs.length,                                    color: 'text-[var(--c-text)]' },
    { label: '온라인',        value: (summary?.running ?? 0) + agentOnline,              color: 'text-green-400' },
    { label: '오프라인',      value: (summary?.stopped ?? 0) + agentOffline,             color: 'text-red-400' },
  ]

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Cpu size={20} className="text-cyan-400" />
            가상화 모니터링
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">하이퍼바이저 및 VM 현황</p>
        </div>
        <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl px-5 py-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 호스트별 VM 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--c-muted)]">
          <RefreshCw size={20} className="animate-spin mr-2" /> 로딩 중...
        </div>
      ) : hosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--c-faint)]">
          <Cpu size={40} className="mb-3 opacity-30" />
          <p className="text-sm">가상화 호스트가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-4">
          {hosts.map(host => (
            <HostCard key={host.id} host={host} vms={vms} />
          ))}
        </div>
      )}

      {/* Pull Agent VM 서버 */}
      {agentVMs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--c-muted)] uppercase tracking-wide mb-3 flex items-center gap-2">
            <Server size={14} /> 에이전트 VM 서버
          </h2>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-[var(--c-muted)] font-semibold uppercase tracking-wide border-b border-[var(--c-border)] bg-[var(--c-hover)]">
                  <th className="text-left px-5 py-2.5">호스트명</th>
                  <th className="text-left px-4 py-2.5">IP</th>
                  <th className="text-left px-4 py-2.5">OS</th>
                  <th className="px-4 py-2.5 w-32">CPU</th>
                  <th className="px-4 py-2.5 w-32">메모리</th>
                  <th className="px-4 py-2.5 w-32">디스크</th>
                  <th className="text-center px-4 py-2.5">상태</th>
                </tr>
              </thead>
              <tbody>
                {agentVMs.map(vm => (
                  <tr key={vm.id} className="border-b border-[var(--c-border)] last:border-0 hover:bg-[var(--c-hover)] transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/servers/${vm.id}`} className="flex items-center gap-2 hover:text-cyan-400 transition-colors">
                        <Monitor size={13} className="text-[var(--c-muted)] shrink-0" />
                        <span className="text-[var(--c-text)] font-medium">{vm.hostname}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--c-muted)] font-mono text-xs">{vm.ip_address ?? '-'}</td>
                    <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{vm.os ?? '-'}</td>
                    <td className="px-4 py-3"><UsageBar value={vm.cpu_usage} /></td>
                    <td className="px-4 py-3"><UsageBar value={vm.mem_usage} /></td>
                    <td className="px-4 py-3"><UsageBar value={vm.disk_usage_pct} /></td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${vm.status === 'online' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                        {vm.status === 'online' ? '온라인' : '오프라인'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
