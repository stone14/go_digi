'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Network, Search, Plus, Settings, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Clock
} from 'lucide-react'

interface NetworkDevice {
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
}

const STATUS_CONFIG = {
  online:  { icon: CheckCircle,  color: 'text-green-400',  bg: 'bg-green-400/10',  label: 'Online'  },
  offline: { icon: XCircle,      color: 'text-red-400',    bg: 'bg-red-400/10',    label: 'Offline' },
  warning: { icon: AlertTriangle,color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Warning' },
  unknown: { icon: Clock,        color: 'text-[var(--c-muted)]', bg: 'bg-[var(--c-hover)]', label: 'Unknown' },
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

function MonitoringToggle({ deviceId, enabled, onToggle }: {
  deviceId: number
  enabled: boolean
  onToggle: (id: number, val: boolean) => void
}) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); onToggle(deviceId, !enabled) }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none
        ${enabled ? 'bg-cyan-500' : 'bg-[var(--c-border)]'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform
          ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

export default function NetworkPage() {
  const [devices, setDevices]   = useState<NetworkDevice[]>([])
  const [total, setTotal]       = useState(0)
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [newDevice, setNewDevice] = useState({
    name: '', hostname: '', ip_address: '', asset_type: 'network',
    location: '', manufacturer: '', model: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const netRes = await fetch(`/api/assets?type=network&limit=100${search ? `&search=${search}` : ''}`).then(r => r.json())
      const all = netRes.assets ?? []
      setDevices(all)
      setTotal(all.length)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { load() }, [load])

  async function toggleMonitoring(id: number, enabled: boolean) {
    await fetch('/api/assets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, monitoring_enabled: enabled }),
    })
    setDevices(prev => prev.map(d => d.id === id ? { ...d, monitoring_enabled: enabled } : d))
  }

  async function addDevice() {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDevice),
    })
    if (res.ok) {
      setShowAdd(false)
      setNewDevice({ name: '', hostname: '', ip_address: '', asset_type: 'network', location: '', manufacturer: '', model: '' })
      load()
    }
  }

  const online  = devices.filter(d => d.status === 'online').length
  const offline = devices.filter(d => d.status === 'offline').length
  const monitored = devices.filter(d => d.monitoring_enabled).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Network className="text-cyan-400" size={20} />
            네트워크 장비
          </h1>
          <p className="text-[var(--c-muted)] text-sm mt-0.5">스위치 · 라우터 · 방화벽 모니터링</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm"
          >
            <Plus size={14} />
            장비 추가
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 장비',     value: total,     color: 'text-[var(--c-text)]' },
          { label: 'Online',        value: online,    color: 'text-[var(--c-text)]' },
          { label: 'Offline',       value: offline,   color: 'text-red-400' },
          { label: '모니터링 활성', value: monitored, color: 'text-[var(--c-text)]' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-[var(--c-muted)] text-xs">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" size={16} />
        <input
          type="text"
          placeholder="이름, 호스트명, IP로 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
        />
      </div>

      {/* Device Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] bg-[var(--c-hover)]">
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">장비명</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">타입</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">IP 주소</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">위치</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">상태</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">마지막 확인</th>
              <th className="text-center px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">모니터링</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[var(--c-faint)]">
                  <RefreshCw className="inline animate-spin mr-2" size={16} />
                  로딩 중...
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[var(--c-faint)]">
                  등록된 네트워크 장비가 없습니다
                </td>
              </tr>
            ) : (
              devices.map(device => (
                <tr key={device.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--c-text)]">{device.name}</div>
                    <div className="text-xs text-[var(--c-faint)]">{device.hostname || device.manufacturer || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-md text-xs ${
                      device.asset_type === 'security' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {device.asset_type === 'security' ? '보안' : '네트워크'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--c-text)] text-xs">{device.ip_address}</td>
                  <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{device.location || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={device.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--c-muted)] text-xs">
                    {device.last_seen
                      ? new Date(device.last_seen).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <MonitoringToggle
                      deviceId={device.id}
                      enabled={device.monitoring_enabled}
                      onToggle={toggleMonitoring}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/network/${device.id}`}
                      className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs"
                    >
                      <Settings size={12} />
                      상세
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Device Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[480px] shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-4 flex items-center gap-2">
              <Plus size={18} className="text-cyan-400" />
              네트워크 장비 추가
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">장비명 *</label>
                  <input
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="Core-Switch-01"
                    value={newDevice.name}
                    onChange={e => setNewDevice(p => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">타입 *</label>
                  <select
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={newDevice.asset_type}
                    onChange={e => setNewDevice(p => ({ ...p, asset_type: e.target.value }))}
                  >
                    <option value="network">네트워크 (스위치/라우터)</option>
                    <option value="security">보안 (방화벽/IPS)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">IP 주소 *</label>
                  <input
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="192.168.1.1"
                    value={newDevice.ip_address}
                    onChange={e => setNewDevice(p => ({ ...p, ip_address: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">호스트명</label>
                  <input
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="core-sw-01"
                    value={newDevice.hostname}
                    onChange={e => setNewDevice(p => ({ ...p, hostname: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">제조사</label>
                  <input
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="Cisco"
                    value={newDevice.manufacturer}
                    onChange={e => setNewDevice(p => ({ ...p, manufacturer: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">모델</label>
                  <input
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="Catalyst 9300"
                    value={newDevice.model}
                    onChange={e => setNewDevice(p => ({ ...p, model: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">위치</label>
                <input
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                  placeholder="IDC 1층 랙 A-03"
                  value={newDevice.location}
                  onChange={e => setNewDevice(p => ({ ...p, location: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm"
              >
                취소
              </button>
              <button
                onClick={addDevice}
                disabled={!newDevice.name || !newDevice.ip_address}
                className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
