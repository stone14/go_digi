'use client'

import { useEffect, useState, useCallback } from 'react'
import { Layers, RefreshCw, Pencil, Plus, Trash2, X, ChevronUp, ChevronDown } from 'lucide-react'
import StencilIcon, { STENCILS, type UnitType } from '@/components/rack/RackStencils'

/* ── Types ────────────────────────────────────── */
interface Rack {
  id: number
  name: string
  location: string | null
  row_no: string | null
  total_u: number
  description: string | null
}

interface RackUnit {
  id: number
  rack_id: number
  asset_id: number | null
  start_u: number
  size_u: number
  label: string
  unit_type: string
  asset_status: string | null
  asset_ip: string | null
  asset_name: string | null
  manufacturer: string | null
  model: string | null
}

interface Asset {
  id: number
  name: string
  ip_address: string | null
  type: string
  status: string
  in_rack: boolean
  rack_name: string | null
}

const ASSET_TO_STENCIL: Record<string, UnitType> = {
  server: 'server', switch: 'switch', router: 'switch',
  firewall: 'firewall', storage: 'storage', fc_switch: 'switch',
  load_balancer: 'switch',
}

const U_HEIGHT = 22

const UNIT_TYPES = Object.entries(STENCILS) as [UnitType, typeof STENCILS[UnitType]][]

