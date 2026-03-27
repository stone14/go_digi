'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Activity, Plus, Trash2, RefreshCw, CheckCircle,
  XCircle, HelpCircle, Globe, Wifi, Search, ChevronDown,
} from 'lucide-react'

interface ServiceCheck {
  id: number
  asset_id: number
  asset_name: string
  asset_ip: string
  name: string
  type: string
  target: string
  timeout_s: number
  expected_code: number | null
  expected_body: string | null
  is_active: boolean
  status: string
  response_ms: number | null
  checked_at: string | null
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  http:  <Globe    size={12} className="text-cyan-400" />,
  https: <Globe    size={12} className="text-cyan-400" />,
  tcp:   <Wifi     size={12} className="text-purple-400" />,
  dns:   <Search   size={12} className="text-orange-400" />,
  ping:  <Activity size={12} className="text-green-400" />,
}

const STATUS_CFG = {
  up:      { icon: <CheckCircle size={13} className="text-green-400" />,  text: 'UP',      cls: 'text-green-400'  },
  down:    { icon: <XCircle     size={13} className="text-red-400" />,    text: 'DOWN',    cls: 'text-red-400'    },
  unknown: { icon: <HelpCircle  size={13} className="text-[var(--c-muted)]" />, text: '?', cls: 'text-[var(--c-muted)]' },
}

const EMPTY_FORM = { name: '', type: 'http', target: '', timeout_s: 10, expected_code: 200, expected_body: '' }

