'use client'

import { useEffect, useState, useCallback } from 'react'
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle, Users, FileText, Server, Building2, Printer, X, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ComplianceData {
  assetCompleteness: { total: number; with_manager: number; with_contract: number; with_org: number }
  incidentMetrics: { total: number; resolved: number; avg_mttr_minutes: number; open: number }
  accessControl: { total_users: number; admin_count: number; operator_count: number; readonly_count: number; locked_count: number }
  auditSummary: { action: string; cnt: number }[]
  auditTotal: number
  agentCoverage: { total_servers: number; with_agent: number }
}

interface DetailModal {
  title: string
  rows: Record<string, unknown>[]
  loading: boolean
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 100)
}

function ProgressBar({ value, color = 'bg-cyan-400' }: { value: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-[var(--c-bg)] rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  )
}

function ScoreCard({ label, value, total, icon, color, onClick }: {
  label: string; value: number; total: number; icon: React.ReactNode; color: string; onClick?: () => void
}) {
  const p = pct(value, total)
  const barColor = p >= 80 ? 'bg-green-400' : p >= 50 ? 'bg-orange-400' : 'bg-red-400'

  return (
    <div
      className={`p-4 rounded-xl bg-[var(--c-card)] border border-[var(--c-border)] ${onClick ? 'cursor-pointer hover:border-cyan-500/50 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={color}>{icon}</span>
        <span className="text-xs text-[var(--c-faint)]">{label}</span>
      </div>
      <div className="flex items-end justify-between mb-2">
        <span className="text-2xl font-bold text-[var(--c-text)]">{p}%</span>
        <span className="text-xs text-[var(--c-muted)]">{value} / {total}</span>
      </div>
      <ProgressBar value={p} color={barColor} />
    </div>
  )
}

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400',
}
const STATUS_LABEL: Record<string, string> = {
  open: '미해결', investigating: '조사중', resolved: '해결됨',
}

function formatMttr(minutes: number | null) {
  if (minutes == null) return '-'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

function DetailTable({ rows, router }: { rows: Record<string, unknown>[]; router: ReturnType<typeof useRouter> }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--c-faint)] py-4 text-center">데이터가 없습니다</p>

  const cols = Object.keys(rows[0])
  const HEADER: Record<string, string> = {
    id: 'ID', hostname: '장비명', type: '유형', ip_address: 'IP', manager: '담당자',
    user_team: '사용팀', title: '제목', severity: '심각도', status: '상태',
    opened_at: '발생일', resolved_at: '해결일', mttr_minutes: '처리시간',
    username: '계정', display_name: '이름', role: '역할', locked_until: '잠금해제',
  }

  const handleRowClick = (row: Record<string, unknown>) => {
    if (row.hostname && row.type) router.push(`/assets`)
    else if (row.title && row.severity) router.push(`/incidents`)
    else if (row.username && row.role) router.push(`/settings/users`)
  }

  return (
    <div className="max-h-[400px] overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[var(--c-card)]">
          <tr>
            {cols.filter(c => c !== 'id').map(col => (
              <th key={col} className="px-3 py-2 text-left text-[var(--c-faint)] font-medium border-b border-[var(--c-border)]">
                {HEADER[col] || col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="hover:bg-[var(--c-bg)] cursor-pointer transition-colors"
              onClick={() => handleRowClick(row)}
            >
              {cols.filter(c => c !== 'id').map(col => {
                const val = row[col]
                let display: React.ReactNode = val == null ? '-' : String(val)
                if (col === 'severity') display = <span className={SEV_COLOR[String(val)] || ''}>{String(val)}</span>
                if (col === 'status') display = STATUS_LABEL[String(val)] || String(val)
                if (col === 'mttr_minutes') display = formatMttr(val as number | null)
                if ((col === 'opened_at' || col === 'resolved_at' || col === 'locked_until') && val) {
                  display = new Date(String(val)).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                }
                return (
                  <td key={col} className="px-3 py-2 text-[var(--c-text)] border-b border-[var(--c-border)]/30">
                    {display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CompliancePage() {
  const router = useRouter()
  const [data, setData] = useState<ComplianceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<DetailModal | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports/compliance')
      const json = await res.json()
      if (!json.error) setData(json)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = async (type: string) => {
    setDetail({ title: '로딩 중...', rows: [], loading: true })
    try {
      const res = await fetch(`/api/reports/compliance?detail=${type}`)
      const json = await res.json()
      setDetail({ title: json.title || type, rows: json.rows || [], loading: false })
    } catch {
      setDetail(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--c-faint)]">
        <RefreshCw size={18} className="animate-spin mr-2" /> 컴플라이언스 리포트 생성 중...
      </div>
    )
  }

  if (!data) return null

  const { assetCompleteness: ac, incidentMetrics: im, accessControl: uc, auditSummary, auditTotal, agentCoverage: ag } = data
  const mttrHours = Math.floor(im.avg_mttr_minutes / 60)
  const mttrMins  = im.avg_mttr_minutes % 60

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <ShieldCheck size={20} className="text-green-400" /> 컴플라이언스 리포트
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">ISMS 대응 · 자산 완성도 · 접근 제어 · 감사 로그</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">
            <Printer size={14} /> 인쇄
          </button>
        </div>
      </div>

      {/* 생성일 (인쇄용) */}
      <p className="hidden print:block text-xs text-[var(--c-faint)]">
        생성일: {new Date().toLocaleString('ko-KR')}
      </p>

      {/* 1. 자산 완성도 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Building2 size={16} className="text-cyan-400" /> 자산 관리 완성도
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <ScoreCard label="전체 자산" value={ac.total} total={ac.total} icon={<Server size={16} />} color="text-cyan-400" onClick={() => openDetail('assets_all')} />
          <ScoreCard label="담당자 지정" value={ac.with_manager} total={ac.total} icon={<Users size={16} />} color="text-purple-400" onClick={() => openDetail('assets_no_manager')} />
          <ScoreCard label="유지보수 계약" value={ac.with_contract} total={ac.total} icon={<FileText size={16} />} color="text-green-400" onClick={() => openDetail('assets_no_contract')} />
          <ScoreCard label="조직 배정" value={ac.with_org} total={ac.total} icon={<Building2 size={16} />} color="text-orange-400" onClick={() => openDetail('assets_no_org')} />
        </div>
      </section>

      {/* 2. 장애 내역 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-orange-400" /> 장애 내역 (최근 90일)
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: '총 장애', value: im.total, color: 'text-[var(--c-text)]', detail: 'incidents_all' },
            { label: '해결됨', value: im.resolved, color: 'text-green-400', detail: 'incidents_resolved' },
            { label: '미해결', value: im.open, color: im.open > 0 ? 'text-red-400' : 'text-green-400', detail: 'incidents_open' },
            { label: '평균장애처리 시간', value: mttrHours > 0 ? `${mttrHours}h ${mttrMins}m` : `${mttrMins}m`, color: 'text-cyan-400', detail: '' },
          ].map((s, i) => (
            <div
              key={i}
              className={`p-4 rounded-xl bg-[var(--c-card)] border border-[var(--c-border)] ${s.detail ? 'cursor-pointer hover:border-cyan-500/50 transition-colors' : ''}`}
              onClick={s.detail ? () => openDetail(s.detail) : undefined}
            >
              <p className="text-xs text-[var(--c-faint)]">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. 접근 제어 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Users size={16} className="text-purple-400" /> 접근 제어 현황
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: '전체 사용자', value: uc.total_users, color: 'text-[var(--c-text)]', detail: '' },
            { label: '관리자', value: uc.admin_count, color: 'text-red-400', detail: 'users_admin' },
            { label: '운영자', value: uc.operator_count, color: 'text-orange-400', detail: 'users_operator' },
            { label: '읽기전용', value: uc.readonly_count, color: 'text-green-400', detail: 'users_readonly' },
            { label: '잠긴 계정', value: uc.locked_count, color: uc.locked_count > 0 ? 'text-red-400' : 'text-green-400', detail: 'users_locked' },
          ].map((s, i) => (
            <div
              key={i}
              className={`p-4 rounded-xl bg-[var(--c-card)] border border-[var(--c-border)] ${s.detail ? 'cursor-pointer hover:border-cyan-500/50 transition-colors' : ''}`}
              onClick={s.detail ? () => openDetail(s.detail) : undefined}
            >
              <p className="text-xs text-[var(--c-faint)]">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. 에이전트 커버리지 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <Server size={16} className="text-cyan-400" /> 모니터링 커버리지
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <ScoreCard label="Agent 설치율 (서버)" value={ag.with_agent} total={ag.total_servers} icon={<CheckCircle size={16} />} color="text-green-400" onClick={() => openDetail('servers_no_agent')} />
          <ScoreCard label="장애 해결율" value={im.resolved} total={im.total} icon={<CheckCircle size={16} />} color="text-green-400" onClick={() => openDetail('incidents_resolved')} />
        </div>
      </section>

      {/* 5. 감사 로그 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--c-text)] mb-3 flex items-center gap-2">
          <FileText size={16} className="text-green-400" /> 감사 로그 요약 (최근 30일)
        </h2>
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-[var(--c-text)]">총 {auditTotal.toLocaleString()}건</p>
            <button
              onClick={() => router.push('/security/audit')}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              상세 보기 <ExternalLink size={12} />
            </button>
          </div>
          {auditSummary.length === 0 ? (
            <p className="text-sm text-[var(--c-faint)]">감사 로그가 없습니다</p>
          ) : (
            <div className="space-y-2">
              {auditSummary.map((a, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--c-text)] w-32 truncate">{a.action}</span>
                  <div className="flex-1">
                    <ProgressBar value={pct(a.cnt, auditTotal)} color="bg-cyan-400" />
                  </div>
                  <span className="text-xs text-[var(--c-muted)] w-16 text-right">{a.cnt}건</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 세부 내역 모달 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 print:hidden" onClick={() => setDetail(null)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-[700px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--c-border)]">
              <h3 className="text-sm font-semibold text-[var(--c-text)]">{detail.title}</h3>
              <button onClick={() => setDetail(null)} className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4">
              {detail.loading ? (
                <div className="flex items-center justify-center py-8 text-[var(--c-faint)]">
                  <RefreshCw size={16} className="animate-spin mr-2" /> 조회 중...
                </div>
              ) : (
                <>
                  <p className="text-xs text-[var(--c-muted)] mb-3">{detail.rows.length}건</p>
                  <DetailTable rows={detail.rows} router={router} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