/* ── Rack Diagram ─────────────────────────────── */
function MiniMetricBar({ cpu, mem }: { cpu: number; mem: number }) {
  const barColor = (v: number) => v >= 90 ? 'bg-red-500' : v >= 70 ? 'bg-orange-400' : v >= 50 ? 'bg-yellow-400' : 'bg-green-500'
  return (
    <div className="flex items-center gap-1 ml-auto">
      <div className="flex items-center gap-0.5" title={`CPU ${cpu.toFixed(0)}%`}>
        <span className="text-[7px] text-white/40">C</span>
        <div className="w-8 bg-black/40 rounded-full h-1">
          <div className={`h-1 rounded-full ${barColor(cpu)}`} style={{ width: `${Math.min(cpu, 100)}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-0.5" title={`MEM ${mem.toFixed(0)}%`}>
        <span className="text-[7px] text-white/40">M</span>
        <div className="w-8 bg-black/40 rounded-full h-1">
          <div className={`h-1 rounded-full ${barColor(mem)}`} style={{ width: `${Math.min(mem, 100)}%` }} />
        </div>
      </div>
    </div>
  )
}

function RackView({
  rack, units, editMode, unitMetrics,
  onEditRack, onDeleteRack, onAddUnit, onEditUnit, onMoveUnit,
}: {
  rack: Rack
  units: RackUnit[]
  editMode: boolean
  unitMetrics: Record<number, { cpu: number; mem: number }>
  onEditRack: () => void
  onDeleteRack: () => void
  onAddUnit: (startU: number) => void
  onEditUnit: (u: RackUnit) => void
  onMoveUnit: (unitId: number, direction: 'up' | 'down') => void
}) {
  const used = units.reduce((s, u) => s + u.size_u, 0)
  const usedPct = Math.round((used / rack.total_u) * 100)

  const occupied = new Set<number>()
  for (const u of units) {
    for (let i = 0; i < u.size_u; i++) occupied.add(u.start_u - i)
  }

  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-[var(--c-border)] bg-[var(--c-hover)]">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-[var(--c-text)]">{rack.name}</span>
            {rack.location && <span className="text-xs text-[var(--c-muted)] ml-2">{rack.location}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--c-muted)]">{rack.total_u}U</span>
            {editMode && (
              <>
                <button onClick={onEditRack} className="p-1 rounded hover:bg-[var(--c-hover)] text-[var(--c-muted)] hover:text-[var(--c-text)]">
                  <Pencil size={12} />
                </button>
                <button onClick={onDeleteRack} className="p-1 rounded hover:bg-red-500/20 text-[var(--c-muted)] hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        </div>
        {rack.description && <p className="text-xs text-[var(--c-faint)] mt-0.5">{rack.description}</p>}
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-[var(--c-muted)] mb-1">
            <span>사용 {used}U / {rack.total_u}U</span>
            <span>{usedPct}%</span>
          </div>
          <div className="w-full bg-[var(--c-border)] rounded-full h-1">
            <div className={`h-1 rounded-full ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-orange-400' : 'bg-cyan-500'}`}
              style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      </div>

      {/* 랙 다이어그램 */}
      <div className="p-3">
        <div className="border border-[var(--c-border)]/20 rounded-lg overflow-hidden bg-[#0a0e1a]">
          <div className="flex">
            {/* U 번호 */}
            <div className="w-7 flex-shrink-0 border-r border-[var(--c-border)]/10">
              {Array.from({ length: rack.total_u }, (_, i) => {
                const uNo = rack.total_u - i
                return (
                  <div key={uNo} style={{ height: U_HEIGHT }}
                    className="flex items-center justify-center text-[8px] text-[var(--c-faint)]">
                    {uNo % 5 === 0 ? uNo : ''}
                  </div>
                )
              })}
            </div>

            {/* 슬롯 영역 */}
            <div className="flex-1 relative" style={{ height: rack.total_u * U_HEIGHT }}>
              {/* 빈 슬롯 */}
              {Array.from({ length: rack.total_u }, (_, i) => {
                const uNo = rack.total_u - i
                if (occupied.has(uNo)) return null
                return (
                  <div key={uNo}
                    style={{ top: i * U_HEIGHT, height: U_HEIGHT }}
                    className={`absolute inset-x-0 bg-[#0d1120] ${
                      editMode ? 'cursor-pointer hover:bg-[var(--cyan)]/5 group' : ''
                    }`}
                    onClick={editMode ? () => onAddUnit(uNo) : undefined}
                  >
                    {editMode && (
                      <div className="hidden group-hover:flex items-center justify-center h-full">
                        <Plus size={10} className="text-[var(--cyan)] opacity-50" />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* 장비 슬롯 */}
              {units.map(u => {
                const topIdx = rack.total_u - u.start_u
                const slotH = u.size_u * U_HEIGHT - 1
                const stencil = STENCILS[u.unit_type as UnitType]
                const borderColor = stencil?.stroke ?? '#64748b'
                const online = u.asset_status === 'online'
                const hasAsset = u.asset_id != null
                return (
                  <div key={u.id}
                    style={{ top: topIdx * U_HEIGHT, height: slotH, borderColor }}
                    className="absolute inset-x-0 mx-1 rounded border overflow-hidden group cursor-pointer hover:brightness-110 transition-all"
                    onClick={editMode ? () => onEditUnit(u) : undefined}
                  >
                    <StencilIcon type={u.unit_type} width={300} height={slotH} />
                    <div className={`absolute inset-0 flex ${u.size_u >= 2 ? 'flex-col justify-center px-2 py-0.5' : 'items-center px-2'} gap-0.5`}>
                      {u.size_u >= 2 ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              !hasAsset ? 'bg-[var(--c-faint)]' :
                              online ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]' : 'bg-red-400'
                            }`} />
                            <span className="text-[10px] font-medium text-white truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{u.label}</span>
                          </div>
                          {(u.manufacturer || u.model) && (
                            <span className="text-[8px] text-white/40 truncate pl-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                              {[u.manufacturer, u.model].filter(Boolean).join(' ')}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            !hasAsset ? 'bg-[var(--c-faint)]' :
                            online ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]' : 'bg-red-400'
                          }`} />
                          <span className="text-[10px] font-medium text-white truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{u.label}</span>
                          {(u.manufacturer || u.model) && (
                            <span className="text-[8px] text-white/30 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                              {[u.manufacturer, u.model].filter(Boolean).join(' ')}
                            </span>
                          )}
                        </>
                      )}
                      {!editMode && u.asset_id && unitMetrics[u.asset_id] && (
                        <MiniMetricBar cpu={unitMetrics[u.asset_id].cpu} mem={unitMetrics[u.asset_id].mem} />
                      )}
                      {!editMode && u.asset_ip && !unitMetrics[u.asset_id ?? 0] && (
                        <span className="text-[8px] text-white/50 font-mono ml-auto hidden group-hover:block">{u.asset_ip?.split('/')[0]}</span>
                      )}
                      {editMode && (
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button onClick={e => { e.stopPropagation(); onMoveUnit(u.id, 'up') }}
                            className="p-0.5 rounded bg-black/40 hover:bg-black/60 text-white/70 hover:text-white">
                            <ChevronUp size={10} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); onMoveUnit(u.id, 'down') }}
                            className="p-0.5 rounded bg-black/40 hover:bg-black/60 text-white/70 hover:text-white">
                            <ChevronDown size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Modal wrapper ────────────────────────────── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl w-[460px] max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--c-border)]">
          <h3 className="text-sm font-bold text-[var(--c-text)]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--c-hover)] text-[var(--c-muted)]"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--c-muted)] mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-3 py-2 text-xs text-[var(--c-text)] placeholder:text-[var(--c-faint)]'
const btnPrimary = 'px-4 py-2 text-xs bg-[var(--cyan-bg)] text-[var(--cyan)] border border-[var(--cyan)]/30 rounded-md hover:bg-[var(--cyan)]/20 disabled:opacity-50'
const btnDanger = 'px-4 py-2 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 disabled:opacity-50'
const btnCancel = 'px-4 py-2 text-xs text-[var(--c-muted)] border border-[var(--c-border)] rounded-md hover:bg-[var(--c-hover)]'

/* ── Main Page ────────────────────────────────── */
export default function RackPage() {
  const [racks, setRacks]     = useState<Rack[]>([])
  const [units, setUnits]     = useState<RackUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)

  // Modals
  const [rackModal, setRackModal]   = useState<Partial<Rack> | null>(null)
  const [unitModal, setUnitModal]   = useState<(Partial<RackUnit> & { rack_id: number }) | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'rack' | 'unit'; id: number; label: string } | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [saving, setSaving] = useState(false)
  const [showNewAsset, setShowNewAsset] = useState(false)
  const [newAssetName, setNewAssetName] = useState('')
  const [newAssetIp, setNewAssetIp] = useState('')
  const [creatingAsset, setCreatingAsset] = useState(false)
  const [unitMetrics, setUnitMetrics] = useState<Record<number, { cpu: number; mem: number }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rack')
      const data = await res.json()
      setRacks(data.racks ?? [])
      setUnits(data.units ?? [])

      // Fetch metrics for units with asset_id
      const assetIds = [...new Set((data.units ?? []).map((u: RackUnit) => u.asset_id).filter(Boolean))] as number[]
      if (assetIds.length > 0) {
        Promise.all(
          assetIds.map(id =>
            fetch(`/api/metrics?asset_id=${id}&range=1h`).then(r => r.json()).then(d => {
              const pts = d.metrics ?? []
              const latest = pts[pts.length - 1]
              return { id, cpu: Number(latest?.cpu_usage ?? 0), mem: Number(latest?.mem_usage ?? 0) }
            }).catch(() => null)
          )
        ).then(results => {
          const m: Record<number, { cpu: number; mem: number }> = {}
          for (const r of results) { if (r) m[r.id] = { cpu: r.cpu, mem: r.mem } }
          setUnitMetrics(m)
        })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadAssets = useCallback(async () => {
    const res = await fetch('/api/rack?assets=1')
    if (res.ok) {
      const data = await res.json()
      setAssets(data.assets ?? [])
    }
  }, [])

  /* ── Rack CRUD ─────────────────────────────── */
  const saveRack = async () => {
    if (!rackModal || !rackModal.name?.trim()) return
    setSaving(true)
    try {
      const isEdit = rackModal.id != null
      await fetch('/api/rack', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isEdit ? 'update_rack' : 'create_rack',
          ...rackModal,
        }),
      })
      setRackModal(null)
      load()
    } finally { setSaving(false) }
  }

  /* ── Unit CRUD ─────────────────────────────── */
  const saveUnit = async () => {
    if (!unitModal || !unitModal.label?.trim() || !unitModal.start_u) return
    setSaving(true)
    try {
      const isEdit = unitModal.id != null
      const res = await fetch('/api/rack', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isEdit ? 'update_unit' : 'create_unit',
          ...unitModal,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        if (err.error === 'slot overlap') alert('해당 위치에 이미 장비가 있습니다.')
        else if (err.error === 'invalid U range') alert('유효하지 않은 U 위치입니다.')
        return
      }
      setUnitModal(null)
      load()
    } finally { setSaving(false) }
  }

  /* ── Move unit up/down ──────────────────────── */
  const moveUnit = useCallback(async (unitId: number, direction: 'up' | 'down') => {
    const unit = units.find(u => u.id === unitId)
    if (!unit) return
    const rack = racks.find(r => r.id === unit.rack_id)
    if (!rack) return
    const newStartU = direction === 'up' ? unit.start_u + 1 : unit.start_u - 1
    if (newStartU < 1 || newStartU > rack.total_u || newStartU - unit.size_u + 1 < 1) return
    const res = await fetch('/api/rack', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_unit', id: unitId, start_u: newStartU }),
    })
    if (res.ok) load()
  }, [units, racks, load])

  /* ── Delete ────────────────────────────────── */
  const confirmDelete = async () => {
    if (!deleteTarget) return
    await fetch(`/api/rack?type=${deleteTarget.type}&id=${deleteTarget.id}`, { method: 'DELETE' })
    setDeleteTarget(null)
    load()
  }

  /* ── Render ────────────────────────────────── */
  const totalU = racks.reduce((s, r) => s + r.total_u, 0)
  const usedU = units.reduce((s, u) => s + u.size_u, 0)
  const locations = [...new Set(racks.map(r => r.location).filter(Boolean))]

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Layers size={20} className="text-cyan-400" /> Rack 실장 현황
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">데이터센터 랙 장비 배치 현황</p>
        </div>
        <div className="flex items-center gap-2">
          {editMode && (
            <button onClick={() => setRackModal({ total_u: 42 })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--cyan-bg)] text-[var(--cyan)] border border-[var(--cyan)]/30 rounded-lg hover:bg-[var(--cyan)]/20">
              <Plus size={13} />랙 추가
            </button>
          )}
          <button onClick={() => setEditMode(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              editMode
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                : 'text-[var(--c-muted)] border-[var(--c-border)] hover:text-[var(--c-text)]'
            }`}>
            <Pencil size={13} />{editMode ? '편집 중' : '편집'}
          </button>
          <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 랙', value: racks.length, color: 'text-[var(--c-text)]' },
          { label: '전체 U', value: `${totalU}U`, color: 'text-cyan-400' },
          { label: '사용 U', value: `${usedU}U`, color: 'text-purple-400' },
          { label: '여유 U', value: `${totalU - usedU}U`, color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STENCILS).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1.5 text-xs text-[var(--c-muted)]">
            <div className="w-3 h-3 rounded-sm border" style={{ background: cfg.color, borderColor: cfg.stroke }} />
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* 위치별 랙 그룹 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--c-muted)]">
          <RefreshCw size={18} className="animate-spin mr-2" /> 로딩 중...
        </div>
      ) : racks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--c-faint)]">
          <Layers size={40} className="mb-3 opacity-30" />
          <p className="text-sm">등록된 랙이 없습니다</p>
          {editMode && <p className="text-xs mt-1">상단의 &quot;랙 추가&quot; 버튼으로 랙을 생성하세요</p>}
        </div>
      ) : (
        locations.map(loc => (
          <div key={loc}>
            <h2 className="text-sm font-semibold text-[var(--c-muted)] uppercase tracking-wide mb-3">{loc}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {racks
                .filter(r => r.location === loc)
                .map(rack => (
                  <RackView
                    key={rack.id}
                    rack={rack}
                    units={units.filter(u => u.rack_id === rack.id)}
                    editMode={editMode}
                    unitMetrics={unitMetrics}
                    onEditRack={() => setRackModal(rack)}
                    onDeleteRack={() => setDeleteTarget({ type: 'rack', id: rack.id, label: rack.name })}
                    onAddUnit={(startU) => {
                      loadAssets()
                      setUnitModal({ rack_id: rack.id, start_u: startU, size_u: 1, unit_type: 'server', label: '' })
                    }}
                    onEditUnit={(u) => {
                      loadAssets()
                      setUnitModal(u)
                    }}
                    onMoveUnit={moveUnit}
                  />
                ))}
            </div>
          </div>
        ))
      )}

      {/* ── Rack Modal ────────────────────────── */}
      {rackModal && (
        <Modal title={rackModal.id ? '랙 수정' : '새 랙 추가'} onClose={() => setRackModal(null)}>
          <Field label="이름 *">
            <input className={inputCls} value={rackModal.name ?? ''} placeholder="예: A-01"
              onChange={e => setRackModal(v => v && { ...v, name: e.target.value })} />
          </Field>
          <Field label="위치">
            <input className={inputCls} value={rackModal.location ?? ''} placeholder="예: IDC 1F"
              onChange={e => setRackModal(v => v && { ...v, location: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="열 번호">
              <input className={inputCls} value={rackModal.row_no ?? ''} placeholder="예: Row A"
                onChange={e => setRackModal(v => v && { ...v, row_no: e.target.value })} />
            </Field>
            <Field label="총 U 수">
              <input type="number" className={inputCls} value={rackModal.total_u ?? 42} min={1} max={52}
                onChange={e => setRackModal(v => v && { ...v, total_u: parseInt(e.target.value) || 42 })} />
            </Field>
          </div>
          <Field label="설명">
            <input className={inputCls} value={rackModal.description ?? ''} placeholder="용도, 비고 등"
              onChange={e => setRackModal(v => v && { ...v, description: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className={btnCancel} onClick={() => setRackModal(null)}>취소</button>
            <button className={btnPrimary} disabled={saving || !rackModal.name?.trim()} onClick={saveRack}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Unit Modal ────────────────────────── */}
      {unitModal && (
        <Modal title={unitModal.id ? '장비 수정' : '장비 배치'} onClose={() => setUnitModal(null)}>
          {/* 1. 자산 연결 (상단, 강조) */}
          <Field label="자산 연결">
            <select className={inputCls}
              value={unitModal.asset_id ?? ''}
              onChange={e => {
                const assetId = e.target.value ? Number(e.target.value) : null
                const selected = assets.find(a => a.id === assetId)
                setUnitModal(v => {
                  if (!v) return v
                  const prevAsset = assets.find(a => a.id === v.asset_id)
                  const shouldAutoFill = !v.label || v.label === prevAsset?.name
                  return {
                    ...v,
                    asset_id: assetId,
                    label: shouldAutoFill && selected ? selected.name : v.label,
                    unit_type: selected && ASSET_TO_STENCIL[selected.type] ? ASSET_TO_STENCIL[selected.type] : v.unit_type,
                    size_u: selected && ASSET_TO_STENCIL[selected.type] ? STENCILS[ASSET_TO_STENCIL[selected.type]].defaultSizeU : v.size_u,
                  }
                })
              }}
            >
              <option value="">자산을 선택하세요</option>
              {assets.map(a => (
                <option key={a.id} value={a.id} disabled={a.in_rack && a.id !== unitModal.asset_id}>
                  {a.name}{a.ip_address ? ` (${a.ip_address})` : ''}{a.in_rack && a.id !== unitModal.asset_id ? ` [${a.rack_name}]` : ''}
                </option>
              ))}
              {unitModal.asset_id && !assets.find(a => a.id === unitModal.asset_id) && (
                <option value={unitModal.asset_id}>현재 연결된 자산 (ID: {unitModal.asset_id})</option>
              )}
            </select>
            {/* 인라인 자산 생성 */}
            {!showNewAsset ? (
              <button className="mt-1.5 text-[11px] text-[var(--cyan)] hover:underline"
                onClick={() => setShowNewAsset(true)}>
                + 새 자산 등록
              </button>
            ) : (
              <div className="mt-2 p-3 rounded-lg border border-[var(--cyan)]/20 bg-[var(--cyan-bg)] space-y-2">
                <p className="text-[11px] font-medium text-[var(--cyan)]">새 자산 등록</p>
                <input className={inputCls} placeholder="자산명 *" value={newAssetName}
                  onChange={e => setNewAssetName(e.target.value)} />
                <input className={inputCls} placeholder="IP 주소 *" value={newAssetIp}
                  onChange={e => setNewAssetIp(e.target.value)} />
                <div className="flex gap-2">
                  <button className={btnCancel} onClick={() => { setShowNewAsset(false); setNewAssetName(''); setNewAssetIp('') }}>
                    취소
                  </button>
                  <button className={btnPrimary}
                    disabled={creatingAsset || !newAssetName.trim() || !newAssetIp.trim()}
                    onClick={async () => {
                      setCreatingAsset(true)
                      try {
                        const assetType = unitModal.unit_type && STENCILS[unitModal.unit_type as UnitType]
                          ? Object.entries(ASSET_TO_STENCIL).find(([, v]) => v === unitModal.unit_type)?.[0] ?? 'server'
                          : 'server'
                        const res = await fetch('/api/assets', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: newAssetName.trim(), ip_address: newAssetIp.trim(), asset_type: assetType }),
                        })
                        if (res.ok) {
                          const { id } = await res.json()
                          setNewAssetName(''); setNewAssetIp(''); setShowNewAsset(false)
                          await loadAssets()
                          setUnitModal(v => v && { ...v, asset_id: id, label: v.label || newAssetName.trim() })
                        }
                      } finally { setCreatingAsset(false) }
                    }}>
                    {creatingAsset ? '등록 중...' : '등록'}
                  </button>
                </div>
              </div>
            )}
          </Field>

          {/* 2. 스텐실 선택기 */}
          <Field label="장비 타입">
            <div className="grid grid-cols-4 gap-2">
              {UNIT_TYPES.map(([type, cfg]) => (
                <button key={type}
                  onClick={() => setUnitModal(v => v && { ...v, unit_type: type, size_u: cfg.defaultSizeU })}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                    unitModal.unit_type === type
                      ? 'border-[var(--cyan)] bg-[var(--cyan-bg)]'
                      : 'border-[var(--c-border)] hover:border-[var(--c-muted)]'
                  }`}
                >
                  <div className="w-full h-[22px] rounded overflow-hidden border" style={{ borderColor: cfg.stroke }}>
                    <StencilIcon type={type} width={100} height={20} />
                  </div>
                  <span className="text-[10px] text-[var(--c-muted)]">{cfg.label}</span>
                </button>
              ))}
            </div>
          </Field>

          {/* 3. 라벨 */}
          <Field label="라벨 *">
            <input className={inputCls} value={unitModal.label ?? ''} placeholder="장비명 (자산 선택 시 자동 입력)"
              onChange={e => setUnitModal(v => v && { ...v, label: e.target.value })} />
          </Field>

          {/* 4. U 위치 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작 U">
              <input type="number" className={inputCls} value={unitModal.start_u ?? ''} min={1}
                onChange={e => setUnitModal(v => v && { ...v, start_u: parseInt(e.target.value) || 1 })} />
            </Field>
            <Field label="크기 (U)">
              <input type="number" className={inputCls} value={unitModal.size_u ?? 1} min={1} max={12}
                onChange={e => setUnitModal(v => v && { ...v, size_u: parseInt(e.target.value) || 1 })} />
            </Field>
          </div>

          {unitModal.start_u && unitModal.size_u && (
            <p className="text-[10px] text-[var(--c-faint)]">
              U{unitModal.start_u - (unitModal.size_u ?? 1) + 1} ~ U{unitModal.start_u} 위치에 배치
            </p>
          )}

          <div className="flex justify-between pt-2">
            <div>
              {unitModal.id && (
                <button className={btnDanger}
                  onClick={() => {
                    setUnitModal(null)
                    setDeleteTarget({ type: 'unit', id: unitModal.id!, label: unitModal.label ?? '' })
                  }}>
                  삭제
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button className={btnCancel} onClick={() => setUnitModal(null)}>취소</button>
              <button className={btnPrimary}
                disabled={saving || !unitModal.label?.trim() || !unitModal.start_u}
                onClick={saveUnit}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm ────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeleteTarget(null)}>
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-6 w-[360px] shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm text-[var(--c-text)]">
              &quot;{deleteTarget.label}&quot;을(를) 삭제하시겠습니까?
            </p>
            {deleteTarget.type === 'rack' && (
              <p className="text-xs text-[var(--c-faint)] mt-1">랙에 배치된 모든 장비 정보도 함께 삭제됩니다.</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnCancel} onClick={() => setDeleteTarget(null)}>취소</button>
              <button className={btnDanger} onClick={confirmDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
