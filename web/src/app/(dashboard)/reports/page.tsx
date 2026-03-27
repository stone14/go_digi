'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  FileBarChart, RefreshCw, AlertTriangle, CheckCircle,
  Server, HardDrive, Cpu, MemoryStick, Brain, Printer,
  TrendingUp, TrendingDown, Activity,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'

type Period = 7 | 30 | 90

interface ReportData {
  period: { days: number }
  assets: {
    total: string; active: string; online: string; offline: string
    servers: string; networks: string; storages: string; vms: string
  }
  alertStats: {
    total: string; critical: string; warning: string; info: string
    resolved: string; unresolved: string
  }
  alertRecent: {
    severity: string; message: string; fired_at: string
    resolved_at: string | null; asset_name: string
  }[]
  diskTop: { asset_name: string; mount_point: string; pct: string; used_gb: string; total_gb: string }[]
  cpuTop:  { asset_name: string; cpu_max: string; cpu_avg: string }[]
  memTop:  { asset_name: string; mem_max: string; mem_avg: string }[]
  storageTop: { asset_name: string; volume_name: string; pct: string; used_gb: string; total_gb: string }[]
  predictions: {
    issue_type: string; severity: string; confidence: string
    summary: string; predicted_at: string; asset_name: string; alert_sent: boolean
  }[]
  alertTrend: { day: string; critical: string; warning: string }[]
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
  warning:  'text-orange-400 bg-orange-400/10 border-orange-400/20',
  info:     'text-blue-400 bg-blue-400/10 border-blue-400/20',
}

const ISSUE_LABEL: Record<string, string> = {
  cpu_spike:       'CPU 급증',
  mem_leak:        '메모리 누수',
  disk_full:       '디스크 고갈',
  network_anomaly: '네트워크 이상',
  process_anomaly: '프로세스 이상',
  log_error:       '로그 오류',
  cpu_capacity:    'CPU 용량',
  mem_capacity:    '메모리 용량',
}

function StatCard({ label, value, sub, color = 'text-[var(--c-text)]', icon }: {
  label: string; value: string | number; sub?: string
  color?: string; icon: React.ReactNode
}) {
  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[var(--c-muted)]">{icon}</span>
        <span className="text-xs text-[var(--c-muted)]">{label}</span>
      </div>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--c-faint)] mt-1">{sub}</p>}
    </div>
  )
}

function UsageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-400' : 'bg-cyan-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[var(--c-border)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs w-10 text-right tabular-nums">{pct.toFixed(1)}%</span>
    </div>
  )
}

