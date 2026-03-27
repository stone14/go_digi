'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  HardDrive, Plus, RefreshCw, Search,
  Wifi, Network, Layers,
} from 'lucide-react'

interface StorageAsset {
  id: number
  name: string
  hostname: string | null
  ip_address: string | null
  storage_type: 'nas' | 'san' | 'das'
  status: string
  location: string | null
  manufacturer: string | null
  model: string | null
  monitoring_enabled: boolean
  connected_servers: number
  total_gb: number
  used_gb: number
}

const TYPE_LABEL: Record<string, string> = { nas: 'NAS', san: 'SAN', das: 'DAS' }
const TYPE_COLOR: Record<string, string> = {
  nas: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  san: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  das: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}
const TYPE_ICON: Record<string, React.ReactNode> = {
  nas: <Wifi size={14} />,
  san: <Network size={14} />,
  das: <Layers size={14} />,
}
const STATUS_DOT: Record<string, string> = {
  online: 'bg-green-400', offline: 'bg-red-400',
  warning: 'bg-yellow-400', unknown: 'bg-[var(--c-muted)]',
}

function usePct(used: number, total: number) {
  if (!total) return 0
  return Math.round((used / total) * 100)
}

const EMPTY_FORM = {
  name: '', hostname: '', ip_address: '', storage_type: 'nas',
  location: '', manufacturer: '', model: '', serial_number: '',
}

export default function StoragePage() {
  const [storage, setStorage]   = useState<StorageAsset[]>([])
  const [search, setSearch]     = useState('')
  const [typeFilter, setType]   = useState('all')
  const [showAdd, setShowAdd]   = useState(false)
  const [form, setForm]         = useState({ ...EMPTY_FORM })
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (search) params.set('search', search)
    const res = await fetch(`/api/storage?${params}`)
    const data = await res.json()
    setStorage(data.storage ?? [])
  }, [typeFilter, search])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    setSaving(true)
    await fetch('/api/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setShowAdd(false)
    setForm({ ...EMPTY_FORM })
    load()
  }

  const stats = {
    total:   storage.length,
    nas:     storage.filter(s => s.storage_type === 'nas').length,
    san:     storage.filter(s => s.storage_type === 'san').length,
    das:     storage.filter(s => s.storage_type === 'das').length,
    totalTB: (storage.reduce((a, s) => a + Number(s.total_gb), 0) / 1024).toFixed(1),
    usedTB:  (storage.reduce((a, s) => a + Number(s.used_gb), 0) / 1024).toFixed(1),
    offline: storage.filter(s => s.status === 'offline').length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <HardDrive size={20} className="text-cyan-400" /> 스토리지 모니터링
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">NAS · SAN · DAS 스토리지 현황</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg text-sm hover:bg-cyan-500/30 transition-colors"
          >
            <Plus size={14} /> 스토리지 추가
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { label: '전체',      value: stats.total,            color: 'text-[var(--c-text)]' },
          { label: 'NAS',       value: stats.nas,              color: 'text-[var(--c-text)]' },
          { label: 'SAN',       value: stats.san,              color: 'text-[var(--c-text)]' },
          { label: 'DAS',       value: stats.das,              color: 'text-[var(--c-text)]' },
          { label: '총 용량',   value: `${stats.totalTB} TB`,  color: 'text-[var(--c-text)]' },
          { label: '오프라인',  value: stats.offline,          color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="스토리지 검색..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
          />
        </div>
        {['all', 'nas', 'san', 'das'].map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              typeFilter === t
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                : 'text-[var(--c-muted)] border-[var(--c-border)] hover:text-[var(--c-text)]'
            }`}
          >
            {t === 'all' ? '전체' : t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Storage Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {storage.map(s => {
          const total = Number(s.total_gb) || 0
          const used  = Number(s.used_gb)  || 0
          const pct = usePct(used, total)
          const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-cyan-500'
          return (
            <Link key={s.id} href={`/storage/${s.id}`}>
              <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 hover:border-cyan-500/30 transition-colors cursor-pointer">
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${STATUS_DOT[s.status] ?? 'bg-[var(--c-muted)]'}`} />
                    <span className="text-[var(--c-text)] font-medium text-sm">{s.name}</span>
                  </div>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${TYPE_COLOR[s.storage_type]}`}>
                    {TYPE_ICON[s.storage_type]} {TYPE_LABEL[s.storage_type]}
                  </span>
                </div>

                {/* Info */}
                <div className="text-xs text-[var(--c-faint)] space-y-0.5 mb-4">
                  {s.ip_address && <p>IP: {s.ip_address}</p>}
                  {s.location   && <p>위치: {s.location}</p>}
                  {s.manufacturer && <p>{s.manufacturer} {s.model}</p>}
                </div>

                {/* Capacity bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--c-muted)]">용량</span>
                    <span className="text-[var(--c-text)]">
                      {total ? `${(used / 1024).toFixed(1)} TB` : '—'} /
                      {total ? ` ${(total / 1024).toFixed(1)} TB` : ' —'}
                      {total ? ` (${pct}%)` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[var(--c-border)] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-3 pt-3 border-t border-[var(--c-border)] flex items-center justify-between text-xs text-[var(--c-muted)]">
                  <span>연결 서버 {s.connected_servers}대</span>
                  <span className={s.status === 'offline' ? 'text-red-400' : ''}>
                    {s.status === 'online' ? '정상' : s.status === 'offline' ? '오프라인' : '알 수 없음'}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
        {storage.length === 0 && (
          <div className="col-span-3 py-16 text-center text-[var(--c-faint)]">
            <HardDrive size={32} className="mx-auto mb-3 opacity-30" />
            <p>등록된 스토리지가 없습니다</p>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-[var(--c-text)] font-semibold">스토리지 추가</h2>
            {[
              { key: 'name',          label: '이름 *',      type: 'text' },
              { key: 'hostname',      label: '호스트명',    type: 'text' },
              { key: 'ip_address',    label: 'IP 주소',     type: 'text' },
              { key: 'location',      label: '위치',        type: 'text' },
              { key: 'manufacturer',  label: '제조사',      type: 'text' },
              { key: 'model',         label: '모델',        type: 'text' },
              { key: 'serial_number', label: '시리얼 번호', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs text-[var(--c-muted)]">{f.label}</label>
                <input
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-[var(--c-muted)]">유형 *</label>
              <select
                value={form.storage_type}
                onChange={e => setForm(p => ({ ...p, storage_type: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
              >
                <option value="nas">NAS (Network Attached Storage)</option>
                <option value="san">SAN (Storage Area Network)</option>
                <option value="das">DAS (Direct Attached Storage)</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2 text-sm text-[var(--c-muted)] border border-[var(--c-border)] rounded-lg hover:text-[var(--c-text)]">취소</button>
              <button onClick={handleAdd} disabled={saving || !form.name}
                className="flex-1 py-2 text-sm bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50">
                {saving ? '저장 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
