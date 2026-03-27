'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, Server, RefreshCw, Search,
  Cpu, HardDrive, Network, MemoryStick,
  Activity, Thermometer, Zap, Filter, Package2,
} from 'lucide-react'
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts'

interface Asset {
  id: number; name: string; hostname: string; ip_address: string
  asset_type: string; status: string; os_type: string; location: string
  manufacturer: string | null; model: string | null
  last_seen: string | null; bmc_enabled: boolean
}

interface MetricPoint {
  ts: string
  cpu_pct: number | null
  mem_pct: number | null
  disk_read_bps: number | null
  disk_write_bps: number | null
  net_rx_bps: number | null
  net_tx_bps: number | null
}

interface ServiceCheck {
  id: number; name: string; type: string; target: string
  status: string; response_ms: number | null; checked_at: string | null
}

interface BmcMetric {
  collected_at: string
  power_watts: number | null
  cpu1_temp_c: number | null; cpu2_temp_c: number | null
  inlet_temp_c: number | null; outlet_temp_c: number | null
  overall_health: string | null
}

interface HwHealth {
  component: string; name: string; status: string; checked_at: string
}

interface LogEntry {
  id: number; collected_at: string; level: string; source: string; message: string
}

interface DiskMount {
  mount_point: string; device: string | null; filesystem: string | null
  total_gb: number | null; used_gb: number | null; collected_at: string
}

interface SWInstall {
  id: number; software_name: string; software_version: string | null
  vendor: string; license_count: number | null; end_date: string | null
  install_notes: string | null
}

