'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Bell, RefreshCw, Search, CheckCheck, XCircle,
  AlertTriangle, Info, ShieldAlert, Clock, Filter,
} from 'lucide-react'

interface Alert {
  id: number
  asset_id: number
  asset_name: string | null
  severity: string
  title: string
  message: string
  source: string
  status: string
  created_at: string
  resolved_at: string | null
  acknowledged_at: string | null
}

const SEV_CONFIG = {
  critical: { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/20',    icon: ShieldAlert },
  warning:  { color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20', icon: AlertTriangle },
  info:     { color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/20',   icon: Info },
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:       { label: '활성',   color: 'text-red-400'    },
  acknowledged: { label: '확인됨', color: 'text-[var(--c-muted)]' },
  resolved:     { label: '해결됨', color: 'text-[var(--c-muted)]' },
}

function timeAgo(ts: string) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 60)    return `${secs}초 전`
  if (secs < 3600)  return `${Math.floor(secs/60)}분 전`
  if (secs < 86400) return `${Math.floor(secs/3600)}시간 전`
  return `${Math.floor(secs/86400)}일 전`
}

export default function AlertsPage() {
  const [alerts,      setAlerts]      = useState<Alert[]>([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Set<number>>(new Set())

  const [status,   setStatus]   = useState('active')
  const [severity, setSeverity] = useState('')
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(1)
  const LIMIT = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String((page-1)*LIMIT) })
      if (status)   params.set('status',   status)
      if (severity) params.set('severity', severity)
      if (search)   params.set('search',   search)
      const res  = await fetch(`/api/alerts?${params}`)
      const data = await res.json()
      setAlerts(data.alerts ?? [])
      setTotal(data.total  ?? 0)
    } finally {
      setLoading(false)
    }
  }, [status, severity, search, page])

  useEffect(() => { load() }, [load])

  async function bulkAction(action: 'ack' | 'resolve') {
    if (selected.size === 0) return
    await Promise.all(Array.from(selected).map(id =>
      fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
    ))
    setSelected(new Set())
    load()
  }

  async function singleAction(id: number, action: 'ack' | 'resolve') {
    await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    load()
  }

  const toggleSelect = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected(selected.size === alerts.length ? new Set() : new Set(alerts.map(a => a.id)))

  const critical = alerts.filter(a => a.severity === 'critical').length
  const warning  = alerts.filter(a => a.severity === 'warning').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Bell className="text-red-400" size={20} />
            알림 현황
          </h1>
          <p className="text-[var(--c-muted)] text-sm mt-0.5">실시간 알림 모니터링 · ACK · 해결 처리</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <button onClick={() => bulkAction('ack')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white text-sm">
                <CheckCheck size={14} />확인 ({selected.size})
              </button>
              <button onClick={() => bulkAction('resolve')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm">
                <XCircle size={14} />해결 ({selected.size})
              </button>
            </>
          )}
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />새로고침
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체',     value: total,   color: 'text-[var(--c-text)]', onClick: () => setStatus('') },
          { label: 'Critical', value: critical, color: 'text-red-400',        onClick: () => setSeverity('critical') },
          { label: 'Warning',  value: warning,  color: 'text-[var(--c-text)]', onClick: () => setSeverity('warning') },
          { label: '활성',     value: alerts.filter(a=>a.status==='active').length, color: 'text-red-400', onClick: () => setStatus('active') },
        ].map(s => (
          <button key={s.label} onClick={s.onClick}
            className="bg-[var(--c-card)] border border-[var(--c-border)] hover:border-cyan-500/40 rounded-xl p-4 text-left transition-colors">
            <p className="text-[var(--c-muted)] text-xs">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="flex bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg overflow-hidden">
          {['active','acknowledged','resolved',''].map((s, i) => (
            <button key={i} onClick={() => setStatus(s)}
              className={`px-4 py-2 text-sm transition-colors
                ${status === s ? 'bg-[var(--c-border)] text-[var(--c-text)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}>
              {s === '' ? '전체' : s === 'active' ? '활성' : s === 'acknowledged' ? '확인됨' : '해결됨'}
            </button>
          ))}
        </div>

        <select value={severity} onChange={e => setSeverity(e.target.value)}
          className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
          <option value="">전체 심각도</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" size={14} />
          <input type="text" placeholder="제목, 메시지, 장비명 검색..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Alerts Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] bg-[var(--c-hover)]">
              <th className="px-4 py-3 w-8">
                <input type="checkbox"
                  checked={selected.size === alerts.length && alerts.length > 0}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded accent-cyan-500"
                />
              </th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">심각도</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">제목</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">장비</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">소스</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">상태</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">발생</th>
              <th className="px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">
                <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
              </td></tr>
            ) : alerts.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">
                <Bell size={32} className="mx-auto mb-2 opacity-20" />
                알림이 없습니다
              </td></tr>
            ) : alerts.map(alert => {
              const sevCfg = SEV_CONFIG[alert.severity as keyof typeof SEV_CONFIG] ?? SEV_CONFIG.info
              const Icon = sevCfg.icon
              const stCfg = STATUS_LABEL[alert.status] ?? { label: alert.status, color: 'text-[var(--c-muted)]' }

              return (
                <tr key={alert.id}
                  className={`border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors
                    ${selected.has(alert.id) ? 'bg-[var(--c-hover)]' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(alert.id)}
                      onChange={() => toggleSelect(alert.id)}
                      className="w-4 h-4 rounded accent-cyan-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium ${sevCfg.bg} ${sevCfg.color}`}>
                      <Icon size={10} />
                      {alert.severity.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[var(--c-text)] font-medium">{alert.title}</p>
                    <p className="text-[var(--c-faint)] text-xs truncate max-w-[280px]">{alert.message}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{alert.asset_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-[var(--c-border)] text-[var(--c-muted)] text-xs">{alert.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${stCfg.color}`}>{stCfg.label}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--c-muted)] text-xs">
                    <div>{timeAgo(alert.created_at)}</div>
                    <div className="text-[var(--c-faint)]">
                      {new Date(alert.created_at).toLocaleString('ko-KR', { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {alert.status === 'active' && (
                        <button onClick={() => singleAction(alert.id, 'ack')}
                          className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-0.5">
                          <CheckCheck size={12} />ACK
                        </button>
                      )}
                      {alert.status !== 'resolved' && (
                        <button onClick={() => singleAction(alert.id, 'resolve')}
                          className="text-xs text-green-400 hover:text-green-300 flex items-center gap-0.5">
                          <XCircle size={12} />해결
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--c-border)]">
            <p className="text-[var(--c-muted)] text-xs">
              {(page-1)*LIMIT + 1}–{Math.min(page*LIMIT, total)} / {total}개
            </p>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="px-3 py-1 rounded bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-xs disabled:opacity-30">이전</button>
              <button onClick={() => setPage(p => p+1)} disabled={page * LIMIT >= total}
                className="px-3 py-1 rounded bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-xs disabled:opacity-30">다음</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
