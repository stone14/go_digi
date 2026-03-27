'use client'

import { useEffect, useState, useCallback } from 'react'
import { History, RefreshCw, Search } from 'lucide-react'

interface Change {
  id: number; asset_id: number | null; asset_name: string | null
  field_name: string; old_value: string | null; new_value: string | null
  changed_by: string | null; note: string | null; changed_at: string
}

const FIELD_LABEL: Record<string, string> = {
  status:              '상태',
  location:            '위치',
  ip_address:          'IP 주소',
  os_type:             'OS',
  monitoring_enabled:  '모니터링',
  lifecycle_status:    '라이프사이클',
  hostname:            '호스트명',
  asset_type:          '장비 유형',
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)     return `${diff}초 전`
  if (diff < 3600)   return `${Math.floor(diff/60)}분 전`
  if (diff < 86400)  return `${Math.floor(diff/3600)}시간 전`
  return `${Math.floor(diff/86400)}일 전`
}

export default function ChangesPage() {
  const [changes, setChanges]   = useState<Change[]>([])
  const [search,  setSearch]    = useState('')
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/assets/changes?limit=200')
      const data = await res.json()
      setChanges(data.changes ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = changes.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.asset_name?.toLowerCase().includes(q) ||
      c.field_name?.toLowerCase().includes(q) ||
      c.changed_by?.toLowerCase().includes(q) ||
      c.note?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <History size={20} className="text-orange-400" /> 변경 이력
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">자산 설정 · 상태 변경 이력</p>
        </div>
        <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)]">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 이력',    value: changes.length,                                                              color: 'text-[var(--c-text)]' },
          { label: '오늘 변경',    value: changes.filter(c => new Date(c.changed_at).toDateString() === new Date().toDateString()).length, color: 'text-orange-400' },
          { label: '이번 주 변경', value: changes.filter(c => Date.now() - new Date(c.changed_at).getTime() < 7*86400000).length, color: 'text-cyan-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" size={14} />
        <input type="text" placeholder="장비명, 변경 항목, 담당자 검색..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-orange-500" />
      </div>

      {/* Timeline */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)]">
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">시간</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">장비</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">변경 항목</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">변경 전</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">변경 후</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">담당자</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">메모</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-[var(--c-faint)]">
                <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-[var(--c-faint)]">이력 없음</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)]">
                <td className="px-4 py-3 text-xs text-[var(--c-faint)] whitespace-nowrap">
                  <div>{timeAgo(c.changed_at)}</div>
                  <div className="text-[10px]">{c.changed_at.slice(0,16).replace('T',' ')}</div>
                </td>
                <td className="px-4 py-3 text-xs font-medium text-[var(--c-text)]">{c.asset_name || '—'}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-orange-400/10 text-orange-400">
                    {FIELD_LABEL[c.field_name] ?? c.field_name}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-red-400/80 line-through">{c.old_value || '—'}</td>
                <td className="px-4 py-3 text-xs text-green-400">{c.new_value || '—'}</td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{c.changed_by || '—'}</td>
                <td className="px-4 py-3 text-xs text-[var(--c-faint)]">{c.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