export default function ReportsPage() {
  const [period,  setPeriod]  = useState<Period>(7)
  const [data,    setData]    = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reports?days=${p}`)
      if (!res.ok) return
      const json = await res.json()
      if (!json.error) setData(json)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(period) }, [load, period])

  const changePeriod = (p: Period) => { setPeriod(p); load(p) }

  const print = () => window.print()

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-[var(--c-faint)]">
      <RefreshCw size={18} className="animate-spin mr-2" /> 리포트 생성 중...
    </div>
  )

  if (!data) return null

  const { assets, alertStats, alertRecent, diskTop, cpuTop, memTop, storageTop, predictions, alertTrend } = data
  const onlinePct = assets.total !== '0'
    ? Math.round(parseInt(assets.online) / parseInt(assets.active) * 100)
    : 0
  const resolvedPct = alertStats.total !== '0'
    ? Math.round(parseInt(alertStats.resolved) / parseInt(alertStats.total) * 100)
    : 0

  const trendData = alertTrend.map(r => ({
    day:      r.day.slice(5, 10),
    critical: parseInt(r.critical),
    warning:  parseInt(r.warning),
  }))

  return (
    <div className="space-y-6 print:space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <FileBarChart size={20} className="text-cyan-400" /> 인프라 리포트
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">인프라 전체 현황 및 통계 요약</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg p-0.5">
            {([7, 30, 90] as Period[]).map(p => (
              <button key={p} onClick={() => changePeriod(p)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  period === p
                    ? 'bg-[var(--c-hover)] text-[var(--c-text)]'
                    : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'
                }`}>
                최근 {p}일
              </button>
            ))}
          </div>
          <button onClick={() => load(period)} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={print}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <Printer size={14} /> 인쇄
          </button>
        </div>
      </div>

      {/* 인쇄용 헤더 */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">인프라 현황 리포트</h1>
        <p className="text-sm text-gray-500 mt-1">기간: 최근 {period}일 · 생성: {new Date().toLocaleString('ko-KR')}</p>
      </div>

      {/* 1. 자산 현황 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Server size={14} className="text-cyan-400" /> 자산 현황
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="전체 자산" value={assets.active} icon={<Server size={14} />} />
          <StatCard
            label="온라인" value={assets.online}
            sub={`${onlinePct}% 가용`}
            color="text-green-400"
            icon={<CheckCircle size={14} />}
          />
          <StatCard
            label="오프라인" value={assets.offline}
            color={parseInt(assets.offline) > 0 ? 'text-red-400' : 'text-[var(--c-text)]'}
            icon={<AlertTriangle size={14} />}
          />
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)] mb-2">유형별</p>
            <div className="space-y-1.5">
              {[
                { label: '서버',    value: assets.servers,  color: 'bg-cyan-400' },
                { label: '네트워크', value: assets.networks, color: 'bg-purple-400' },
                { label: '스토리지', value: assets.storages, color: 'bg-orange-400' },
                { label: 'VM',      value: assets.vms,      color: 'bg-green-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-[var(--c-muted)]">{label}</span>
                  </span>
                  <span className="font-medium text-[var(--c-text)]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2. 알림 통계 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Activity size={14} className="text-orange-400" /> 알림 통계 (최근 {period}일)
        </h2>
        <div className="grid grid-cols-[1fr,1fr,1.5fr] gap-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="전체 알림"   value={alertStats.total}    icon={<AlertTriangle size={13} />} />
            <StatCard label="미해결"      value={alertStats.unresolved}
              color={parseInt(alertStats.unresolved) > 0 ? 'text-red-400' : 'text-green-400'}
              icon={<AlertTriangle size={13} />} />
            <StatCard label="긴급 (Critical)" value={alertStats.critical}
              color={parseInt(alertStats.critical) > 0 ? 'text-red-400' : 'text-[var(--c-text)]'}
              icon={<TrendingUp size={13} />} />
            <StatCard label="해결률"      value={`${resolvedPct}%`}
              color={resolvedPct >= 80 ? 'text-green-400' : 'text-orange-400'}
              icon={<CheckCircle size={13} />} />
          </div>

          {/* 알림 트렌드 차트 */}
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)] mb-2">일별 알림 추이</p>
            {trendData.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-[var(--c-faint)] text-xs">데이터 없음</div>
            ) : (
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--c-muted)' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--c-muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 6, fontSize: 11 }} />
                  <Bar dataKey="critical" fill="#ef4444" radius={[2,2,0,0]} name="긴급" />
                  <Bar dataKey="warning"  fill="#f59e0b" radius={[2,2,0,0]} name="주의" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 최근 알림 */}
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)] mb-2">최근 알림</p>
            <div className="space-y-2 max-h-36 overflow-y-auto">
              {alertRecent.length === 0 ? (
                <p className="text-xs text-[var(--c-faint)]">알림 없음</p>
              ) : alertRecent.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-flex px-1.5 py-0.5 rounded text-[9px] border flex-shrink-0 ${SEVERITY_COLOR[a.severity] ?? ''}`}>
                    {a.severity}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--c-text)] truncate">{a.message}</p>
                    <p className="text-[10px] text-[var(--c-faint)]">
                      {a.asset_name} · {new Date(a.fired_at).toLocaleDateString('ko-KR')}
                      {a.resolved_at && <span className="text-green-400 ml-1">✓ 해결</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. 용량 현황 — CPU / 메모리 / 스토리지 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Cpu size={14} className="text-cyan-400" /> CPU 용량
        </h2>
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
          {cpuTop.length === 0 ? (
            <p className="text-xs text-[var(--c-faint)] p-4">데이터 없음</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)]">
                  {['서버', '30일 평균', '30일 최대', '사용률'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs text-[var(--c-muted)] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cpuTop.map((c, i) => (
                  <tr key={i} className="border-b border-[var(--c-border)]/50">
                    <td className="px-4 py-2 text-xs font-medium text-[var(--c-text)]">{c.asset_name}</td>
                    <td className="px-4 py-2 text-xs text-[var(--c-muted)]">{c.cpu_avg}%</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={parseFloat(c.cpu_max) >= 90 ? 'text-red-400' : parseFloat(c.cpu_max) >= 75 ? 'text-orange-400' : 'text-[var(--c-muted)]'}>
                        {c.cpu_max}%
                      </span>
                    </td>
                    <td className="px-4 py-2 w-48"><UsageBar pct={parseFloat(c.cpu_max)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <MemoryStick size={14} className="text-purple-400" /> 메모리 용량
        </h2>
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
          {memTop.length === 0 ? (
            <p className="text-xs text-[var(--c-faint)] p-4">데이터 없음</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)]">
                  {['서버', '30일 평균', '30일 최대', '사용률'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs text-[var(--c-muted)] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memTop.map((m, i) => (
                  <tr key={i} className="border-b border-[var(--c-border)]/50">
                    <td className="px-4 py-2 text-xs font-medium text-[var(--c-text)]">{m.asset_name}</td>
                    <td className="px-4 py-2 text-xs text-[var(--c-muted)]">{m.mem_avg}%</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={parseFloat(m.mem_max) >= 90 ? 'text-red-400' : parseFloat(m.mem_max) >= 75 ? 'text-orange-400' : 'text-[var(--c-muted)]'}>
                        {m.mem_max}%
                      </span>
                    </td>
                    <td className="px-4 py-2 w-48"><UsageBar pct={parseFloat(m.mem_max)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <HardDrive size={14} className="text-orange-400" /> 스토리지 용량
        </h2>
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
          {storageTop.length === 0 ? (
            <p className="text-xs text-[var(--c-faint)] p-4">데이터 없음</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)]">
                  {['장비', '볼륨', '사용량', '총 용량', '사용률'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs text-[var(--c-muted)] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storageTop.map((s, i) => (
                  <tr key={i} className="border-b border-[var(--c-border)]/50">
                    <td className="px-4 py-2 text-xs font-medium text-[var(--c-text)]">{s.asset_name}</td>
                    <td className="px-4 py-2 text-xs font-mono text-[var(--c-muted)]">{s.volume_name}</td>
                    <td className="px-4 py-2 text-xs text-[var(--c-muted)]">{parseFloat(s.used_gb) >= 1024 ? `${(parseFloat(s.used_gb) / 1024).toFixed(1)} TB` : `${s.used_gb} GB`}</td>
                    <td className="px-4 py-2 text-xs text-[var(--c-muted)]">{parseFloat(s.total_gb) >= 1024 ? `${(parseFloat(s.total_gb) / 1024).toFixed(1)} TB` : `${s.total_gb} GB`}</td>
                    <td className="px-4 py-2 w-40"><UsageBar pct={parseFloat(s.pct)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 4. LLM 예측 이력 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Brain size={14} className="text-purple-400" /> AI 예측 이력 (최근 {period}일)
        </h2>
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)]">
                {['자산', '시각', '유형', '심각도', '신뢰도', '요약', '알림'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-[var(--c-muted)] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {predictions.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[var(--c-faint)] text-xs">예측 이력이 없습니다</td></tr>
              ) : predictions.map((p, i) => (
                <tr key={i} className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)]">
                  <td className="px-4 py-2.5 font-medium text-[var(--c-text)]">{p.asset_name}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--c-muted)]">
                    {new Date(p.predicted_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--c-muted)]">{ISSUE_LABEL[p.issue_type] ?? p.issue_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] border ${SEVERITY_COLOR[p.severity] ?? ''}`}>
                      {p.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--c-muted)]">{Math.round(parseFloat(p.confidence) * 100)}%</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--c-muted)] max-w-xs truncate">{p.summary}</td>
                  <td className="px-4 py-2.5">
                    {p.alert_sent
                      ? <CheckCircle size={12} className="text-green-400" />
                      : <span className="text-[var(--c-faint)] text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
