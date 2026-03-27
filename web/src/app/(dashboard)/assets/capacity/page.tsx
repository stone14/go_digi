'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  BarChart2, RefreshCw, AlertTriangle, CheckCircle, X,
  HardDrive, Server, TrendingUp, Cpu, MemoryStick,
  Brain, Loader2, ChevronDown,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'

type TabType = 'disk' | 'storage' | 'cpu' | 'memory'
type LLMProvider = 'ollama' | 'openai' | 'anthropic'

interface RawRow {
  asset_id: number
  asset_name: string
  mount_point?: string
  volume_name?: string
  total_gb: number
  used_gb: number
  collected_at?: string
  recorded_at?: string
}

interface DiskItem {
  asset_id: number; asset_name: string; mount_point: string
  total_gb: number; used_gb: number; pct: number
  growth30: number; daysToFull: number | null
  risk: 'danger' | 'warn' | 'ok'
  history: { ts: string; used_gb: number }[]
}

interface StorageItem {
  asset_id: number; asset_name: string; volume_name: string
  total_gb: number; used_gb: number; pct: number
  growth30: number; daysToFull: number | null
  risk: 'danger' | 'warn' | 'ok'
  history: { ts: string; used_gb: number }[]
  hasHistory: boolean
}

interface ResourceItem {
  asset_id: number; asset_name: string; ip_address: string | null
  current: number; avg_30d: number; max_30d: number
  mem_total_mb?: number
  history: { day: string; avg: number; max: number }[]
}

interface LLMAnalysis {
  risk: 'danger' | 'warn' | 'ok'
  pattern: string
  peak_7d: number
  peak_30d: number
  recommendation: string
  provider?: string
  model?: string
  cached?: boolean
  loading?: boolean
  error?: string
}

function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 }
  const xs = ys.map((_, i) => i)
  const sumX  = xs.reduce((s, x) => s + x, 0)
  const sumY  = ys.reduce((s, y) => s + y, 0)
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

function calcRisk(pct: number, daysToFull: number | null): 'danger' | 'warn' | 'ok' {
  if (pct >= 90 || (daysToFull !== null && daysToFull <= 90))  return 'danger'
  if (pct >= 75 || (daysToFull !== null && daysToFull <= 180)) return 'warn'
  return 'ok'
}

function buildItems<T extends DiskItem | StorageItem>(
  rows: RawRow[], keyFn: (r: RawRow) => string, type: 'disk' | 'storage'
): T[] {
  const groups = new Map<string, RawRow[]>()
  for (const r of rows) {
    const k = keyFn(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const items: T[] = []
  for (const [, grp] of groups) {
    grp.sort((a, b) => (a.collected_at ?? a.recorded_at ?? '').localeCompare(b.collected_at ?? b.recorded_at ?? ''))
    const latest   = grp[grp.length - 1]
    const total_gb = latest.total_gb
    const used_gb  = latest.used_gb
    const pct      = total_gb > 0 ? (used_gb / total_gb) * 100 : 0
    const usedVals = grp.map(r => r.used_gb)
    const { slope } = linearRegression(usedVals)
    const slopePerDay = grp.length > 1 ? slope / (grp.length - 1) : 0
    const growth30    = slopePerDay * 30
    const daysToFull  = slopePerDay > 0 ? Math.round((total_gb - used_gb) / slopePerDay) : null
    const risk = calcRisk(pct, daysToFull)
    const ts   = grp.map(r => ({ ts: (r.collected_at ?? r.recorded_at ?? '').slice(0, 10), used_gb: r.used_gb }))
    if (type === 'disk') {
      items.push({ asset_id: grp[0].asset_id, asset_name: grp[0].asset_name,
        mount_point: grp[0].mount_point ?? '', total_gb, used_gb,
        pct: Math.round(pct * 10) / 10, growth30: Math.round(growth30 * 10) / 10,
        daysToFull, risk, history: ts } as T)
    } else {
      items.push({ asset_id: grp[0].asset_id, asset_name: grp[0].asset_name,
        volume_name: grp[0].volume_name ?? '', total_gb, used_gb,
        pct: Math.round(pct * 10) / 10, growth30: Math.round(growth30 * 10) / 10,
        daysToFull, risk, history: ts, hasHistory: grp.length > 1 } as T)
    }
  }
  return items.sort((a, b) => {
    const ro = { danger: 0, warn: 1, ok: 2 }
    return ro[a.risk] - ro[b.risk] || b.pct - a.pct
  })
}

function UsageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-400' : 'bg-cyan-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[var(--c-border)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  )
}

function RiskBadge({ risk }: { risk: 'danger' | 'warn' | 'ok' }) {
  if (risk === 'danger') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/15 text-red-400">
      <AlertTriangle size={10} /> 위험
    </span>
  )
  if (risk === 'warn') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-orange-400/15 text-orange-400">
      <AlertTriangle size={10} /> 주의
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/15 text-green-400">
      <CheckCircle size={10} /> 정상
    </span>
  )
}

