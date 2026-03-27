'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Node, Edge, Background, Controls,
  useNodesState, useEdgesState, BackgroundVariant,
  NodeProps, Handle, Position, MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import {
  GitBranch, Server, Network, Shield, HardDrive, Cpu,
  AlertTriangle, ChevronRight,
} from 'lucide-react'

interface AssetBasic {
  id: number
  name: string
  asset_type: string
  status: string
  ip_address: string | null
}

interface DepEdge {
  source_id: number
  target_id: number
  conn_type: string
  label: string
}

interface DepData {
  center: AssetBasic
  nodes: (AssetBasic & { conn_types: string[] })[]
  edges: DepEdge[]
  summary: { network: number; storage: number; virtual: number }
}

const TYPE_COLOR: Record<string, string> = {
  server:       '#0e7490',
  switch:       '#065f46',
  router:       '#1e40af',
  firewall:     '#92400e',
  nas:          '#6d28d9',
  san:          '#7c3aed',
  das:          '#5b21b6',
  storage:      '#581c87',
  fc_switch:    '#831843',
  load_balancer:'#713f12',
  vm:           '#1d4ed8',
  unknown:      '#374151',
}
const TYPE_ICON: Record<string, React.ReactNode> = {
  server:        <Server    size={13} />,
  switch:        <Network   size={13} />,
  router:        <Network   size={13} />,
  firewall:      <Shield    size={13} />,
  nas:           <HardDrive size={13} />,
  san:           <HardDrive size={13} />,
  das:           <HardDrive size={13} />,
  storage:       <HardDrive size={13} />,
  fc_switch:     <Network   size={13} />,
  load_balancer: <Network   size={13} />,
  vm:            <Cpu       size={13} />,
}

function edgeColor(connType: string) {
  if (['virtual'].includes(connType)) return '#00ff88'
  if (['nfs','iscsi','sas','smb'].includes(connType)) return '#a855f7'
  return '#00d4ff' // network
}

function DeviceNode({ data }: NodeProps) {
  const bg   = TYPE_COLOR[data.asset_type] ?? TYPE_COLOR.unknown
  const icon = TYPE_ICON[data.asset_type]
  const ring = data.isCenter    ? 'border-yellow-400 border-2'
             : data.status === 'online'  ? 'border-green-500/60'
             : data.status === 'offline' ? 'border-red-500/60'
             : 'border-[var(--c-border)]'

  return (
    <div
      className={`rounded-xl border ${ring} px-3 py-2 min-w-[120px] shadow-lg cursor-pointer select-none`}
      style={{ background: bg, opacity: data.status === 'offline' ? 0.7 : 1 }}>
      <Handle type="target" position={Position.Left}  style={{ background: '#4b5563', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#4b5563', width: 8, height: 8 }} />
      <div className="flex items-center gap-1.5 text-white">
        {data.isCenter && <span className="text-yellow-300">★</span>}
        {icon}
        <span className="text-xs font-semibold truncate max-w-[90px]">{data.label}</span>
      </div>
      {data.ip_address && (
        <p className="text-[10px] text-white/70 mt-0.5 font-mono">{data.ip_address}</p>
      )}
      <div className={`mt-1 text-[9px] font-medium px-1 rounded-sm inline-block
        ${data.status === 'online'  ? 'bg-green-500/30 text-green-200'
        : data.status === 'offline' ? 'bg-red-500/30 text-red-200'
        : 'bg-white/10 text-white/60'}`}>
        {data.status || 'unknown'}
      </div>
    </div>
  )
}

const NODE_TYPES = { device: DeviceNode }

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 120 })
  nodes.forEach(n => g.setNode(n.id, { width: 140, height: 70 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - 70, y: y - 35 } }
  })
}

function DependenciesInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const initialId    = searchParams.get('id') ? parseInt(searchParams.get('id')!) : null

  const [allAssets,  setAllAssets]  = useState<AssetBasic[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(initialId)
  const [depData,    setDepData]    = useState<DepData | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [search,     setSearch]     = useState('')

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges]                = useEdgesState([])

  // 전체 자산 목록 로드
  useEffect(() => {
    fetch('/api/assets/dependencies')
      .then(r => r.json())
      .then(d => setAllAssets(d.assets ?? []))
  }, [])

  // 선택된 자산 의존성 로드
  const loadDep = useCallback(async (id: number) => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/assets/dependencies?id=${id}`)
      const data = await res.json() as DepData
      setDepData(data)

      // ReactFlow 노드/엣지 생성
      const allNodes: AssetBasic[] = [data.center, ...data.nodes]
      const rfNodes: Node[] = allNodes.map(a => ({
        id:       String(a.id),
        type:     'device',
        position: { x: 0, y: 0 },
        data: {
          label:      a.name,
          asset_type: a.asset_type,
          status:     a.status,
          ip_address: a.ip_address,
          isCenter:   a.id === data.center.id,
        },
      }))

      const rfEdges: Edge[] = data.edges.map((e, i) => ({
        id:            `e${i}`,
        source:        String(e.source_id),
        target:        String(e.target_id),
        label:         e.label,
        labelStyle:    { fill: '#94a3b8', fontSize: 10 },
        style:         { stroke: edgeColor(e.conn_type), strokeWidth: 1.5 },
        markerEnd:     { type: MarkerType.ArrowClosed, color: edgeColor(e.conn_type) },
        animated:      e.conn_type === 'virtual',
      }))

      const laid = applyDagreLayout(rfNodes, rfEdges)
      setNodes(laid)
      setEdges(rfEdges)
    } finally { setLoading(false) }
  }, [setNodes, setEdges])

  useEffect(() => {
    if (selectedId) loadDep(selectedId)
  }, [selectedId, loadDep])

  const handleSelect = (id: number) => {
    setSelectedId(id)
    router.replace(`/assets/dependencies?id=${id}`)
  }

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const id = parseInt(node.id)
    if (!isNaN(id) && id > 0) handleSelect(id)
  }, [])

  // 영향 받는 자산 (온라인 자산 중 중심 자산에 의존)
  const impacted = depData
    ? depData.nodes.filter(n => n.status === 'online')
    : []

  const filteredAssets = allAssets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.ip_address ?? '').includes(search)
  )

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* ── 좌측 패널 ── */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-3">
        {/* 자산 선택 */}
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3">
          <p className="text-xs text-[var(--c-muted)] mb-2 font-medium">자산 선택</p>
          <input
            type="text"
            placeholder="자산명 또는 IP 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-xs text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500 mb-2"
          />
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {filteredAssets.map(a => (
              <button
                key={a.id}
                onClick={() => handleSelect(a.id)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left text-xs transition-colors
                  ${selectedId === a.id
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-[var(--c-muted)] hover:bg-[var(--c-hover)] hover:text-[var(--c-text)]'}`}>
                <div className="flex items-center gap-1.5">
                  {TYPE_ICON[a.asset_type] ?? <Server size={12} />}
                  <span className="truncate max-w-[140px]">{a.name}</span>
                </div>
                <ChevronRight size={10} />
              </button>
            ))}
          </div>
        </div>

        {/* 선택된 자산 정보 */}
        {depData && (
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3 space-y-3">
            <div>
              <p className="text-xs text-[var(--c-muted)] mb-1 font-medium">선택 자산</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: TYPE_COLOR[depData.center.asset_type] ?? '#374151' }}>
                  {TYPE_ICON[depData.center.asset_type] ?? <Server size={14} />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--c-text)]">{depData.center.name}</p>
                  <p className="text-[10px] text-[var(--c-faint)] font-mono">{depData.center.ip_address ?? '—'}</p>
                </div>
              </div>
              <div className={`mt-1.5 inline-flex text-[10px] px-2 py-0.5 rounded-full
                ${depData.center.status === 'online' ? 'bg-green-500/15 text-green-400'
                : depData.center.status === 'offline' ? 'bg-red-500/15 text-red-400'
                : 'bg-[var(--c-border)] text-[var(--c-muted)]'}`}>
                {depData.center.status}
              </div>
            </div>

            {/* 연결 요약 */}
            <div>
              <p className="text-xs text-[var(--c-muted)] mb-1.5 font-medium">연결 현황</p>
              <div className="space-y-1">
                {[
                  { label: '네트워크', count: depData.summary.network, color: 'text-cyan-400' },
                  { label: '스토리지', count: depData.summary.storage, color: 'text-purple-400' },
                  { label: '가상화',   count: depData.summary.virtual, color: 'text-green-400' },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--c-muted)]">{s.label}</span>
                    <span className={`text-[11px] font-semibold ${s.color}`}>{s.count}개</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 영향 분석 */}
            <div>
              <p className="text-xs text-[var(--c-muted)] mb-1.5 font-medium flex items-center gap-1">
                <AlertTriangle size={11} className="text-orange-400" />
                다운 시 영향 자산 ({impacted.length}개)
              </p>
              {impacted.length === 0 ? (
                <p className="text-[11px] text-[var(--c-faint)]">연결된 온라인 자산 없음</p>
              ) : (
                <div className="space-y-1">
                  {impacted.map(n => (
                    <button
                      key={n.id}
                      onClick={() => handleSelect(n.id)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-left hover:bg-red-500/20 transition-colors">
                      {TYPE_ICON[n.asset_type] ?? <Server size={11} />}
                      <span className="text-[11px] text-red-300 truncate">{n.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 범례 */}
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-3">
          <p className="text-xs text-[var(--c-muted)] mb-2 font-medium">범례</p>
          <div className="space-y-1.5">
            {[
              { color: '#00d4ff', label: '네트워크 연결 (이더넷/광)' },
              { color: '#a855f7', label: '스토리지 연결 (NFS/iSCSI/FC)' },
              { color: '#00ff88', label: '가상화 연결 (VM/Hypervisor)' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-2">
                <div className="w-6 h-0.5 rounded-full" style={{ background: l.color }} />
                <span className="text-[10px] text-[var(--c-faint)]">{l.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-yellow-400 text-xs">★</span>
              <span className="text-[10px] text-[var(--c-faint)]">선택된 자산 (중심)</span>
            </div>
            <p className="text-[9px] text-[var(--c-faint)] mt-1">노드 클릭 시 중심 자산 변경</p>
          </div>
        </div>
      </div>

      {/* ── ReactFlow 그래프 ── */}
      <div className="flex-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden relative">
        {!selectedId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--c-faint)]">
            <GitBranch size={40} className="mb-3 opacity-30" />
            <p className="text-sm">좌측에서 자산을 선택하면 의존성 맵이 표시됩니다</p>
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
            <div className="text-[var(--c-muted)] text-sm">로딩 중...</div>
          </div>
        )}
        {selectedId && nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--c-faint)]">
            <p className="text-sm">연결된 자산이 없습니다</p>
            <p className="text-xs mt-1">토폴로지 구성 후 다시 확인하세요</p>
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} color="rgba(255,255,255,0.05)" />
          <Controls style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }} />
        </ReactFlow>
      </div>
    </div>
  )
}

export default function DependenciesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
          <GitBranch size={20} className="text-cyan-400" /> 자산 의존성 맵
        </h1>
        <p className="text-sm text-[var(--c-muted)] mt-0.5">장비 간 연결 관계 · 장애 영향 범위 분석</p>
      </div>
      <Suspense fallback={<div className="text-[var(--c-faint)]">로딩 중...</div>}>
        <DependenciesInner />
      </Suspense>
    </div>
  )
}
