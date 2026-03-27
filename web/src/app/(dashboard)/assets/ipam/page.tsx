'use client'

import { useEffect, useState, useCallback } from 'react'
import { Globe, RefreshCw, ChevronDown, ChevronRight, Plus, Pencil, Trash2, X } from 'lucide-react'

interface Subnet {
  id: number; subnet: string; name: string | null; vlan: number | null
  location: string | null; description: string | null
  total: number; used: number; reserved: number
}
interface Allocation {
  id: number; subnet_id: number; ip_address: string
  asset_id: number | null; hostname: string | null
  purpose: string | null; status: string; notes: string | null
}

const STATUS_STYLE: Record<string, string> = {
  used:      'bg-cyan-400/10 text-cyan-400',
  reserved:  'bg-yellow-400/10 text-yellow-400',
  available: 'bg-green-400/10 text-green-400',
}

function cidrSize(subnet: string) {
  const prefix = parseInt(subnet.split('/')[1])
  return Math.pow(2, 32 - prefix) - 2
}

export default function IpamPage() {
  const [subnets,     setSubnets]     = useState<Subnet[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading,     setLoading]     = useState(true)
  const [expandedId,  setExpandedId]  = useState<number | null>(null)

  // Subnet modal
  const [subnetModal, setSubnetModal] = useState(false)
  const [subnetForm, setSubnetForm] = useState({ subnet: '', name: '', vlan: '', location: '', description: '' })
  const [subnetSaving, setSubnetSaving] = useState(false)

  // Allocation modal
  const [allocModal, setAllocModal] = useState(false)
  const [allocEdit, setAllocEdit] = useState<Allocation | null>(null)
  const [allocSubnetId, setAllocSubnetId] = useState<number | null>(null)
  const [allocForm, setAllocForm] = useState({ ip_address: '', hostname: '', purpose: '', status: 'used', notes: '' })
  const [allocSaving, setAllocSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/assets/ipam')
      const data = await res.json()
      setSubnets(data.subnets ?? [])
      setAllocations(data.allocations ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const totalIPs = subnets.reduce((s, n) => s + cidrSize(n.subnet), 0)
  const totalUsed = allocations.filter(a => a.status === 'used').length
  const totalReserved = allocations.filter(a => a.status === 'reserved').length

  async function saveSubnet() {
    setSubnetSaving(true)
    try {
      await fetch('/api/assets/ipam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subnet: subnetForm.subnet,
          name: subnetForm.name || null,
          vlan: subnetForm.vlan ? parseInt(subnetForm.vlan) : null,
          location: subnetForm.location || null,
          description: subnetForm.description || null,
        }),
      })
      setSubnetModal(false)
      setSubnetForm({ subnet: '', name: '', vlan: '', location: '', description: '' })
      load()
    } finally { setSubnetSaving(false) }
  }

  function openAllocModal(subnetId: number, alloc?: Allocation) {
    setAllocSubnetId(subnetId)
    if (alloc) {
      setAllocEdit(alloc)
      setAllocForm({ ip_address: alloc.ip_address, hostname: alloc.hostname ?? '', purpose: alloc.purpose ?? '', status: alloc.status, notes: alloc.notes ?? '' })
    } else {
      setAllocEdit(null)
      setAllocForm({ ip_address: '', hostname: '', purpose: '', status: 'used', notes: '' })
    }
    setAllocModal(true)
  }

  async function saveAlloc() {
    setAllocSaving(true)
    try {
      await fetch('/api/assets/ipam', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allocEdit
          ? { id: allocEdit.id, hostname: allocForm.hostname || null, purpose: allocForm.purpose || null, status: allocForm.status, notes: allocForm.notes || null }
          : { subnet_id: allocSubnetId, ip_address: allocForm.ip_address, hostname: allocForm.hostname || null, purpose: allocForm.purpose || null, status: allocForm.status, notes: allocForm.notes || null }
        ),
      })
      setAllocModal(false)
      load()
    } finally { setAllocSaving(false) }
  }

  async function deleteAlloc(id: number) {
    if (!confirm('이 IP 할당을 삭제하시겠습니까?')) return
    await fetch(`/api/assets/ipam?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Globe size={20} className="text-cyan-400" /> IP 관리 (IPAM)
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">서브넷 · IP 할당 현황</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSubnetModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition-colors">
            <Plus size={14} /> 서브넷 추가
          </button>
          <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '서브넷',     value: subnets.length, color: 'text-[var(--c-text)]' },
          { label: '전체 IP',   value: totalIPs,        color: 'text-cyan-400' },
          { label: '사용 중',   value: totalUsed,       color: 'text-purple-400' },
          { label: '예약',      value: totalReserved,   color: 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Subnet list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[var(--c-muted)]">
            <RefreshCw size={16} className="animate-spin mr-2" />로딩 중...
          </div>
        ) : subnets.map(subnet => {
          const ips = allocations.filter(a => a.subnet_id === subnet.id)
          const size = cidrSize(subnet.subnet)
          const usedPct = Math.round((subnet.used / size) * 100)
          const isOpen = expandedId === subnet.id

          return (
            <div key={subnet.id} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
              {/* Subnet header */}
              <button
                onClick={() => setExpandedId(isOpen ? null : subnet.id)}
                className="w-full px-5 py-4 flex items-center gap-4 hover:bg-[var(--c-hover)] transition-colors text-left"
              >
                {isOpen ? <ChevronDown size={14} className="text-[var(--c-muted)] flex-shrink-0" />
                         : <ChevronRight size={14} className="text-[var(--c-muted)] flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-bold text-cyan-400">{subnet.subnet}</span>
                    {subnet.name && <span className="text-sm text-[var(--c-text)]">{subnet.name}</span>}
                    {subnet.vlan && <span className="text-xs bg-purple-400/10 text-purple-400 px-2 py-0.5 rounded-full">VLAN {subnet.vlan}</span>}
                    {subnet.location && <span className="text-xs text-[var(--c-muted)]">{subnet.location}</span>}
                  </div>
                  {subnet.description && <p className="text-xs text-[var(--c-faint)] mt-0.5">{subnet.description}</p>}
                </div>
                <div className="flex items-center gap-6 flex-shrink-0 text-xs text-[var(--c-muted)]">
                  <span><span className="text-cyan-400 font-bold">{subnet.used}</span> 사용</span>
                  <span><span className="text-yellow-400 font-bold">{subnet.reserved}</span> 예약</span>
                  <span><span className="text-[var(--c-text)]">{size}</span> 전체</span>
                  <div className="w-24">
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span>{usedPct}%</span>
                    </div>
                    <div className="w-full bg-[var(--c-border)] rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-orange-400' : 'bg-cyan-500'}`}
                        style={{ width: `${Math.min(usedPct, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </button>

              {/* IP list */}
              {isOpen && (
                <div className="border-t border-[var(--c-border)] overflow-x-auto">
                  <div className="flex items-center justify-between px-4 py-2 bg-[var(--c-hover)]">
                    <span className="text-xs text-[var(--c-muted)] font-medium">IP 할당 목록</span>
                    <button onClick={() => openAllocModal(subnet.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-cyan-500/10 text-cyan-400 rounded hover:bg-cyan-500/20 transition-colors">
                      <Plus size={12} /> IP 추가
                    </button>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--c-border)] bg-[var(--c-hover)]">
                        <th className="text-left px-4 py-2 text-[var(--c-muted)] font-medium">IP 주소</th>
                        <th className="text-left px-4 py-2 text-[var(--c-muted)] font-medium">호스트명</th>
                        <th className="text-left px-4 py-2 text-[var(--c-muted)] font-medium">용도</th>
                        <th className="text-left px-4 py-2 text-[var(--c-muted)] font-medium">상태</th>
                        <th className="text-right px-4 py-2 text-[var(--c-muted)] font-medium w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {ips.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-4 text-[var(--c-faint)]">등록된 IP 없음</td></tr>
                      ) : ips.map(ip => (
                        <tr key={ip.id} className="border-b border-[var(--c-border)]/30 hover:bg-[var(--c-hover)]">
                          <td className="px-4 py-2 font-mono text-[var(--c-text)]">{ip.ip_address}</td>
                          <td className="px-4 py-2 text-[var(--c-muted)]">{ip.hostname || '—'}</td>
                          <td className="px-4 py-2 text-[var(--c-muted)]">{ip.purpose || '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] ${STATUS_STYLE[ip.status] ?? 'text-[var(--c-faint)]'}`}>
                              {ip.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openAllocModal(subnet.id, ip)}
                                className="p-1 text-[var(--c-muted)] hover:text-cyan-400 transition-colors">
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => deleteAlloc(ip.id)}
                                className="p-1 text-[var(--c-muted)] hover:text-red-400 transition-colors">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Subnet Modal */}
      {subnetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--c-text)]">서브넷 추가</h2>
              <button onClick={() => setSubnetModal(false)} className="text-[var(--c-muted)] hover:text-[var(--c-text)]"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--c-muted)] mb-1">서브넷 (CIDR) *</label>
                <input value={subnetForm.subnet} onChange={e => setSubnetForm(f => ({ ...f, subnet: e.target.value }))}
                  placeholder="192.168.1.0/24"
                  className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-muted)] mb-1">이름</label>
                <input value={subnetForm.name} onChange={e => setSubnetForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="서버팜 A"
                  className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--c-muted)] mb-1">VLAN</label>
                  <input value={subnetForm.vlan} onChange={e => setSubnetForm(f => ({ ...f, vlan: e.target.value }))}
                    type="number" placeholder="100"
                    className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--c-muted)] mb-1">위치</label>
                  <input value={subnetForm.location} onChange={e => setSubnetForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="DC-1"
                    className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--c-muted)] mb-1">설명</label>
                <input value={subnetForm.description} onChange={e => setSubnetForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSubnetModal(false)}
                className="px-4 py-2 text-xs text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">취소</button>
              <button onClick={saveSubnet} disabled={!subnetForm.subnet || subnetSaving}
                className="px-4 py-2 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-40 transition-colors">
                {subnetSaving ? '저장 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Allocation Modal */}
      {allocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--c-text)]">{allocEdit ? 'IP 할당 수정' : 'IP 할당 추가'}</h2>
              <button onClick={() => setAllocModal(false)} className="text-[var(--c-muted)] hover:text-[var(--c-text)]"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--c-muted)] mb-1">IP 주소 *</label>
                <input value={allocForm.ip_address} onChange={e => setAllocForm(f => ({ ...f, ip_address: e.target.value }))}
                  disabled={!!allocEdit} placeholder="192.168.1.10"
                  className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-muted)] mb-1">호스트명</label>
                <input value={allocForm.hostname} onChange={e => setAllocForm(f => ({ ...f, hostname: e.target.value }))}
                  placeholder="web-server-01"
                  className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--c-muted)] mb-1">용도</label>
                  <input value={allocForm.purpose} onChange={e => setAllocForm(f => ({ ...f, purpose: e.target.value }))}
                    placeholder="웹 서버"
                    className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--c-muted)] mb-1">상태</label>
                  <select value={allocForm.status} onChange={e => setAllocForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none">
                    <option value="used">사용 중</option>
                    <option value="reserved">예약</option>
                    <option value="available">가용</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--c-muted)] mb-1">비고</label>
                <input value={allocForm.notes} onChange={e => setAllocForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[var(--c-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:border-cyan-500 outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setAllocModal(false)}
                className="px-4 py-2 text-xs text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">취소</button>
              <button onClick={saveAlloc} disabled={(!allocEdit && !allocForm.ip_address) || allocSaving}
                className="px-4 py-2 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-40 transition-colors">
                {allocSaving ? '저장 중...' : allocEdit ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
