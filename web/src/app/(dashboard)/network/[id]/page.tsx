'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, Network, RefreshCw, Search,
  Activity, CheckCircle, XCircle,
  Clock, Wifi, WifiOff, Filter
} from 'lucide-react'

interface Asset {
  id: number; name: string; hostname: string; ip_address: string
  asset_type: string; status: string; location: string
  manufacturer: string | null; model: string | null
  monitoring_enabled: boolean; last_seen: string | null
}

interface Port {
  id: number
  interface_name: string
  if_index: number | null
  link_status: string
  speed_mbps: number | null
  duplex: string | null
  vlan_id: number | null
  description: string | null
  last_change: string | null
  neighbor_label: string | null
  neighbor_port: string | null
}

interface SyslogEntry {
  id: number
  received_at: string
  severity: string
  facility: number | null
  hostname: string
  program: string | null
  message: string
  raw: string | null
}

const SEV_COLOR: Record<string, string> = {
  emergency: 'text-red-400',
  alert:     'text-red-400',
  critical:  'text-red-400',
  error:     'text-orange-400',
  warning:   'text-yellow-400',
  notice:    'text-blue-400',
  info:      'text-[var(--c-text)]',
  debug:     'text-[var(--c-faint)]',
}

const SEV_BG: Record<string, string> = {
  emergency: 'bg-red-400/10 border-red-400/30',
  alert:     'bg-red-400/10 border-red-400/30',
  critical:  'bg-red-400/10 border-red-400/30',
  error:     'bg-orange-400/10 border-orange-400/30',
  warning:   'bg-yellow-400/10 border-yellow-400/30',
  notice:    'bg-blue-400/10 border-blue-400/30',
  info:      'bg-transparent border-[var(--c-border)]',
  debug:     'bg-transparent border-[var(--c-border)]',
}

