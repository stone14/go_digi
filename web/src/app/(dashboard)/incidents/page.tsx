'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  AlertTriangle, Plus, Search, RefreshCw, Download,
  ChevronDown, ChevronUp, Send, User, Clock,
  CheckCircle, Activity, X,
} from 'lucide-react'

interface Incident {
  id: number
  title: string
  severity: 'critical' | 'major' | 'minor'
  status: 'open' | 'investigating' | 'resolved'
  assigned_name: string | null
  root_cause: string | null
  resolution: string | null
  opened_at: string
  resolved_at: string | null
  timeline_count: number
}

interface TimelineEntry {
  id: number
  event_type: string
  content: string | null
  occurred_at: string
  username: string | null
}

const SEV_STYLE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  major:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
  minor:    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}
const STATUS_STYLE: Record<string, string> = {
  open:          'bg-red-500/20 text-red-400',
  investigating: 'bg-orange-500/20 text-orange-400',
  resolved:      'bg-green-500/20 text-green-400',
}
const STATUS_LABEL: Record<string, string> = {
  open: '오픈', investigating: '조사 중', resolved: '해결됨',
}
const EVENT_ICON: Record<string, React.ReactNode> = {
  comment:       <Send size={12} className="text-cyan-400" />,
  status_change: <Activity size={12} className="text-orange-400" />,
  assigned:      <User size={12} className="text-purple-400" />,
  alert_linked:  <AlertTriangle size={12} className="text-yellow-400" />,
}

const EMPTY = { title: '', severity: 'major', asset_ids: [], alert_ids: [] }

