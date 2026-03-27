'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, HardDrive, Plus, Server, Wifi, Network,
  Layers, Trash2, RefreshCw,
} from 'lucide-react'

interface StorageDetail {
  id: number; name: string; hostname: string | null; ip_address: string | null
  storage_type: 'nas' | 'san' | 'das'; status: string; location: string | null
  manufacturer: string | null; model: string | null; serial_number: string | null
  connected_servers: number; total_gb: number; used_gb: number
}

interface Volume {
  id: number; volume_name: string; total_gb: number | null
  used_gb: number | null; filesystem: string | null
  raid_level: string | null; status: string
}

interface Connection {
  id: number; connection_type: string; mount_point: string | null; is_active: boolean
  server_id: number; server_name: string; server_ip: string | null; server_status: string
}

interface ServerAsset { id: number; name: string; ip_address: string | null }

const TYPE_LABEL: Record<string, string> = { nas: 'NAS', san: 'SAN', das: 'DAS' }
const TYPE_ICON: Record<string, React.ReactNode> = {
  nas: <Wifi size={14} />, san: <Network size={14} />, das: <Layers size={14} />,
}
const STATUS_DOT: Record<string, string> = {
  online: 'bg-green-400', offline: 'bg-red-400', warning: 'bg-yellow-400', unknown: 'bg-[var(--c-muted)]',
}
const VOL_STATUS: Record<string, string> = {
  ok: 'text-green-400', degraded: 'text-yellow-400', failed: 'text-red-400',
}

const CONN_TYPES = ['nfs', 'iscsi', 'fc', 'smb', 'sas']