export default function ServicesPage() {
  const [checks, setChecks]       = useState<ServiceCheck[]>([])
  const [loading, setLoading]     = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterHost, setFilterHost]     = useState('all')
  const [showAdd, setShowAdd]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState({ ...EMPTY_FORM, asset_id: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/service-checks/all')
      const data = await res.json()
      setChecks(data.checks ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const deleteCheck = async (id: number) => {
    await fetch(`/api/service-checks?id=${id}`, { method: 'DELETE' })
    setChecks(prev => prev.filter(c => c.id !== id))
  }

  const addCheck = async () => {
    if (!form.asset_id || !form.name || !form.target) return
    setSaving(true)
    try {
      await fetch('/api/service-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: form.asset_id,
          name: form.name, type: form.type, target: form.target,
          timeout_s: form.timeout_s,
          expected_code: (form.type === 'http' || form.type === 'https') ? form.expected_code : null,
          expected_body: form.expected_body || null,
        }),
      })
      setShowAdd(false)
      setForm({ ...EMPTY_FORM, asset_id: 0 })
      load()
    } finally {
      setSaving(false)
    }
  }

  // 호스트 목록
  const hosts = Array.from(new Map(checks.map(c => [c.asset_id, { id: c.asset_id, name: c.asset_name }])).values())

  // 필터링
  const filtered = checks.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (filterHost !== 'all' && String(c.asset_id) !== filterHost) return false
    return true
  })

  // 호스트별 그룹
  const grouped = hosts
    .filter(h => filterHost === 'all' || String(h.id) === filterHost)
    .map(h => ({
      ...h,
      items: filtered.filter(c => c.asset_id === h.id),
    }))
    .filter(g => g.items.length > 0)

  const total  = checks.length
  const upCnt  = checks.filter(c => c.status === 'up').length
  const downCnt= checks.filter(c => c.status === 'down').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Activity size={20} className="text-green-400" />
            서비스 체크
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">HTTP · TCP · DNS · Ping 헬스체크</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm">
            <Plus size={14} /> 체크 추가
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 서비스', value: total,   color: 'text-[var(--c-text)]' },
          { label: 'UP',          value: upCnt,   color: 'text-green-400' },
          { label: 'DOWN',        value: downCnt, color: 'text-red-400' },
          { label: '호스트',      value: hosts.length, color: 'text-cyan-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {/* 상태 필터 */}
        {[['all','전체'],['up','UP'],['down','DOWN'],['unknown','알 수 없음']].map(([v,l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              filterStatus === v
                ? v === 'down' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                : v === 'up'   ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                : 'text-[var(--c-muted)] border-[var(--c-border)] hover:text-[var(--c-text)]'
            }`}>{l}</button>
        ))}

        {/* 호스트 필터 */}
        <div className="relative ml-auto">
          <select
            value={filterHost}
            onChange={e => setFilterHost(e.target.value)}
            className="appearance-none pl-3 pr-8 py-1.5 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
          >
            <option value="all">전체 호스트</option>
            {hosts.map(h => <option key={h.id} value={String(h.id)}>{h.name}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-muted)] pointer-events-none" />
        </div>
      </div>

      {/* 호스트별 그룹 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--c-muted)]">
          <RefreshCw size={18} className="animate-spin mr-2" /> 로딩 중...
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--c-faint)]">
          <Activity size={36} className="mb-3 opacity-20" />
          <p className="text-sm">서비스 체크가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => {
            const gUp   = group.items.filter(c => c.status === 'up').length
            const gDown = group.items.filter(c => c.status === 'down').length
            return (
              <div key={group.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
                {/* 호스트 헤더 */}
                <div className="flex items-center justify-between px-5 py-3 bg-[var(--c-hover)] border-b border-[var(--c-border)]">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-cyan-400" />
                    <span className="text-sm font-semibold text-[var(--c-text)]">{group.name}</span>
                    <span className="text-xs text-[var(--c-faint)]">{group.items[0]?.asset_ip}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-400 flex items-center gap-1"><CheckCircle size={11} /> {gUp}</span>
                    {gDown > 0 && <span className="text-red-400 flex items-center gap-1"><XCircle size={11} /> {gDown}</span>}
                    <span className="text-[var(--c-faint)]">총 {group.items.length}개</span>
                  </div>
                </div>

                {/* 서비스 목록 */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-[var(--c-muted)] font-semibold uppercase tracking-wide border-b border-[var(--c-border)]">
                      <th className="text-left px-5 py-2">서비스명</th>
                      <th className="text-left px-4 py-2">타입</th>
                      <th className="text-left px-4 py-2">대상</th>
                      <th className="text-center px-4 py-2">상태</th>
                      <th className="text-right px-4 py-2">응답시간</th>
                      <th className="text-right px-4 py-2">마지막 확인</th>
                      <th className="px-4 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(c => {
                      const st = STATUS_CFG[c.status as keyof typeof STATUS_CFG] ?? STATUS_CFG.unknown
                      return (
                        <tr key={c.id} className={`border-b border-[var(--c-border)] last:border-0 hover:bg-[var(--c-hover)] transition-colors ${
                          c.status === 'down' ? 'bg-red-500/5' : ''
                        }`}>
                          <td className="px-5 py-3 font-medium text-[var(--c-text)]">{c.name}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 text-xs">
                              {TYPE_ICON[c.type] ?? <Globe size={12} />}
                              <span className="text-[var(--c-muted)] uppercase">{c.type}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--c-muted)] font-mono max-w-[200px] truncate">{c.target}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`flex items-center justify-center gap-1 text-xs font-semibold ${st.cls}`}>
                              {st.icon} {st.text}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-[var(--c-muted)]">
                            {c.response_ms != null ? `${c.response_ms} ms` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-[var(--c-faint)]">
                            {c.checked_at
                              ? new Date(c.checked_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => deleteCheck(c.id)} className="text-[var(--c-faint)] hover:text-red-400 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[480px]">
            <h2 className="text-base font-bold text-[var(--c-text)] mb-4 flex items-center gap-2">
              <Plus size={16} className="text-cyan-400" /> 서비스 체크 추가
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">호스트 *</label>
                <select value={form.asset_id} onChange={e => setForm(p => ({ ...p, asset_id: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
                  <option value={0}>선택...</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">서비스명 *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="SSH" />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">타입 *</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
                    {['http','https','tcp','ping','dns'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">대상 *</label>
                <input value={form.target} onChange={e => setForm(p => ({ ...p, target: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                  placeholder="http://10.0.0.1 또는 10.0.0.1:22" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] text-sm">취소</button>
              <button onClick={addCheck} disabled={saving || !form.asset_id || !form.name || !form.target}
                className="flex-1 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">
                {saving ? '저장 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