function fmtDuration(from: string, to?: string | null) {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()
  const h  = Math.floor(ms / 3600000)
  const m  = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function IncidentsPage() {
  const [incidents, setIncidents]   = useState<Incident[]>([])
  const [loading,   setLoading]     = useState(true)
  const [search,    setSearch]      = useState('')
  const [statusF,   setStatusF]     = useState('')
  const [sevF,      setSevF]        = useState('')
  const [expanded,  setExpanded]    = useState<number | null>(null)
  const [timeline,  setTimeline]    = useState<TimelineEntry[]>([])
  const [comment,   setComment]     = useState('')
  const [rootCause, setRootCause]   = useState('')
  const [resolution,setResolution]  = useState('')
  const [showNew,   setShowNew]     = useState(false)
  const [newForm,   setNewForm]     = useState<typeof EMPTY>({ ...EMPTY })
  const [stats,     setStats]       = useState({ open: 0, investigating: 0, resolved: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusF) params.set('status', statusF)
      if (sevF)    params.set('severity', sevF)
      if (search)  params.set('search', search)
      const res  = await fetch(`/api/incidents?${params}`)
      const data = await res.json()
      const list: Incident[] = data.incidents ?? []
      setIncidents(list)
      setStats({
        open:          list.filter(i => i.status === 'open').length,
        investigating: list.filter(i => i.status === 'investigating').length,
        resolved:      list.filter(i => i.status === 'resolved').length,
      })
    } finally { setLoading(false) }
  }, [statusF, sevF, search])

  useEffect(() => { load() }, [load])

  const loadTimeline = async (id: number) => {
    const res  = await fetch(`/api/incidents/timeline?incident_id=${id}`)
    const data = await res.json()
    setTimeline(data.timeline ?? [])
  }

  const expand = async (id: number) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    const inc = incidents.find(i => i.id === id)
    setRootCause(inc?.root_cause ?? '')
    setResolution(inc?.resolution ?? '')
    await loadTimeline(id)
  }

  const doAction = async (id: number, action: string, extra?: Record<string, unknown>) => {
    await fetch('/api/incidents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, ...extra }),
    })
    await load()
    if (expanded === id) await loadTimeline(id)
  }

  const sendComment = async (id: number) => {
    if (!comment.trim()) return
    await doAction(id, 'comment', { content: comment })
    setComment('')
  }

  const saveDetail = async (id: number) => {
    await doAction(id, 'update', { root_cause: rootCause, resolution })
  }

  const createIncident = async () => {
    if (!newForm.title) return
    await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newForm),
    })
    setShowNew(false)
    setNewForm({ ...EMPTY })
    load()
  }

  const exportExcel = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('장애내역')

    // Header styling
    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F1629' } }
    const headerFont = { color: { argb: 'FF00D4FF' }, bold: true, size: 11 }
    ws.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: '제목', key: 'title', width: 40 },
      { header: '심각도', key: 'severity', width: 12 },
      { header: '상태', key: 'status', width: 12 },
      { header: '담당자', key: 'assigned_name', width: 15 },
      { header: '근본원인', key: 'root_cause', width: 40 },
      { header: '해결방법', key: 'resolution', width: 40 },
      { header: '발생시간', key: 'opened_at', width: 20 },
      { header: '해결시간', key: 'resolved_at', width: 20 },
      { header: 'MTTR', key: 'mttr', width: 12 },
    ]
    ws.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont })

    for (const inc of incidents) {
      ws.addRow({
        id: inc.id,
        title: inc.title,
        severity: inc.severity,
        status: STATUS_LABEL[inc.status] || inc.status,
        assigned_name: inc.assigned_name || '',
        root_cause: inc.root_cause || '',
        resolution: inc.resolution || '',
        opened_at: new Date(inc.opened_at).toLocaleString('ko-KR'),
        resolved_at: inc.resolved_at ? new Date(inc.resolved_at).toLocaleString('ko-KR') : '',
        mttr: inc.resolved_at ? fmtDuration(inc.opened_at, inc.resolved_at) : '',
      })
    }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `incidents_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <AlertTriangle size={20} className="text-orange-400" /> 장애내역 관리
          </h1>
          <p className="text-xs text-[var(--c-muted)] mt-0.5">장애 추적 · 타임라인 · 이력 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--c-card)] text-[var(--c-muted)] border border-[var(--c-border)] rounded-lg text-xs hover:text-[var(--c-text)] transition-colors">
            <Download size={13} /> 내보내기
          </button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg text-xs hover:bg-orange-500/30 transition-colors">
            <Plus size={13} /> 장애내역 생성
          </button>
        </div>
      </div>

      {/* 스탯 카드 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '오픈',    count: stats.open,          color: 'text-red-400',           val: 'open' },
          { label: '조사 중', count: stats.investigating, color: 'text-[var(--c-text)]',   val: 'investigating' },
          { label: '해결됨',  count: stats.resolved,      color: 'text-[var(--c-text)]',   val: 'resolved' },
        ].map(s => (
          <button key={s.val} onClick={() => setStatusF(statusF === s.val ? '' : s.val)}
            className={`bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4 text-left transition-all hover:border-cyan-500/40 ${statusF === s.val ? 'ring-1 ring-cyan-500/30' : ''}`}>
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="장애내역 검색..."
            className="w-full pl-8 pr-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500" />
        </div>
        <select value={sevF} onChange={e => setSevF(e.target.value)}
          className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
          <option value="">전체 심각도</option>
          <option value="critical">Critical</option>
          <option value="major">Major</option>
          <option value="minor">Minor</option>
        </select>
      </div>

      {/* 장애내역 목록 */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 text-[var(--c-faint)]">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" /> 로딩 중...
          </div>
        ) : incidents.length === 0 ? (
          <div className="text-center py-12 text-[var(--c-faint)]">
            <CheckCircle size={32} className="mx-auto mb-2 opacity-30" />
            <p>장애내역 없음</p>
          </div>
        ) : incidents.map(inc => (
          <div key={inc.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-[var(--c-hover)] transition-colors"
              onClick={() => expand(inc.id)}>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${SEV_STYLE[inc.severity]}`}>
                {inc.severity}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--c-text)] truncate">{inc.title}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[inc.status]}`}>
                    {STATUS_LABEL[inc.status]}
                  </span>
                  <span className="text-[10px] text-[var(--c-faint)] flex items-center gap-1">
                    <Clock size={10} />
                    {fmtDuration(inc.opened_at, inc.resolved_at)}
                  </span>
                  {inc.assigned_name && (
                    <span className="text-[10px] text-[var(--c-faint)] flex items-center gap-1">
                      <User size={10} /> {inc.assigned_name}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--c-faint)]">{inc.timeline_count}개 이벤트</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                {inc.status === 'open' && (
                  <button onClick={() => doAction(inc.id, 'status', { content: 'investigating' })}
                    className="text-[10px] px-2 py-1 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded hover:bg-orange-500/30 transition-colors">
                    조사 시작
                  </button>
                )}
                {inc.status === 'investigating' && (
                  <button onClick={() => doAction(inc.id, 'status', { content: 'resolved' })}
                    className="text-[10px] px-2 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors">
                    해결 완료
                  </button>
                )}
                {expanded === inc.id
                  ? <ChevronUp size={14} className="text-[var(--c-muted)]" />
                  : <ChevronDown size={14} className="text-[var(--c-muted)]" />}
              </div>
            </div>

            {expanded === inc.id && (
              <div className="border-t border-[var(--c-border)] grid grid-cols-2 gap-0">
                <div className="p-4 border-r border-[var(--c-border)] space-y-3">
                  <p className="text-xs font-medium text-[var(--c-muted)]">근본 원인</p>
                  <textarea value={rootCause} onChange={e => setRootCause(e.target.value)}
                    rows={3} placeholder="원인 분석 내용..."
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500 resize-none" />
                  <p className="text-xs font-medium text-[var(--c-muted)]">해결 방법</p>
                  <textarea value={resolution} onChange={e => setResolution(e.target.value)}
                    rows={3} placeholder="해결 조치 사항..."
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500 resize-none" />
                  <button onClick={() => saveDetail(inc.id)}
                    className="px-3 py-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg text-xs hover:bg-cyan-500/30 transition-colors">
                    저장
                  </button>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  <p className="text-xs font-medium text-[var(--c-muted)]">타임라인</p>
                  <div className="flex-1 space-y-2 max-h-48 overflow-y-auto">
                    {timeline.map(t => (
                      <div key={t.id} className="flex gap-2 text-xs">
                        <div className="mt-0.5 shrink-0">
                          {EVENT_ICON[t.event_type] ?? <Clock size={12} className="text-[var(--c-muted)]" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-[var(--c-text)]">{t.content}</p>
                          <p className="text-[var(--c-faint)] text-[10px] mt-0.5">
                            {t.username ?? '시스템'} · {new Date(t.occurred_at).toLocaleString('ko-KR')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-auto">
                    <input value={comment} onChange={e => setComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendComment(inc.id)}
                      placeholder="코멘트 추가..."
                      className="flex-1 px-3 py-1.5 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-xs text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500" />
                    <button onClick={() => sendComment(inc.id)}
                      className="p-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 transition-colors">
                      <Send size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 새 장애내역 모달 */}
      {showNew && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--c-text)]">장애내역 생성</h2>
              <button onClick={() => setShowNew(false)} className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">제목 *</label>
                <input value={newForm.title} onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="장애내역 제목"
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">심각도</label>
                <select value={newForm.severity} onChange={e => setNewForm(p => ({ ...p, severity: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
                  <option value="critical">Critical</option>
                  <option value="major">Major</option>
                  <option value="minor">Minor</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowNew(false)}
                className="flex-1 py-2 text-sm text-[var(--c-muted)] border border-[var(--c-border)] rounded-lg hover:text-[var(--c-text)] transition-colors">
                취소
              </button>
              <button onClick={createIncident}
                className="flex-1 py-2 text-sm bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg hover:bg-orange-500/30 transition-colors">
                생성
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