function PortCard({ port }: { port: Port }) {
  const isUp      = port.link_status === 'up'
  const isDown    = port.link_status === 'down'

  const bg    = isUp   ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/15'
              : isDown ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/15'
              :          'bg-[var(--c-hover)] border-[var(--c-border)]'
  const dot   = isUp   ? 'bg-green-400' : isDown ? 'bg-red-400' : 'bg-[var(--c-muted)]'
  const text  = isUp   ? 'text-green-400' : isDown ? 'text-red-400' : 'text-[var(--c-muted)]'

  return (
    <div className={`relative border rounded-lg p-2 transition-colors cursor-default group ${bg}`}>
      <div className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${dot} ${isUp ? 'animate-pulse' : ''}`} />
      <div className="text-xs font-mono text-[var(--c-text)] truncate pr-3 leading-tight">
        {port.interface_name.replace(/GigabitEthernet|TenGigabitEthernet|FastEthernet|Ethernet/g, m =>
          m === 'GigabitEthernet' ? 'Gi' : m === 'TenGigabitEthernet' ? 'Te' : m === 'FastEthernet' ? 'Fa' : 'Eth'
        )}
      </div>
      {port.speed_mbps && (
        <div className="text-[10px] text-[var(--c-faint)] mt-0.5">
          {port.speed_mbps >= 1000 ? `${port.speed_mbps / 1000}G` : `${port.speed_mbps}M`}
        </div>
      )}
      <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1
                      hidden group-hover:block
                      bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg p-2 text-xs
                      whitespace-nowrap shadow-xl pointer-events-none">
        <div className="font-mono text-[var(--c-text)]">{port.interface_name}</div>
        <div className={`font-medium mt-0.5 ${text}`}>{port.link_status.toUpperCase()}</div>
        {port.description && <div className="text-[var(--c-muted)] mt-0.5">{port.description}</div>}
        {port.vlan_id && <div className="text-[var(--c-muted)]">VLAN {port.vlan_id}</div>}
        {port.neighbor_label && (
          <div className="text-cyan-400 mt-0.5">
            ↔ {port.neighbor_label}
            {port.neighbor_port && ` / ${port.neighbor_port}`}
          </div>
        )}
        {port.last_change && (
          <div className="text-[var(--c-faint)] mt-0.5">
            변경: {new Date(port.last_change).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function NetworkDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [asset,  setAsset]  = useState<Asset | null>(null)
  const [ports,  setPorts]  = useState<Port[]>([])
  const [logs,   setLogs]   = useState<SyslogEntry[]>([])
  const [loadingPorts, setLoadingPorts] = useState(true)
  const [loadingLogs,  setLoadingLogs]  = useState(true)

  const [portFilter,  setPortFilter]  = useState<'all' | 'up' | 'down'>('all')
  const [logSearch,   setLogSearch]   = useState('')
  const [logSeverity, setLogSeverity] = useState('')

  const loadAsset = useCallback(async () => {
    const res = await fetch(`/api/assets?id=${id}`)
    const data = await res.json()
    if (data.asset) setAsset(data.asset)
  }, [id])

  const loadPorts = useCallback(async () => {
    setLoadingPorts(true)
    try {
      const res = await fetch(`/api/network/ports?asset_id=${id}`)
      const data = await res.json()
      setPorts(data.ports ?? [])
    } finally { setLoadingPorts(false) }
  }, [id])

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const params = new URLSearchParams({ asset_id: id, limit: '300' })
      if (logSeverity) params.set('severity', logSeverity)
      if (logSearch)   params.set('search', logSearch)
      const res = await fetch(`/api/network/syslog?${params}`)
      const data = await res.json()
      setLogs(data.logs ?? [])
    } finally { setLoadingLogs(false) }
  }, [id, logSeverity, logSearch])

  useEffect(() => { loadAsset() }, [loadAsset])
  useEffect(() => { loadPorts() }, [loadPorts])
  useEffect(() => { loadLogs() }, [loadLogs])

  const filteredPorts = ports.filter(p =>
    portFilter === 'all' ? true : p.link_status === portFilter
  )
  const upCount   = ports.filter(p => p.link_status === 'up').length
  const downCount = ports.filter(p => p.link_status === 'down').length
  const unknCount = ports.filter(p => p.link_status !== 'up' && p.link_status !== 'down').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/network" className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Network className="text-cyan-400" size={20} />
            {asset?.name ?? `Device #${id}`}
          </h1>
          <p className="text-[var(--c-muted)] text-sm">
            {asset?.ip_address} · {asset?.manufacturer ?? ''} {asset?.model ?? ''} · {asset?.location ?? ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {asset && (
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium
              ${asset.status === 'online'  ? 'bg-green-400/10 text-green-400'
              : asset.status === 'offline' ? 'bg-red-400/10 text-red-400'
              : 'bg-[var(--c-border)] text-[var(--c-muted)]'}`}>
              {asset.status === 'online'  ? <Wifi size={12} />
               : asset.status === 'offline' ? <WifiOff size={12} />
               : <Activity size={12} />}
              {asset.status}
            </span>
          )}
          <button
            onClick={() => { loadPorts(); loadLogs() }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm"
          >
            <RefreshCw size={14} className={(loadingPorts || loadingLogs) ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </div>

      {/* Port Status Section */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--c-text)] font-semibold flex items-center gap-2">
            <Activity size={16} className="text-cyan-400" />
            포트 링크 상태
            <span className="text-[var(--c-muted)] font-normal text-sm">({ports.length}개)</span>
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => setPortFilter('all')}
              className={`flex items-center gap-1 ${portFilter === 'all' ? 'text-[var(--c-text)]' : 'text-[var(--c-faint)] hover:text-[var(--c-muted)]'}`}>
              <span className="w-2 h-2 rounded-full bg-[var(--c-muted)]" />
              전체 {ports.length}
            </button>
            <button onClick={() => setPortFilter('up')}
              className={`flex items-center gap-1 ${portFilter === 'up' ? 'text-green-400' : 'text-[var(--c-faint)] hover:text-[var(--c-muted)]'}`}>
              <CheckCircle size={10} />
              UP {upCount}
            </button>
            <button onClick={() => setPortFilter('down')}
              className={`flex items-center gap-1 ${portFilter === 'down' ? 'text-red-400' : 'text-[var(--c-faint)] hover:text-[var(--c-muted)]'}`}>
              <XCircle size={10} />
              DOWN {downCount}
            </button>
            {unknCount > 0 && (
              <span className="flex items-center gap-1 text-[var(--c-faint)]">
                <Clock size={10} />
                UNKNOWN {unknCount}
              </span>
            )}
          </div>
        </div>

        {loadingPorts ? (
          <div className="flex items-center justify-center py-10 text-[var(--c-faint)]">
            <RefreshCw className="animate-spin mr-2" size={16} />
            포트 정보 로딩 중...
          </div>
        ) : filteredPorts.length === 0 ? (
          <div className="text-center py-10 text-[var(--c-faint)]">
            <Network size={32} className="mx-auto mb-2 opacity-30" />
            <p>포트 정보가 없습니다.</p>
            <p className="text-xs mt-1">Syslog 이벤트 수신 시 자동으로 등록됩니다.</p>
          </div>
        ) : (
          <div className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
            {filteredPorts.map(port => (
              <PortCard key={port.id} port={port} />
            ))}
          </div>
        )}
      </div>

      {/* Syslog Viewer */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--c-text)] font-semibold flex items-center gap-2">
            <Filter size={16} className="text-purple-400" />
            Syslog
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={logSeverity}
              onChange={e => setLogSeverity(e.target.value)}
              className="px-2 py-1.5 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-xs text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
            >
              <option value="">전체 레벨</option>
              <option value="emergency">Emergency</option>
              <option value="alert">Alert</option>
              <option value="critical">Critical</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="notice">Notice</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" size={12} />
              <input
                type="text"
                placeholder="메시지 검색..."
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-xs text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500 w-48"
              />
            </div>
          </div>
        </div>

        <div className="space-y-0.5 max-h-[480px] overflow-y-auto font-mono text-xs">
          {loadingLogs ? (
            <div className="flex items-center justify-center py-10 text-[var(--c-faint)]">
              <RefreshCw className="animate-spin mr-2" size={14} />
              로그 로딩 중...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-[var(--c-faint)]">
              수신된 Syslog 메시지가 없습니다
            </div>
          ) : (
            logs.map(log => (
              <div
                key={log.id}
                className={`flex gap-3 px-3 py-1.5 rounded border ${SEV_BG[log.severity] ?? 'bg-transparent border-[var(--c-border)]'}`}
              >
                <span className="text-[var(--c-faint)] shrink-0 w-32">
                  {new Date(log.received_at).toLocaleString('ko-KR', {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </span>
                <span className={`shrink-0 w-16 uppercase font-bold ${SEV_COLOR[log.severity] ?? 'text-[var(--c-muted)]'}`}>
                  {log.severity}
                </span>
                {log.program && (
                  <span className="text-purple-400 shrink-0 max-w-[100px] truncate">
                    {log.program}
                  </span>
                )}
                <span className="text-[var(--c-text)] break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