interface ChartModalProps {
  title: string
  history: { ts: string; used_gb: number }[]
  total_gb: number
  daysToFull: number | null
  onClose: () => void
}

function ChartModal({ title, history, total_gb, daysToFull, onClose }: ChartModalProps) {
  const chartData = useMemo(() => {
    const usedVals = history.map(h => h.used_gb)
    const { slope } = linearRegression(usedVals)
    const slopePerDay = usedVals.length > 1 ? slope / (usedVals.length - 1) : 0
    const actual = history.map(h => ({ ts: h.ts, actual: Math.round(h.used_gb * 10) / 10 }))
    const lastUsed = usedVals[usedVals.length - 1] ?? 0
    const forecast: { ts: string; forecast: number }[] = []
    for (let d = 1; d <= 90; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d)
      forecast.push({ ts: dt.toISOString().slice(0, 10), forecast: Math.round(Math.min(lastUsed + slopePerDay * d, total_gb) * 10) / 10 })
    }
    return { actual, forecast, slopePerDay }
  }, [history, total_gb])

  const warn80 = total_gb * 0.8
  const warn90 = total_gb * 0.9

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[680px] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--c-text)]">{title}</h2>
            <p className="text-xs text-[var(--c-muted)] mt-0.5">
              총 용량: {total_gb.toFixed(1)} GB
              {daysToFull !== null && daysToFull > 0 ? ` · 예상 고갈: ${daysToFull}일 후` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--c-muted)] hover:text-[var(--c-text)]"><X size={18} /></button>
        </div>
        <div className="mb-3">
          <p className="text-xs text-[var(--c-muted)] mb-1">실제 사용량 (최근 30일)</p>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData.actual} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00d4ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="ts" tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => v.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => `${v}G`} />
              <Tooltip contentStyle={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--c-muted)', fontSize: 11 }}
                formatter={(v) => [`${Number(v).toFixed(1)} GB`, '사용량']} />
              <ReferenceLine y={warn80} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '80%', fill: '#f59e0b', fontSize: 10 }} />
              <ReferenceLine y={warn90} stroke="#ef4444" strokeDasharray="4 2" label={{ value: '90%', fill: '#ef4444', fontSize: 10 }} />
              <Area type="monotone" dataKey="actual" stroke="#00d4ff" strokeWidth={1.5} fill="url(#gradActual)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {chartData.slopePerDay > 0 && (
          <div>
            <p className="text-xs text-[var(--c-muted)] mb-1">90일 용량 예측</p>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={chartData.forecast} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="gradForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="ts" tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => `${v}G`} />
                <Tooltip contentStyle={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--c-muted)', fontSize: 11 }}
                  formatter={(v) => [`${Number(v).toFixed(1)} GB`, '예측']} />
                <ReferenceLine y={warn80} stroke="#f59e0b" strokeDasharray="4 2" />
                <ReferenceLine y={warn90} stroke="#ef4444" strokeDasharray="4 2" />
                <Area type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={1.5}
                  strokeDasharray="5 3" fill="url(#gradForecast)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

interface LLMModalProps {
  item: ResourceItem
  type: 'cpu' | 'memory'
  provider: LLMProvider
  analysis: LLMAnalysis | undefined
  onClose: () => void
  onAnalyze: () => void
}

