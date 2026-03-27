'use client'

import { useEffect, useState, useCallback } from 'react'
import { Cpu, RefreshCw, Thermometer, Zap, Wind, AlertTriangle, CheckCircle, XCircle, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'

interface Asset {
  id: number
  name: string
  hostname: string
  ip_address: string
  status: string
  location: string
  bmc_enabled: boolean
  bmc_ip: string | null
}

interface BmcMetric {
  collected_at: string
  power_watts: number | null
  psu1_status: string | null
  psu2_status: string | null
  cpu1_temp_c: number | null
  cpu2_temp_c: number | null
  inlet_temp_c: number | null
  outlet_temp_c: number | null
  overall_health: string | null
}

interface HwHealth {
  component: string
  name: string
  status: string
  checked_at: string
}

interface BmcData {
  metric: BmcMetric | null
  hw: HwHealth[]
}

interface ServerBmc {
  asset: Asset
  bmc: BmcData | null
  loading: boolean
  collecting: boolean
}

const HEALTH_ICON: Record<string, React.ReactNode> = {
  ok:       <CheckCircle size={14} className="text-green-400" />,
  warning:  <AlertTriangle size={14} className="text-yellow-400" />,
  critical: <XCircle size={14} className="text-red-400" />,
  unknown:  <HelpCircle size={14} className="text-[var(--c-muted)]" />,
}

const HEALTH_COLOR: Record<string, string> = {
  ok:       'text-green-400',
  warning:  'text-yellow-400',
  critical: 'text-red-400',
  unknown:  'text-[var(--c-muted)]',
}

const HEALTH_BG: Record<string, string> = {
  ok:       'bg-green-500/10 border-green-500/20',
  warning:  'bg-yellow-500/10 border-yellow-500/20',
  critical: 'bg-red-500/10 border-red-500/20',
  unknown:  'bg-[var(--c-hover)] border-[var(--c-border)]',
}

function TempBadge({ label, value }: { label: string; value: number | null }) {
  if (value === null) return (
    <div className="text-center">
      <div className="text-[var(--c-faint)] text-xs">{label}</div>
      <div className="text-[var(--c-faint)] text-sm">—</div>
    </div>
  )
  const color = value >= 80 ? 'text-red-400' : value >= 65 ? 'text-yellow-400' : 'text-green-400'
  return (
    <div className="text-center">
      <div className="text-[var(--c-faint)] text-xs">{label}</div>
      <div className={`text-sm font-mono font-medium ${color}`}>{value}°C</div>
    </div>
  )
}

function PsuBadge({ label, status }: { label: string; status: string | null }) {
  const s = (status ?? 'unknown').toLowerCase()
  const color = s === 'ok' ? 'text-green-400' : s === 'warning' ? 'text-yellow-400' : s === 'critical' ? 'text-red-400' : 'text-[var(--c-muted)]'
  return (
    <div className="text-center">
      <div className="text-[var(--c-faint)] text-xs">{label}</div>
      <div className={`text-xs font-medium uppercase ${color}`}>{status ?? '—'}</div>
    </div>
  )
}

function ServerBmcCard({ item, onCollect }: { item: ServerBmc; onCollect: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { asset, bmc, loading, collecting } = item
  const health = bmc?.metric?.overall_health?.toLowerCase() ?? 'unknown'

  return (
    <div className={`border rounded-xl overflow-hidden ${HEALTH_BG[health] ?? HEALTH_BG.unknown}`}>
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {HEALTH_ICON[health] ?? HEALTH_ICON.unknown}
            <span className="font-medium text-[var(--c-text)] truncate">{asset.name}</span>
            <span className={`text-xs font-semibold uppercase px-1.5 py-0.5 rounded ${HEALTH_COLOR[health]}`}>
              {bmc?.metric?.overall_health ?? '데이터 없음'}
            </span>
          </div>
          <div className="text-xs text-[var(--c-muted)] mt-0.5">
            {asset.ip_address}
            {asset.bmc_ip && <span className="ml-2 text-[var(--c-faint)]">BMC: {asset.bmc_ip}</span>}
            {asset.location && <span className="ml-2 text-[var(--c-faint)]">· {asset.location}</span>}
          </div>
        </div>

        {/* Power */}
        <div className="flex items-center gap-1 text-sm shrink-0">
          <Zap size={12} className="text-yellow-400" />
          <span className="font-mono text-[var(--c-text)]">
            {bmc?.metric?.power_watts != null ? `${bmc.metric.power_watts} W` : '—'}
          </span>
        </div>

        {/* Temps */}
        {bmc?.metric && (
          <div className="hidden sm:flex items-center gap-4 border-l border-[var(--c-border)] pl-4 shrink-0">
            <TempBadge label="CPU1" value={bmc.metric.cpu1_temp_c} />
            <TempBadge label="CPU2" value={bmc.metric.cpu2_temp_c} />
            <TempBadge label="입기" value={bmc.metric.inlet_temp_c} />
            <TempBadge label="배기" value={bmc.metric.outlet_temp_c} />
          </div>
        )}

        {/* PSU */}
        {bmc?.metric && (
          <div className="hidden md:flex items-center gap-3 border-l border-[var(--c-border)] pl-4 shrink-0">
            <PsuBadge label="PSU1" status={bmc.metric.psu1_status} />
            <PsuBadge label="PSU2" status={bmc.metric.psu2_status} />
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={() => onCollect(asset.id)}
            disabled={collecting}
            className="px-2 py-1.5 rounded-lg bg-[var(--c-border)] hover:bg-[var(--c-hover)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-xs flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={11} className={collecting ? 'animate-spin' : ''} />
            수집
          </button>
          {bmc?.hw && bmc.hw.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg bg-[var(--c-border)] hover:bg-[var(--c-hover)] text-[var(--c-muted)]"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile temps */}
      {bmc?.metric && (
        <div className="flex sm:hidden items-center gap-4 px-4 pb-3 border-t border-[var(--c-border)] pt-3">
          <TempBadge label="CPU1" value={bmc.metric.cpu1_temp_c} />
          <TempBadge label="CPU2" value={bmc.metric.cpu2_temp_c} />
          <TempBadge label="입기" value={bmc.metric.inlet_temp_c} />
          <TempBadge label="배기" value={bmc.metric.outlet_temp_c} />
          <PsuBadge label="PSU1" status={bmc.metric.psu1_status} />
          <PsuBadge label="PSU2" status={bmc.metric.psu2_status} />
        </div>
      )}

      {/* Loading / No data */}
      {loading && (
        <div className="px-4 pb-3 flex items-center gap-2 text-xs text-[var(--c-faint)]">
          <RefreshCw size={11} className="animate-spin" />
          BMC 데이터 로딩 중...
        </div>
      )}
      {!loading && !bmc?.metric && (
        <div className="px-4 pb-3 text-xs text-[var(--c-faint)]">
          수집된 BMC 데이터가 없습니다. 수집 버튼을 눌러 Redfish 데이터를 가져오세요.
        </div>
      )}

      {/* HW Health 상세 */}
      {expanded && bmc?.hw && bmc.hw.length > 0 && (
        <div className="border-t border-[var(--c-border)] px-4 py-3">
          <p className="text-xs text-[var(--c-muted)] mb-2">컴포넌트 상태</p>
          <div className="flex flex-wrap gap-2">
            {bmc.hw.map((h, i) => {
              const s = h.status.toLowerCase()
              const icon = HEALTH_ICON[s] ?? HEALTH_ICON.unknown
              const col  = HEALTH_COLOR[s] ?? HEALTH_COLOR.unknown
              return (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)]">
                  {icon}
                  <span className="text-xs text-[var(--c-text)]">{h.name}</span>
                  <span className={`text-xs font-medium uppercase ${col}`}>{h.status}</span>
                </div>
              )
            })}
          </div>
          {bmc.metric && (
            <p className="text-[10px] text-[var(--c-faint)] mt-2">
              마지막 수집: {new Date(bmc.metric.collected_at).toLocaleString('ko-KR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function HardwarePage() {
  const [items, setItems] = useState<ServerBmc[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [collectingAll, setCollectingAll] = useState(false)
  const [filter, setFilter] = useState<'all' | 'ok' | 'warning' | 'critical' | 'unknown'>('all')

  const loadBmc = useCallback(async (assetId: number, idx: number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, loading: true } : it))
    try {
      const res  = await fetch(`/api/bmc/latest?asset_id=${assetId}`)
      const data = await res.json()
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, bmc: data, loading: false } : it))
    } catch {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, loading: false } : it))
    }
  }, [])

  useEffect(() => {
    async function init() {
      setLoadingAssets(true)
      try {
        const res    = await fetch('/api/assets?type=server&limit=200')
        const data   = await res.json()
        const assets: Asset[] = (data.assets ?? []).filter((a: Asset) => a.bmc_enabled)
        const initial = assets.map(a => ({ asset: a, bmc: null, loading: true, collecting: false }))
        setItems(initial)
        setLoadingAssets(false)
        // BMC 데이터 병렬 로드
        assets.forEach((a, i) => loadBmc(a.id, i))
      } catch {
        setLoadingAssets(false)
      }
    }
    init()
  }, [loadBmc])

  const collectOne = useCallback(async (assetId: number) => {
    const idx = items.findIndex(it => it.asset.id === assetId)
    if (idx < 0) return
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, collecting: true } : it))
    try {
      await fetch('/api/bmc/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId }),
      })
      await loadBmc(assetId, idx)
    } finally {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, collecting: false } : it))
    }
  }, [items, loadBmc])

  const collectAll = useCallback(async () => {
    setCollectingAll(true)
    try {
      await fetch('/api/bmc/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      items.forEach((it, i) => loadBmc(it.asset.id, i))
    } finally {
      setCollectingAll(false)
    }
  }, [items, loadBmc])

  const counts = {
    ok:       items.filter(it => it.bmc?.metric?.overall_health?.toLowerCase() === 'ok').length,
    warning:  items.filter(it => it.bmc?.metric?.overall_health?.toLowerCase() === 'warning').length,
    critical: items.filter(it => it.bmc?.metric?.overall_health?.toLowerCase() === 'critical').length,
    unknown:  items.filter(it => !it.bmc?.metric?.overall_health || it.bmc.metric.overall_health.toLowerCase() === 'unknown').length,
  }

  const filtered = items.filter(it => {
    if (filter === 'all') return true
    const h = it.bmc?.metric?.overall_health?.toLowerCase() ?? 'unknown'
    return h === filter
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Cpu size={20} className="text-cyan-400" />
            BMC / 하드웨어 모니터링
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">
            Redfish 기반 온도·전력·PSU 실시간 수집
          </p>
        </div>
        <button
          onClick={collectAll}
          disabled={collectingAll || loadingAssets}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium"
        >
          <RefreshCw size={14} className={collectingAll ? 'animate-spin' : ''} />
          전체 수집
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { key: 'all',      label: '전체',    count: items.length,  color: 'text-[var(--c-text)]',   bg: 'bg-[var(--c-card)] border-[var(--c-border)]' },
          { key: 'ok',       label: 'OK',      count: counts.ok,     color: 'text-green-400',          bg: 'bg-green-500/10 border-green-500/20' },
          { key: 'warning',  label: 'Warning', count: counts.warning, color: 'text-yellow-400',        bg: 'bg-yellow-500/10 border-yellow-500/20' },
          { key: 'critical', label: 'Critical',count: counts.critical,color: 'text-red-400',           bg: 'bg-red-500/10 border-red-500/20' },
        ].map(({ key, label, count, color, bg }) => (
          <button
            key={key}
            onClick={() => setFilter(key as typeof filter)}
            className={`border rounded-xl p-4 text-left transition-all ${bg} ${filter === key ? 'ring-2 ring-cyan-500/40' : 'hover:ring-1 hover:ring-[var(--c-border)]'}`}
          >
            <p className={`text-2xl font-bold font-mono ${color}`}>{count}</p>
            <p className="text-xs text-[var(--c-muted)] mt-1">{label}</p>
          </button>
        ))}
      </div>

      {/* 서버 목록 */}
      <div className="space-y-2">
        {loadingAssets ? (
          <div className="flex items-center justify-center py-16 text-[var(--c-faint)]">
            <RefreshCw className="animate-spin mr-2" size={16} />
            BMC 활성 서버 로딩 중...
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-[var(--c-faint)]">
            <Thermometer size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">BMC가 활성화된 서버가 없습니다.</p>
            <p className="text-xs mt-1">자산 관리에서 서버의 BMC 설정을 활성화하세요.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--c-faint)]">
            <Wind size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">해당 상태의 서버가 없습니다.</p>
          </div>
        ) : (
          filtered.map(item => (
            <ServerBmcCard key={item.asset.id} item={item} onCollect={collectOne} />
          ))
        )}
      </div>
    </div>
  )
}