export default function StorageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [asset, setAsset]           = useState<StorageDetail | null>(null)
  const [volumes, setVolumes]       = useState<Volume[]>([])
  const [connections, setConns]     = useState<Connection[]>([])
  const [servers, setServers]       = useState<ServerAsset[]>([])
  const [showVolume, setShowVolume] = useState(false)
  const [showConn, setShowConn]     = useState(false)
  const [volForm, setVolForm]       = useState({ volume_name: '', total_gb: '', used_gb: '', filesystem: '', raid_level: '' })
  const [connForm, setConnForm]     = useState({ server_asset_id: '', connection_type: 'nfs', mount_point: '' })

  const load = useCallback(async () => {
    const res = await fetch(`/api/storage?id=${id}`)
    if (!res.ok) return
    const data = await res.json()
    setAsset(data.asset)
    setVolumes(data.volumes)
    setConns(data.connections)
  }, [id])

  useEffect(() => {
    load()
    fetch('/api/assets?type=server')
      .then(r => r.json())
      .then(d => setServers(d.assets ?? []))
  }, [load])

  const addVolume = async () => {
    await fetch('/api/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert_volume', asset_id: id, ...volForm }),
    })
    setShowVolume(false)
    setVolForm({ volume_name: '', total_gb: '', used_gb: '', filesystem: '', raid_level: '' })
    load()
  }

  const addConn = async () => {
    await fetch('/api/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'connect', storage_asset_id: Number(id), ...connForm, server_asset_id: Number(connForm.server_asset_id) }),
    })
    setShowConn(false)
    setConnForm({ server_asset_id: '', connection_type: 'nfs', mount_point: '' })
    load()
  }

  const disconnect = async (serverId: number) => {
    await fetch('/api/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect', storage_asset_id: Number(id), server_asset_id: serverId }),
    })
    load()
  }

  if (!asset) return <div className="p-6 text-[var(--c-muted)]">로딩 중...</div>

  const assetTotal = Number(asset.total_gb) || 0
  const assetUsed  = Number(asset.used_gb)  || 0
  const usedPct = assetTotal ? Math.round((assetUsed / assetTotal) * 100) : 0
  const barColor = usedPct >= 90 ? 'bg-red-500' : usedPct >= 75 ? 'bg-yellow-500' : 'bg-cyan-500'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/storage" className="p-1.5 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <ChevronLeft size={18} />
          </Link>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${STATUS_DOT[asset.status] ?? 'bg-[var(--c-muted)]'}`} />
            <h1 className="text-xl font-semibold text-[var(--c-text)]">{asset.name}</h1>
            <span className={`flex items-center gap-1 px-2 py-0.5 text-xs border rounded ${
              asset.storage_type === 'nas' ? 'border-cyan-500/30 text-cyan-400' :
              asset.storage_type === 'san' ? 'border-purple-500/30 text-purple-400' :
              'border-orange-500/30 text-orange-400'
            }`}>
              {TYPE_ICON[asset.storage_type]} {TYPE_LABEL[asset.storage_type]}
            </span>
          </div>
        </div>
        <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Info + Capacity */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5">
          <h2 className="text-sm font-medium text-[var(--c-text)] mb-3">장비 정보</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            {[
              ['IP 주소', asset.ip_address],
              ['호스트명', asset.hostname],
              ['위치', asset.location],
              ['제조사', asset.manufacturer],
              ['모델', asset.model],
              ['시리얼', asset.serial_number],
            ].map(([k, v]) => v ? (
              <div key={k}>
                <span className="text-[var(--c-muted)]">{k}: </span>
                <span className="text-[var(--c-text)]">{v}</span>
              </div>
            ) : null)}
          </div>
        </div>
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-medium text-[var(--c-text)]">용량 현황</h2>
          <div className="text-3xl font-bold text-[var(--c-text)]">{usedPct}%</div>
          <div className="h-2 bg-[var(--c-border)] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${usedPct}%` }} />
          </div>
          <div className="text-xs text-[var(--c-muted)] space-y-0.5">
            <p>사용: {assetUsed ? `${(assetUsed / 1024).toFixed(1)} TB` : '—'}</p>
            <p>전체: {assetTotal ? `${(assetTotal / 1024).toFixed(1)} TB` : '—'}</p>
          </div>
        </div>
      </div>

      {/* Volumes */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--c-border)]">
          <h2 className="text-sm font-medium text-[var(--c-text)] flex items-center gap-2">
            <HardDrive size={15} className="text-cyan-400" /> 볼륨 / LUN
          </h2>
          <button onClick={() => setShowVolume(true)}
            className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
            <Plus size={12} /> 볼륨 추가
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide border-b border-[var(--c-border)] bg-[var(--c-hover)]">
                {['볼륨명', 'RAID', '파일시스템', '사용량', '상태'].map(h => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {volumes.map(v => {
                const vTotal = Number(v.total_gb) || 0
                const vUsed  = Number(v.used_gb)  || 0
                const pct = vTotal ? Math.round((vUsed / vTotal) * 100) : 0
                return (
                  <tr key={v.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                    <td className="px-5 py-3 text-[var(--c-text)]">{v.volume_name}</td>
                    <td className="px-5 py-3 text-[var(--c-muted)]">{v.raid_level || '—'}</td>
                    <td className="px-5 py-3 text-[var(--c-muted)]">{v.filesystem || '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-[var(--c-border)] rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-cyan-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-[var(--c-muted)]">
                          {vTotal ? vUsed.toFixed(0) : '—'} / {vTotal ? vTotal.toFixed(0) : '—'} GB ({pct}%)
                        </span>
                      </div>
                    </td>
                    <td className={`px-5 py-3 text-xs font-medium ${VOL_STATUS[v.status] ?? 'text-[var(--c-muted)]'}`}>
                      {v.status === 'ok' ? '정상' : v.status === 'degraded' ? '경고' : '장애'}
                    </td>
                  </tr>
                )
              })}
              {volumes.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-[var(--c-faint)]">볼륨이 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Connected Servers */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--c-border)]">
          <h2 className="text-sm font-medium text-[var(--c-text)] flex items-center gap-2">
            <Server size={15} className="text-purple-400" /> 연결된 서버
          </h2>
          <button onClick={() => setShowConn(true)}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300">
            <Plus size={12} /> 서버 연결
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide border-b border-[var(--c-border)] bg-[var(--c-hover)]">
                {['서버', 'IP 주소', '연결 방식', '마운트 포인트', '서버 상태', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {connections.filter(c => c.is_active).map(c => (
                <tr key={c.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/servers/${c.server_id}`} className="text-[var(--c-text)] hover:text-cyan-400 transition-colors">
                      {c.server_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[var(--c-muted)]">{c.server_ip || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 bg-[var(--c-border)] text-[var(--c-text)] rounded text-xs uppercase">{c.connection_type}</span>
                  </td>
                  <td className="px-5 py-3 text-[var(--c-muted)] font-mono text-xs">{c.mount_point || '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`flex items-center gap-1 text-xs ${
                      c.server_status === 'online'  ? 'text-green-400' :
                      c.server_status === 'offline' ? 'text-red-400' : 'text-[var(--c-muted)]'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.server_status] ?? 'bg-[var(--c-muted)]'}`} />
                      {c.server_status === 'online' ? '온라인' : c.server_status === 'offline' ? '오프라인' : '알 수 없음'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => disconnect(c.server_id)} className="text-[var(--c-faint)] hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {connections.filter(c => c.is_active).length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-[var(--c-faint)]">연결된 서버가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Volume Modal */}
      {showVolume && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-[var(--c-text)] font-semibold">볼륨 추가</h2>
            {[
              { key: 'volume_name', label: '볼륨명 *' },
              { key: 'total_gb',    label: '전체 용량 (GB)' },
              { key: 'used_gb',     label: '사용 용량 (GB)' },
              { key: 'filesystem',  label: '파일시스템 (ext4, xfs, NTFS...)' },
              { key: 'raid_level',  label: 'RAID 레벨' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs text-[var(--c-muted)]">{f.label}</label>
                <input
                  value={volForm[f.key as keyof typeof volForm]}
                  onChange={e => setVolForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowVolume(false)}
                className="flex-1 py-2 text-sm text-[var(--c-muted)] border border-[var(--c-border)] rounded-lg hover:text-[var(--c-text)] transition-colors">취소</button>
              <button onClick={addVolume} disabled={!volForm.volume_name}
                className="flex-1 py-2 text-sm bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 transition-colors">추가</button>
            </div>
          </div>
        </div>
      )}

      {/* Connection Modal */}
      {showConn && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-[var(--c-text)] font-semibold">서버 연결</h2>
            <div>
              <label className="text-xs text-[var(--c-muted)]">서버 *</label>
              <select value={connForm.server_asset_id}
                onChange={e => setConnForm(p => ({ ...p, server_asset_id: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
                <option value="">선택...</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name} {s.ip_address ? `(${s.ip_address})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--c-muted)]">연결 방식</label>
              <select value={connForm.connection_type}
                onChange={e => setConnForm(p => ({ ...p, connection_type: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
                {CONN_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--c-muted)]">마운트 포인트</label>
              <input value={connForm.mount_point}
                onChange={e => setConnForm(p => ({ ...p, mount_point: e.target.value }))}
                placeholder="/mnt/storage1"
                className="mt-1 w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowConn(false)}
                className="flex-1 py-2 text-sm text-[var(--c-muted)] border border-[var(--c-border)] rounded-lg hover:text-[var(--c-text)] transition-colors">취소</button>
              <button onClick={addConn} disabled={!connForm.server_asset_id}
                className="flex-1 py-2 text-sm bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/30 disabled:opacity-50 transition-colors">연결</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