function LLMModal({ item, type, provider, analysis, onClose, onAnalyze }: LLMModalProps) {
  const typeLabel = type === 'cpu' ? 'CPU' : '메모리'
  const avgColor  = type === 'cpu' ? '#00d4ff' : '#a855f7'
  const maxColor  = type === 'cpu' ? '#f59e0b' : '#ef4444'

  const chartData = item.history.map(h => ({
    day: h.day.slice(5),
    avg: h.avg,
    max: h.max,
  }))

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[940px] max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-[var(--c-text)]">
              {item.asset_name} — {typeLabel} 용량 분석
            </h2>
            <p className="text-xs text-[var(--c-muted)] mt-0.5">
              {item.ip_address}
              {type === 'memory' && item.mem_total_mb
                ? ` · 총 ${(item.mem_total_mb / 1024).toFixed(1)} GB`
                : ''}
              {' · '}현재 {item.current}% · 30일 평균 {item.avg_30d}% · 30일 최대{' '}
              <span className={item.max_30d >= 90 ? 'text-red-400' : item.max_30d >= 75 ? 'text-orange-400' : 'text-green-400'}>
                {item.max_30d}%
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--c-muted)] hover:text-[var(--c-text)] ml-4 flex-shrink-0"><X size={18} /></button>
        </div>

        {/* 2-컬럼 바디 */}
        <div className="grid grid-cols-[1fr,320px] gap-5">
          {/* 왼쪽: 30일 추세 차트 */}
          <div>
            <p className="text-xs text-[var(--c-muted)] mb-2">30일 {typeLabel} 사용률 추세</p>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gradAvg2col" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={avgColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={avgColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--c-muted)' }} />
                <YAxis domain={[0, Math.max(100, item.max_30d + 5)]} tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--c-muted)', fontSize: 11 }}
                  formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name === 'avg' ? '평균' : '최대']} />
                <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '75%', fill: '#f59e0b', fontSize: 9 }} />
                <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="4 2" label={{ value: '90%', fill: '#ef4444', fontSize: 9 }} />
                <Area type="monotone" dataKey="avg" stroke={avgColor} strokeWidth={1.5} fill="url(#gradAvg2col)" dot={false} name="avg" />
                <Area type="monotone" dataKey="max" stroke={maxColor} strokeWidth={1} fill="none" dot={false} strokeDasharray="3 2" name="max" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 justify-end">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded" style={{ background: avgColor }} />
                <span className="text-[10px] text-[var(--c-faint)]">일별 평균</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded border-t-2 border-dashed" style={{ borderColor: maxColor }} />
                <span className="text-[10px] text-[var(--c-faint)]">일별 최대</span>
              </div>
            </div>
          </div>

          {/* 오른쪽: LLM 분석 결과 */}
          <div className="bg-[var(--c-hover)] border border-[var(--c-border)] rounded-xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-[var(--c-text)] flex items-center gap-1.5">
                <Brain size={14} className="text-purple-400" /> AI 분석 결과
              </p>
              <button
                onClick={onAnalyze}
                disabled={analysis?.loading}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-50 transition-colors">
                {analysis?.loading
                  ? <><Loader2 size={10} className="animate-spin" /> 분석 중</>
                  : <><Brain size={10} /> 재분석</>
                }
              </button>
            </div>

            {/* 프로바이더 메타 */}
            {analysis?.provider && (
              <p className="text-[10px] text-[var(--c-faint)] mb-3 -mt-1">
                {analysis.provider}{analysis.model ? ` · ${analysis.model}` : ''}
                {analysis.cached && <span className="ml-1 px-1 py-0.5 bg-blue-500/15 text-blue-400 rounded text-[9px]">캐시</span>}
              </p>
            )}

            {/* 미분석 */}
            {!analysis && (
              <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
                <button onClick={onAnalyze}
                  className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors text-sm">
                  <Brain size={14} /> AI 분석 시작
                </button>
                <p className="text-[10px] text-[var(--c-faint)] mt-2">{provider} · 30일 트렌드 분석</p>
              </div>
            )}

            {/* 로딩 */}
            {analysis?.loading && !analysis.risk && (
              <div className="flex-1 flex flex-col items-center justify-center py-4">
                <Loader2 size={22} className="animate-spin text-purple-400 mb-2" />
                <p className="text-xs text-[var(--c-muted)]">{provider} 분석 중...</p>
              </div>
            )}

            {/* 오류 */}
            {analysis?.error && (
              <div className="flex-1 space-y-2">
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertTriangle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-300 leading-relaxed">{analysis.error}</p>
                </div>
                {(analysis.error.includes('API 키') || analysis.error.includes('설정')) && (
                  <a href="/settings/llm" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    <TrendingUp size={10} /> 설정 페이지로 이동 ↗
                  </a>
                )}
              </div>
            )}

            {/* 분석 결과 */}
            {analysis?.risk && !analysis.error && (
              <div className="flex-1 space-y-3">
                {/* 위험도 + 패턴 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <RiskBadge risk={analysis.risk} />
                  <span className="text-xs text-[var(--c-muted)]">패턴:</span>
                  <span className="text-xs font-medium text-[var(--c-text)]">{analysis.pattern}</span>
                </div>
                {/* 예측 수치 */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[var(--c-card)] rounded-lg p-3 text-center">
                    <p className="text-[10px] text-[var(--c-muted)] mb-1">7일 후 예상</p>
                    <p className={`text-xl font-bold ${analysis.peak_7d >= 90 ? 'text-red-400' : analysis.peak_7d >= 75 ? 'text-orange-400' : 'text-green-400'}`}>
                      {analysis.peak_7d}%
                    </p>
                  </div>
                  <div className="bg-[var(--c-card)] rounded-lg p-3 text-center">
                    <p className="text-[10px] text-[var(--c-muted)] mb-1">30일 후 예상</p>
                    <p className={`text-xl font-bold ${analysis.peak_30d >= 90 ? 'text-red-400' : analysis.peak_30d >= 75 ? 'text-orange-400' : 'text-green-400'}`}>
                      {analysis.peak_30d}%
                    </p>
                  </div>
                </div>
                {/* 권고사항 */}
                {analysis.recommendation && (
                  <div className="bg-[var(--c-card)] rounded-lg p-3 flex-1">
                    <p className="text-[10px] text-[var(--c-muted)] mb-1">권고사항</p>
                    <p className="text-xs text-[var(--c-text)] leading-relaxed">{analysis.recommendation}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderSelect({ value, onChange }: { value: LLMProvider; onChange: (v: LLMProvider) => void }) {
  const labels: Record<LLMProvider, string> = {
    ollama:    'Ollama (로컬)',
    openai:    'OpenAI',
    anthropic: 'Anthropic',
  }
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value as LLMProvider)}
        className="appearance-none pl-2 pr-7 py-1 text-xs bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:outline-none focus:border-purple-500 cursor-pointer">
        {(Object.keys(labels) as LLMProvider[]).map(p => (
          <option key={p} value={p}>{labels[p]}</option>
        ))}
      </select>
      <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-muted)] pointer-events-none" />
    </div>
  )
}