function fmtBytes(bps: number | string | null) {
  if (bps == null) return '—'
  const n = typeof bps === 'string' ? parseFloat(bps) : bps
  if (isNaN(n)) return '—'
  if (n < 1024) return `${n.toFixed(0)} B/s`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`
  return `${(n / 1024 / 1024).toFixed(1)} MB/s`
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

const CHART_STYLE = {
  cartesianGrid: { strokeDasharray: '3 3', stroke: 'var(--c-border)' },
  tooltip: { contentStyle: { background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12 } },
}

function MetricChart({
  data, dataKey, label, color, formatter,
}: {
  data: MetricPoint[]
  dataKey: keyof MetricPoint
  label: string
  color: string
  formatter?: (v: number) => string
}) {
  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
      <p className="text-[var(--c-muted)] text-xs mb-3">{label}</p>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey as string}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid {...CHART_STYLE.cartesianGrid} />
          <XAxis dataKey="ts" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: 'var(--c-faint)' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: 'var(--c-faint)' }} tickFormatter={formatter} />
          <Tooltip
            {...CHART_STYLE.tooltip}
            labelFormatter={v => new Date(v as string).toLocaleTimeString('ko-KR')}
            formatter={(v) => { const n = Number(v); return [formatter ? formatter(n) : `${n.toFixed(1)}%`, label] }}
          />
          <Area
            type="monotone"
            dataKey={dataKey as string}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${dataKey as string})`}
            dot={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok: 'bg-green-400', critical: 'bg-red-400',
    warning: 'bg-orange-400', unknown: 'bg-[var(--c-muted)]',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status] ?? 'bg-[var(--c-muted)]'}`} />
}

const LOG_COLOR: Record<string, string> = {
  error: 'text-red-400', warn: 'text-yellow-400', warning: 'text-yellow-400',
  info: 'text-[var(--c-text)]', debug: 'text-[var(--c-faint)]',
}

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [asset,    setAsset]    = useState<Asset | null>(null)
  const [metrics,  setMetrics]  = useState<MetricPoint[]>([])
  const [checks,   setChecks]   = useState<ServiceCheck[]>([])
  const [bmc,      setBmc]      = useState<BmcMetric | null>(null)
  const [hw,       setHw]       = useState<HwHealth[]>([])
  const [logs,     setLogs]     = useState<LogEntry[]>([])
  const [disks,    setDisks]    = useState<DiskMount[]>([])
  const [swList,   setSwList]   = useState<SWInstall[]>([])

  const [range,    setRange]    = useState('1h')
  const [logSearch, setLogSearch] = useState('')
  const [logLevel,  setLogLevel]  = useState('')

  const [loadingMetrics, setLoadingMetrics] = useState(true)
  const [loadingChecks,  setLoadingChecks]  = useState(true)
  const [loadingLogs,    setLoadingLogs]    = useState(true)

  const loadAsset = useCallback(async () => {
    const res  = await fetch(`/api/assets?id=${id}`)
    const data = await res.json()
    if (data.asset) setAsset(data.asset)
  }, [id])

  const loadMetrics = useCallback(async () => {
    setLoadingMetrics(true)
    try {
      const res  = await fetch(`/api/metrics?asset_id=${id}&range=${range}`)
      const data = await res.json()
      setMetrics(data.metrics ?? [])
    } finally { setLoadingMetrics(false) }
  }, [id, range])

  const loadChecks = useCallback(async () => {
    setLoadingChecks(true)
    try {
      const res  = await fetch(`/api/service-checks?asset_id=${id}`)
      const data = await res.json()
      setChecks(data.checks ?? [])
    } finally { setLoadingChecks(false) }
  }, [id])

  const loadBmc = useCallback(async () => {
    const res  = await fetch(`/api/bmc/latest?asset_id=${id}`)
    const data = await res.json()
    if (data.metric) setBmc(data.metric)
    if (data.hw)     setHw(data.hw)
  }, [id])

  const loadDisks = useCallback(async () => {
    const res  = await fetch(`/api/disk-metrics?asset_id=${id}`)
    const data = await res.json()
    setDisks(data.disks ?? [])
  }, [id])

  const loadSW = useCallback(async () => {
    const res  = await fetch(`/api/assets/software-installations?asset_id=${id}`)
    const data = await res.json()
    setSwList(data.installations ?? [])
  }, [id])

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const params = new URLSearchParams({ asset_id: id, limit: '300' })
      if (logLevel)  params.set('level', logLevel)
      if (logSearch) params.set('search', logSearch)
      const res  = await fetch(`/api/server-logs?${params}`)
      const data = await res.json()
      setLogs(data.logs ?? [])
    } finally { setLoadingLogs(false) }
  }, [id, logLevel, logSearch])

  useEffect(() => { loadAsset() }, [loadAsset])
  useEffect(() => { loadMetrics() }, [loadMetrics])
  useEffect(() => { loadChecks() }, [loadChecks])
  useEffect(() => { loadBmc() }, [loadBmc])
  useEffect(() => { loadLogs() }, [loadLogs])
  useEffect(() => { loadDisks() }, [loadDisks])
  useEffect(() => { loadSW() }, [loadSW])

  const latest = metrics[metrics.length - 1]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/servers" className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Server className="text-cyan-400" size={20} />
            {asset?.name ?? `Server #${id}`}
          </h1>
          <p className="text-[var(--c-muted)] text-sm">
            {asset?.ip_address} · {asset?.hostname} · {asset?.os_type} · {asset?.location}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {asset && (
            <span className={`px-3 py-1 rounded-full text-sm font-medium
              ${asset.status === 'online'  ? 'bg-green-400/10 text-green-400'
              : asset.status === 'offline' ? 'bg-red-400/10 text-red-400'
              : 'bg-[var(--c-border)] text-[var(--c-muted)]'}`}>
              {asset.status}
            </span>
          )}
          <button
            onClick={() => { loadMetrics(); loadChecks(); loadLogs(); loadBmc() }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm"
          >
            <RefreshCw size={14} className={loadingMetrics ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </div>

      {/* Snapshot Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: <Cpu size={16} className="text-cyan-400" />,    label: 'CPU',         value: latest?.cpu_pct    != null ? `${latest.cpu_pct.toFixed(1)}%`    : '—', color: 'text-cyan-400'   },
          { icon: <MemoryStick size={16} className="text-purple-400" />, label: '메모리', value: latest?.mem_pct   != null ? `${latest.mem_pct.toFixed(1)}%`    : '—', color: 'text-purple-400' },
          { icon: <HardDrive size={16} className="text-orange-400" />,  label: '디스크 쓰기', value: fmtBytes(latest?.disk_write_bps ?? null), color: 'text-orange-400' },
          { icon: <Network size={16} className="text-green-400" />,     label: '네트워크 RX', value: fmtBytes(latest?.net_rx_bps ?? null),   color: 'text-green-400'  },
        ].map(c => (
          <div key={c.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">{c.icon}<span className="text-[var(--c-muted)] text-xs">{c.label}</span></div>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-2">
        {['30m','1h','6h','24h','7d'].map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-3 py-1 rounded-lg text-sm transition-colors
              ${range === r ? 'bg-cyan-600 text-white' : 'bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Metric Charts */}
      <div className="grid grid-cols-2 gap-4">
        <MetricChart data={metrics} dataKey="cpu_pct"        label="CPU 사용률 (%)"         color="#00d4ff" formatter={v => `${v.toFixed(0)}%`} />
        <MetricChart data={metrics} dataKey="mem_pct"        label="메모리 사용률 (%)"       color="#a855f7" formatter={v => `${v.toFixed(0)}%`} />
        <MetricChart data={metrics} dataKey="disk_write_bps" label="디스크 쓰기 (Bytes/s)"  color="#f59e0b" formatter={v => fmtBytes(v)} />
        <MetricChart data={metrics} dataKey="net_rx_bps"     label="네트워크 수신 (Bytes/s)" color="#00ff88" formatter={v => fmtBytes(v)} />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Service Checks */}
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
          <h3 className="text-[var(--c-text)] font-semibold text-sm mb-3 flex items-center gap-2">
            <Activity size={14} className="text-cyan-400" />
            서비스 체크
          </h3>
          {loadingChecks ? (
            <p className="text-[var(--c-faint)] text-xs">로딩 중...</p>
          ) : checks.length === 0 ? (
            <p className="text-[var(--c-faint)] text-xs">등록된 체크 없음</p>
          ) : (
            <div className="space-y-2">
              {checks.map(c => (
                <div key={c.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot status={c.status} />
                    <div>
                      <p className="text-[var(--c-text)] text-xs font-medium">{c.name}</p>
                      <p className="text-[var(--c-faint)] text-[10px]">{c.type.toUpperCase()} {c.target}</p>
                    </div>
                  </div>
                  <span className="text-[var(--c-muted)] text-[10px]">
                    {c.response_ms != null ? `${c.response_ms}ms` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* BMC / Hardware Health — 물리 서버만 표시 */}
        {asset?.bmc_enabled && (
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
          <h3 className="text-[var(--c-text)] font-semibold text-sm mb-3 flex items-center gap-2">
            <Thermometer size={14} className="text-orange-400" />
            하드웨어 상태 (BMC)
          </h3>
          {!bmc ? (
            <p className="text-[var(--c-faint)] text-xs">수집 데이터 없음</p>
          ) : (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--c-muted)] flex items-center gap-1"><Thermometer size={10} />CPU1 온도</span>
                <span className="text-orange-400">{bmc.cpu1_temp_c != null ? `${bmc.cpu1_temp_c}°C` : '—'}</span>
              </div>
              {bmc.cpu2_temp_c != null && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--c-muted)]">CPU2 온도</span>
                  <span className="text-orange-400">{bmc.cpu2_temp_c}°C</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[var(--c-muted)]">흡기 온도</span>
                <span className="text-blue-400">{bmc.inlet_temp_c != null ? `${bmc.inlet_temp_c}°C` : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--c-muted)] flex items-center gap-1"><Zap size={10} />전력 소비</span>
                <span className="text-yellow-400">{bmc.power_watts != null ? `${bmc.power_watts}W` : '—'}</span>
              </div>
              <div className="border-t border-[var(--c-border)] pt-1.5 mt-1.5 space-y-1">
                {hw.map((h, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[var(--c-muted)]">{h.name}</span>
                    <span className={`font-medium ${
                      h.status === 'ok'       ? 'text-green-400'
                      : h.status === 'critical' ? 'text-red-400'
                      : h.status === 'warning'  ? 'text-yellow-400'
                      : 'text-[var(--c-muted)]'}`}>
                      {h.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Disk Filesystem Usage */}
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
          <h3 className="text-[var(--c-text)] font-semibold text-sm mb-3 flex items-center gap-2">
            <HardDrive size={14} className="text-purple-400" />
            파일시스템
          </h3>
          {disks.length === 0 ? (
            <p className="text-[var(--c-faint)] text-xs">수집된 디스크 데이터 없음</p>
          ) : (
            <div className="space-y-2.5">
              {disks.map(d => {
                const total = Number(d.total_gb) || 0
                const used  = Number(d.used_gb)  || 0
                const pct   = total ? Math.round((used / total) * 100) : 0
                const bar   = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-purple-500'
                return (
                  <div key={d.mount_point}>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[var(--c-text)] font-mono">{d.mount_point}</span>
                      <span className="text-[var(--c-muted)]">{total ? used.toFixed(0) : '—'} / {total ? total.toFixed(0) : '—'} GB ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-[var(--c-border)] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    {d.filesystem && <p className="text-[10px] text-[var(--c-faint)] mt-0.5">{d.filesystem}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 설치된 소프트웨어 */}
      {swList.length > 0 && (
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
          <h2 className="text-[var(--c-text)] font-semibold flex items-center gap-2 mb-4">
            <Package2 size={16} className="text-purple-400" />
            설치된 소프트웨어
            <span className="text-xs text-[var(--c-faint)] font-normal ml-1">{swList.length}개</span>
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {swList.map(sw => {
              const days = sw.end_date ? Math.ceil((new Date(sw.end_date).getTime() - Date.now()) / 86400000) : null
              const expiry = days === null ? null
                : days < 0 ? 'expired'
                : days <= 90 ? 'warning'
                : 'ok'
              return (
                <div key={sw.id}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)]/50">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Package2 size={14} className="text-purple-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--c-text)] truncate">{sw.software_name}</p>
                    <p className="text-[10px] text-[var(--c-muted)]">
                      {sw.vendor}{sw.software_version ? ` · v${sw.software_version}` : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {sw.license_count && (
                        <span className="text-[10px] text-cyan-400">라이선스 {sw.license_count}</span>
                      )}
                      {expiry === 'expired' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400">만료</span>
                      )}
                      {expiry === 'warning' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-400/10 text-yellow-400">{days}일 남음</span>
                      )}
                      {sw.install_notes && (
                        <span className="text-[10px] text-[var(--c-faint)] truncate">{sw.install_notes}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Server Log Viewer */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--c-text)] font-semibold flex items-center gap-2">
            <Filter size={16} className="text-green-400" />
            서버 로그
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={logLevel}
              onChange={e => setLogLevel(e.target.value)}
              className="px-2 py-1.5 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-xs text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
            >
              <option value="">전체 레벨</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
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

        <div className="font-mono text-xs space-y-0.5 max-h-64 overflow-y-auto">
          {loadingLogs ? (
            <div className="text-center py-6 text-[var(--c-faint)]">
              <RefreshCw className="inline animate-spin mr-2" size={12} />로딩 중...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-6 text-[var(--c-faint)]">수집된 로그가 없습니다</div>
          ) : logs.map(log => (
            <div key={log.id} className="flex gap-3 px-2 py-1 hover:bg-[var(--c-hover)] rounded">
              <span className="text-[var(--c-faint)] shrink-0 w-32">
                {new Date(log.collected_at).toLocaleString('ko-KR', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}
              </span>
              <span className={`shrink-0 w-14 uppercase font-bold ${LOG_COLOR[log.level] ?? 'text-[var(--c-muted)]'}`}>
                {log.level}
              </span>
              <span className="text-purple-400 shrink-0 max-w-[100px] truncate">{log.source}</span>
              <span className="text-[var(--c-text)] break-all">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
