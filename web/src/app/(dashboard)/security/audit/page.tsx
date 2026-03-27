'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Search, RefreshCw, Download, Filter, ChevronLeft, ChevronRight } from 'lucide-react'

interface AuditLog {
  id: number
  user_id: number | null
  username: string | null
  action: string
  target_type: string | null
  target_id: number | null
  detail: Record<string, unknown> | null
  ip_address: string | null
  occurred_at: string
}

const ACTION_COLOR: Record<string, string> = {
  login:  'bg-green-500/20 text-green-400',
  logout: 'bg-[var(--c-border)] text-[var(--c-muted)]',
  create: 'bg-cyan-500/20 text-cyan-400',
  update: 'bg-purple-500/20 text-purple-400',
  delete: 'bg-red-500/20 text-red-400',
  import: 'bg-orange-500/20 text-orange-400',
}

function actionColor(action: string): string {
  const key = Object.keys(ACTION_COLOR).find(k => action.toLowerCase().includes(k))
  return key ? ACTION_COLOR[key] : 'bg-[var(--c-border)] text-[var(--c-muted)]'
}

const PAGE_SIZE = 50

export default function AuditLogPage() {
  const [logs, setLogs]         = useState<AuditLog[]>([])
  const [total, setTotal]       = useState(0)
  const [actions, setActions]   = useState<string[]>([])
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(0)
  const [search, setSearch]     = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
      if (search) params.set('search', search)
      if (actionFilter) params.set('action', actionFilter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)

      const res = await fetch(`/api/audit?${params}`)
      const data = await res.json()
      setLogs(data.logs ?? [])
      setTotal(data.total ?? 0)
      if (data.actions) setActions(data.actions)
    } finally {
      setLoading(false)
    }
  }, [page, search, actionFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const exportCSV = () => {
    const header = '시간,사용자,액션,대상 유형,대상 ID,IP,상세'
    const rows = logs.map(l => [
      l.occurred_at,
      l.username || '',
      l.action,
      l.target_type || '',
      l.target_id || '',
      l.ip_address || '',
      l.detail ? JSON.stringify(l.detail) : '',
    ].join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-cyan-400" />
          <h1 className="text-xl font-bold text-[var(--c-text)]">감사 로그</h1>
          <span className="text-sm text-[var(--c-muted)]">{total.toLocaleString()}건</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">
            <Download size={14} /> CSV
          </button>
          <button onClick={load} className="p-2 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-faint)]" />
            <input
              className="w-full pl-9 pr-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)]"
              placeholder="사용자, 액션, 대상 검색..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
            />
          </div>
        </div>
        <div>
          <select
            className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)]"
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(0) }}
          >
            <option value="">모든 액션</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)]" />
          <span className="text-[var(--c-faint)]">~</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
            className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)]" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--c-hover)] border-b border-[var(--c-border)]">
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold">시간</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold">사용자</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold">액션</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold">대상</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold">IP</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-border)]/50">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-[var(--c-faint)]">로딩 중...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-[var(--c-faint)]">감사 로그가 없습니다</td></tr>
              ) : logs.map(log => (
                <tr key={log.id} className="hover:bg-[var(--c-hover)] transition-colors">
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)] whitespace-nowrap">
                    {new Date(log.occurred_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-text)]">
                    {log.username || <span className="text-[var(--c-faint)]">시스템</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                    {log.target_type && (
                      <span>{log.target_type}{log.target_id ? ` #${log.target_id}` : ''}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-faint)] font-mono">{log.ip_address || '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--c-faint)] max-w-[300px] truncate">
                    {log.detail ? JSON.stringify(log.detail) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--c-border)]">
            <p className="text-xs text-[var(--c-faint)]">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded hover:bg-[var(--c-hover)] disabled:opacity-30 text-[var(--c-muted)]"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-[var(--c-muted)] px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded hover:bg-[var(--c-hover)] disabled:opacity-30 text-[var(--c-muted)]"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