export default function CapacityPage() {
  const [tab,        setTab]        = useState<TabType>('disk')
  const [diskItems,  setDiskItems]  = useState<DiskItem[]>([])
  const [storItems,  setStorItems]  = useState<StorageItem[]>([])
  const [cpuItems,   setCpuItems]   = useState<ResourceItem[]>([])
  const [memItems,   setMemItems]   = useState<ResourceItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [snapping,   setSnapping]   = useState(false)
  const [snapMsg,    setSnapMsg]    = useState('')
  const [provider,   setProvider]   = useState<LLMProvider>('ollama')
  const [analyses,   setAnalyses]   = useState<Record<string, LLMAnalysis>>({})
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const [providerStatus, setProviderStatus] = useState<'idle' | 'checking' | 'connected' | 'error' | 'no-key'>('idle')
  const [diskModal,  setDiskModal]  = useState<{
    title: string; history: { ts: string; used_gb: number }[]; total_gb: number; daysToFull: number | null
  } | null>(null)
  const [llmModal, setLlmModal] = useState<{ item: ResourceItem; type: 'cpu' | 'memory' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [diskRes, storRes, cpuRes, memRes] = await Promise.all([
        fetch('/api/assets/capacity?type=disk').then(r => r.json()),
        fetch('/api/assets/capacity?type=storage').then(r => r.json()),
        fetch('/api/assets/capacity?type=cpu').then(r => r.json()),
        fetch('/api/assets/capacity?type=memory').then(r => r.json()),
      ])
      setDiskItems(buildItems<DiskItem>(diskRes.items ?? [], r => `${r.asset_id}::${r.mount_point}`, 'disk'))
      setStorItems(buildItems<StorageItem>(storRes.items ?? [], r => `${r.asset_id}::${r.volume_name}`, 'storage'))
      setCpuItems(cpuRes.items ?? [])
      setMemItems(memRes.items ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // LLM 프로바이더 연결 상태 확인
  useEffect(() => {
    if (tab !== 'cpu' && tab !== 'memory') return
    setProviderStatus('checking')
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const cfgRes = await fetch('/api/llm', { signal: ctrl.signal })
        const { config } = await cfgRes.json()
        const savedProvider = config?.llm_provider || 'ollama'
        const savedUrl = config?.llm_api_url || 'http://localhost:11434'
        const hasKey = config?.llm_api_key && !config.llm_api_key.startsWith('••')

        if (provider === 'ollama') {
          const probe = await fetch(`${savedUrl}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
          setProviderStatus(probe?.ok ? 'connected' : 'error')
        } else {
          setProviderStatus(hasKey && savedProvider === provider ? 'connected' : 'no-key')
        }
      } catch {
        if (!ctrl.signal.aborted) setProviderStatus('error')
      }
    })()
    return () => ctrl.abort()
  }, [tab, provider])

  const snapshot = async () => {
    setSnapping(true)
    try {
      await fetch('/api/assets/capacity', { method: 'POST' })
      setSnapMsg('스냅샷 기록 완료')
      setTimeout(() => setSnapMsg(''), 3000)
      load()
    } finally { setSnapping(false) }
  }

  // LLM 분석 호출
  const analyze = useCallback(async (item: ResourceItem, type: 'cpu' | 'memory') => {
    const key = `${type}::${item.asset_id}`
    setAnalyses(prev => ({ ...prev, [key]: { ...(prev[key] ?? {}), loading: true, error: undefined } as LLMAnalysis }))
    try {
      const res = await fetch('/api/assets/capacity/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: item.asset_id, asset_name: item.asset_name,
          type, provider, history: item.history,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setAnalyses(prev => ({ ...prev, [key]: { loading: false, error: data.error } as LLMAnalysis }))
      } else {
        setAnalyses(prev => ({ ...prev, [key]: { ...data, loading: false } }))
      }
    } catch (e) {
      setAnalyses(prev => ({ ...prev, [key]: { loading: false, error: '네트워크 오류가 발생했습니다' } as LLMAnalysis }))
    }
  }, [provider])

  // 전체 일괄 분석
  const analyzeAll = useCallback(async () => {
    const items = tab === 'cpu' ? cpuItems : memItems
    const unanalyzed = items.filter(item => {
      const key = `${tab}::${item.asset_id}`
      const a = analyses[key]
      return !a?.risk && !a?.loading
    })
    if (unanalyzed.length === 0) return
    setBulkProgress({ done: 0, total: unanalyzed.length })
    for (const item of unanalyzed) {
      await analyze(item, tab as 'cpu' | 'memory')
      setBulkProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
    }
    setTimeout(() => setBulkProgress(null), 3000)
  }, [tab, cpuItems, memItems, analyses, analyze])

  // 요약 카드 계산
  const resourceRisk = (item: ResourceItem) => {
    const key = `${tab}::${item.asset_id}`
    const a = analyses[key]
    if (a?.risk) return a.risk
    if (item.max_30d >= 90) return 'danger'
    if (item.max_30d >= 75) return 'warn'
    return 'ok'
  }

  const currentItems = tab === 'disk' ? diskItems
    : tab === 'storage' ? storItems
    : tab === 'cpu' ? cpuItems : memItems

  const counts = useMemo(() => {
    if (tab === 'disk' || tab === 'storage') {
      const items = tab === 'disk' ? diskItems : storItems
      return { total: items.length, danger: items.filter(i => i.risk === 'danger').length,
        warn: items.filter(i => i.risk === 'warn').length, ok: items.filter(i => i.risk === 'ok').length }
    }
    const items = tab === 'cpu' ? cpuItems : memItems
    const risks = items.map(i => resourceRisk(i))
    return { total: items.length, danger: risks.filter(r => r === 'danger').length,
      warn: risks.filter(r => r === 'warn').length, ok: risks.filter(r => r === 'ok').length }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, diskItems, storItems, cpuItems, memItems, analyses])

  const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'disk',    label: '서버 디스크', icon: <Server    size={13} /> },
    { id: 'storage', label: '스토리지 장비', icon: <HardDrive size={13} /> },
    { id: 'cpu',     label: 'CPU 용량',    icon: <Cpu       size={13} /> },
    { id: 'memory',  label: '메모리 용량', icon: <MemoryStick size={13} /> },
  ]

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <BarChart2 size={20} className="text-cyan-400" /> 용량 계획
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">디스크 · 스토리지 · CPU · 메모리 트렌드 및 고갈/과부하 예측</p>
        </div>
        <div className="flex items-center gap-2">
          {snapMsg && <span className="text-xs text-green-400">{snapMsg}</span>}
          {tab === 'storage' && (
            <button onClick={snapshot} disabled={snapping}
              className="px-3 py-1.5 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-muted)] hover:text-[var(--c-text)] disabled:opacity-50">
              {snapping ? '기록 중...' : '스냅샷 기록'}
            </button>
          )}
          <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 항목',   value: counts.total,  color: 'text-[var(--c-text)]' },
          { label: '위험',        value: counts.danger, color: 'text-red-400' },
          { label: '주의',        value: counts.warn,   color: 'text-orange-400' },
          { label: '정상',        value: counts.ok,     color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 탭 + LLM 프로바이더 선택 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg p-1 w-fit">
          {TABS.map(({ id, label, icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors
                ${tab === id ? 'bg-[var(--c-hover)] text-[var(--c-text)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}>
              {icon}{label}
            </button>
          ))}
        </div>
        {(tab === 'cpu' || tab === 'memory') && (() => {
          const items = tab === 'cpu' ? cpuItems : memItems
          const lastError = Object.entries(analyses)
            .filter(([k]) => k.startsWith(tab + '::'))
            .map(([, v]) => v?.error)
            .find(Boolean)
          const allDone = bulkProgress && bulkProgress.done === bulkProgress.total
          return (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-xs text-[var(--c-muted)] flex items-center gap-1">
                <Brain size={12} className="text-purple-400" /> AI 모델:
              </span>
              <ProviderSelect value={provider} onChange={v => { setProvider(v) }} />
              {providerStatus === 'checking' ? (
                <span className="flex items-center gap-1 text-xs text-[var(--c-muted)]">
                  <Loader2 size={10} className="animate-spin" /> 확인 중
                </span>
              ) : providerStatus === 'connected' ? (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> 연결됨
                </span>
              ) : providerStatus === 'no-key' ? (
                <a href="/settings/llm" className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300">
                  <AlertTriangle size={10} /> API 키 미설정 → 설정으로 이동
                </a>
              ) : providerStatus === 'error' ? (
                <a href="/settings/llm" className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                  <X size={10} /> 연결 실패 → 설정 확인
                </a>
              ) : lastError ? (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <AlertTriangle size={10} />
                  {lastError.includes('API 키') || lastError.includes('설정')
                    ? <a href="/settings/llm" className="underline hover:text-red-300">API 키 미설정 →</a>
                    : lastError.includes('fetch') ? '연결 실패' : '오류'}
                </span>
              ) : null}
              <button
                onClick={analyzeAll}
                disabled={!!bulkProgress || items.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-50 transition-colors">
                {bulkProgress && !allDone
                  ? <><Loader2 size={11} className="animate-spin" /> {bulkProgress.done}/{bulkProgress.total} 분석 중</>
                  : allDone
                  ? <><CheckCircle size={11} className="text-green-400" /> 완료</>
                  : <><Brain size={11} /> 전체 분석</>
                }
              </button>
            </div>
          )
        })()}
      </div>

      {/* ── 서버 디스크 탭 ── */}
      {tab === 'disk' && (
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)]">
                {['서버','마운트 포인트','사용률','현재 사용','총 용량','30일 증가','고갈 예상','위험도'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">
                  <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
                </td></tr>
              ) : diskItems.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">디스크 메트릭 데이터가 없습니다.</td></tr>
              ) : diskItems.map((item, i) => (
                <tr key={i} className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)] cursor-pointer"
                  onClick={() => setDiskModal({ title: `${item.asset_name} — ${item.mount_point}`, history: item.history, total_gb: item.total_gb, daysToFull: item.daysToFull })}>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5"><Server size={13} className="text-cyan-400" /><span className="font-medium text-[var(--c-text)]">{item.asset_name}</span></div></td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--c-muted)]">{item.mount_point}</td>
                  <td className="px-4 py-3 w-40"><UsageBar pct={item.pct} /></td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{item.used_gb.toFixed(1)} GB</td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{item.total_gb.toFixed(1)} GB</td>
                  <td className="px-4 py-3 text-xs">{item.growth30 > 0 ? <span className="text-orange-400">+{item.growth30} GB</span> : <span className="text-[var(--c-faint)]">—</span>}</td>
                  <td className="px-4 py-3 text-xs">
                    {item.daysToFull === null || item.daysToFull < 0 ? <span className="text-[var(--c-faint)]">—</span>
                      : <span className={item.daysToFull <= 90 ? 'text-red-400' : item.daysToFull <= 180 ? 'text-orange-400' : 'text-[var(--c-muted)]'}>{item.daysToFull}일 후</span>}
                  </td>
                  <td className="px-4 py-3"><RiskBadge risk={item.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 스토리지 장비 탭 ── */}
      {tab === 'storage' && (
        <div className="space-y-4">
          {loading ? <div className="text-center py-10 text-[var(--c-faint)]"><RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...</div>
          : storItems.length === 0 ? <div className="text-center py-10 text-[var(--c-faint)]">스토리지 데이터가 없습니다.</div>
          : (() => {
            const grouped = new Map<string, StorageItem[]>()
            for (const item of storItems) {
              const k = `${item.asset_id}::${item.asset_name}`
              if (!grouped.has(k)) grouped.set(k, [])
              grouped.get(k)!.push(item)
            }
            return [...grouped.entries()].map(([key, vols]) => {
              const totalUsed = vols.reduce((s, v) => s + v.used_gb, 0)
              const totalCap  = vols.reduce((s, v) => s + v.total_gb, 0)
              const maxRisk   = vols.reduce<'danger'|'warn'|'ok'>((m, v) =>
                v.risk === 'danger' ? 'danger' : m === 'danger' ? 'danger' : v.risk === 'warn' ? 'warn' : m, 'ok')
              return (
                <div key={key} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <HardDrive size={16} className="text-purple-400" />
                      <span className="font-semibold text-[var(--c-text)]">{vols[0].asset_name}</span>
                      <RiskBadge risk={maxRisk} />
                    </div>
                    <span className="text-xs text-[var(--c-muted)]">{totalUsed.toFixed(1)} / {totalCap.toFixed(1)} TB 사용</span>
                  </div>
                  <div className="space-y-3">
                    {vols.map((v, i) => (
                      <div key={i}
                        className={`border border-[var(--c-border)]/50 rounded-lg p-3 ${v.hasHistory ? 'cursor-pointer hover:bg-[var(--c-hover)]' : ''}`}
                        onClick={v.hasHistory ? () => setDiskModal({ title: `${v.asset_name} — ${v.volume_name}`, history: v.history, total_gb: v.total_gb, daysToFull: v.daysToFull }) : undefined}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-[var(--c-text)]">{v.volume_name}</span>
                          <div className="flex items-center gap-2">
                            {v.hasHistory && <span className="text-[9px] text-cyan-400 border border-cyan-400/30 px-1.5 py-0.5 rounded flex items-center gap-1"><TrendingUp size={8} /> 트렌드</span>}
                            {v.daysToFull !== null && v.daysToFull > 0 && (
                              <span className={`text-xs ${v.daysToFull <= 90 ? 'text-red-400' : v.daysToFull <= 180 ? 'text-orange-400' : 'text-[var(--c-muted)]'}`}>{v.daysToFull}일 후 고갈</span>
                            )}
                            <RiskBadge risk={v.risk} />
                          </div>
                        </div>
                        <UsageBar pct={v.pct} />
                        <div className="flex justify-between mt-1 text-[10px] text-[var(--c-faint)]">
                          <span>{v.used_gb.toFixed(1)} GB 사용</span>
                          <span>/ {v.total_gb.toFixed(1)} GB 전체</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* ── CPU / 메모리 탭 ── */}
      {(tab === 'cpu' || tab === 'memory') && (() => {
        const items = tab === 'cpu' ? cpuItems : memItems
        const typeLabel = tab === 'cpu' ? 'CPU' : '메모리'
        const accentColor = tab === 'cpu' ? 'text-cyan-400' : 'text-purple-400'

        return (
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)]">
                  <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">서버</th>
                  <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">IP</th>
                  {tab === 'memory' && <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">총 메모리</th>}
                  <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium w-40">현재 사용률</th>
                  <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">30일 평균</th>
                  <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">30일 최대</th>
                  <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">AI 분석</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-10 text-[var(--c-faint)]">
                    <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
                  </td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-[var(--c-faint)]">
                    {typeLabel} 메트릭 데이터가 없습니다. 에이전트 수집 후 확인하세요.
                  </td></tr>
                ) : items.map((item) => {
                  const key       = `${tab}::${item.asset_id}`
                  const analysis  = analyses[key]
                  const risk      = resourceRisk(item)
                  const colSpan   = tab === 'memory' ? 7 : 6

                  return (
                    <tr key={item.asset_id}
                      className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)] cursor-pointer"
                      onClick={() => setLlmModal({ item, type: tab })}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Server size={13} className={accentColor} />
                          <span className="font-medium text-[var(--c-text)]">{item.asset_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--c-muted)]">{item.ip_address ?? '—'}</td>
                      {tab === 'memory' && (
                        <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                          {item.mem_total_mb ? `${(item.mem_total_mb / 1024).toFixed(1)} GB` : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 w-40"><UsageBar pct={item.current} /></td>
                      <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{item.avg_30d}%</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={item.max_30d >= 90 ? 'text-red-400' : item.max_30d >= 75 ? 'text-orange-400' : 'text-[var(--c-muted)]'}>
                          {item.max_30d}%
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {analysis?.loading ? (
                          <span className="flex items-center gap-1 text-xs text-[var(--c-muted)]">
                            <Loader2 size={11} className="animate-spin" /> 분석 중...
                          </span>
                        ) : analysis?.error ? (
                          <button
                            onClick={() => analyze(item, tab)}
                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                            <AlertTriangle size={10} /> 재시도
                          </button>
                        ) : analysis?.risk ? (
                          <button
                            onClick={() => setLlmModal({ item, type: tab })}
                            className="flex items-center gap-1.5">
                            <RiskBadge risk={analysis.risk} />
                            <span className="text-xs text-[var(--c-muted)]">{analysis.pattern}</span>
                            {analysis.cached && <span className="text-[9px] px-1 py-0.5 bg-blue-500/15 text-blue-400 rounded">캐시</span>}
                          </button>
                        ) : (
                          <button
                            onClick={() => { analyze(item, tab); setLlmModal({ item, type: tab }) }}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors">
                            <Brain size={11} /> AI 분석
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* 디스크 예측 모달 */}
      {diskModal && (
        <ChartModal
          title={diskModal.title}
          history={diskModal.history}
          total_gb={diskModal.total_gb}
          daysToFull={diskModal.daysToFull}
          onClose={() => setDiskModal(null)}
        />
      )}

      {/* LLM 분석 모달 */}
      {llmModal && (
        <LLMModal
          item={llmModal.item}
          type={llmModal.type}
          provider={provider}
          analysis={analyses[`${llmModal.type}::${llmModal.item.asset_id}`]}
          onClose={() => setLlmModal(null)}
          onAnalyze={() => analyze(llmModal.item, llmModal.type)}
        />
      )}
    </div>
  )
}
