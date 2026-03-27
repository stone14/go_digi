'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Shield, Search, Plus, RefreshCw, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react'

interface SecurityDevice {
  id: number
  name: string
  hostname: string
  ip_address: string
  asset_type: string
  status: string
  location: string
  monitoring_enabled: boolean
  last_seen: string | null
  model: string | null
  manufacturer: string | null
  os: string | null
}

const STATUS_CONFIG = {
  online:  { icon: CheckCircle,   color: 'text-green-400',  bg: 'bg-green-400/10',  label: '온라인'  },
  offline: { icon: XCircle,       color: 'text-red-400',    bg: 'bg-red-400/10',    label: '오프라인' },
  warning: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-400/10', label: '경고' },
  unknown: { icon: Clock,         color: 'text-[var(--c-muted)]', bg: 'bg-[var(--c-hover)]', label: '알 수 없음' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.unknown
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  )
}

export default function SecurityPage() {
  const [devices, setDevices] = useState<SecurityDevice[]>([])
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newDevice, setNewDevice] = useState({
    name: '', hostname: '', ip_address: '', asset_type: 'security',
    location: '', manufacturer: '', model: '', os: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/assets?type=security&limit=100${search ? `&search=${search}` : ''}`)
      const data = await res.json()
      setDevices(data.assets ?? [])
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { load() }, [load])

  async function addDevice() {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDevice),
    })
    if (res.ok) {
      setShowAdd(false)
      setNewDevice({ name: '', hostname: '', ip_address: '', asset_type: 'security', location: '', manufacturer: '', model: '', os: '' })
      load()
    }
  }

  const online  = devices.filter(d => d.status === 'online').length
  const offline = devices.filter(d => d.status === 'offline').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Shield size={20} className="text-orange-400" />
            보안 장비
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">방화벽 · IPS · IDS · WAF 모니터링</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm">
            <Plus size={14} />
            장비 추가
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 장비', value: devices.length, color: 'text-[var(--c-text)]' },
          { label: '온라인',    value: online,          color: 'text-green-400' },
          { label: '오프라인',  value: offline,         color: 'text-red-400' },
          { label: '모니터링',  value: devices.filter(d => d.monitoring_enabled).length, color: 'text-orange-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-[var(--c-muted)] text-xs">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" />
        <input
          type="text"
          placeholder="이름, IP로 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-orange-500"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] bg-[var(--c-hover)]">
              {['장비명', 'IP 주소', '펌웨어/OS', '제조사 / 모델', '위치', '상태', '마지막 확인'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">{h}</th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[var(--c-faint)]">
                  <RefreshCw className="inline animate-spin mr-2" size={16} />로딩 중...
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[var(--c-faint)]">
                  <Shield size={32} className="mx-auto mb-3 opacity-20" />
                  <p>등록된 보안 장비가 없습니다</p>
                </td>
              </tr>
            ) : devices.map(d => (
              <tr key={d.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--c-text)]">{d.name}</div>
                  <div className="text-xs text-[var(--c-faint)]">{d.hostname || ''}</div>
                </td>
                <td className="px-4 py-3 font-mono text-[var(--c-text)] text-xs">{d.ip_address ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{d.os ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--c-muted)] text-xs">
                  {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{d.location || '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                <td className="px-4 py-3 text-[var(--c-muted)] text-xs">
                  {d.last_seen ? new Date(d.last_seen).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/network/${d.id}`} className="text-orange-400 hover:text-orange-300 text-xs">상세</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[480px] shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-4 flex items-center gap-2">
              <Plus size={18} className="text-orange-400" />보안 장비 추가
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'name',         label: '장비명 *',   placeholder: 'Firewall-02' },
                  { key: 'hostname',     label: '호스트명',   placeholder: 'fw-02' },
                  { key: 'ip_address',   label: 'IP 주소',    placeholder: '10.20.52.253' },
                  { key: 'location',     label: '위치',       placeholder: 'IDC 1층' },
                  { key: 'manufacturer', label: '제조사',     placeholder: 'Palo Alto' },
                  { key: 'model',        label: '모델',       placeholder: 'PA-440' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">{f.label}</label>
                    <input
                      className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-orange-500"
                      placeholder={f.placeholder}
                      value={newDevice[f.key as keyof typeof newDevice]}
                      onChange={e => setNewDevice(p => ({ ...p, [f.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">펌웨어/OS</label>
                <input
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-orange-500"
                  placeholder="PAN-OS 11.1"
                  value={newDevice.os}
                  onChange={e => setNewDevice(p => ({ ...p, os: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">취소</button>
              <button onClick={addDevice} disabled={!newDevice.name || !newDevice.ip_address}
                className="flex-1 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm">추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
