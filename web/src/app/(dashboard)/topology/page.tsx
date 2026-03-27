'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, BackgroundVariant,
  NodeProps, Handle, Position, MarkerType, NodeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Server, Network, Shield, HardDrive, RefreshCw, Save, Cpu, Search, LayoutGrid, X, ExternalLink, Thermometer, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import DiscoveryPanel from '@/components/topology/DiscoveryPanel'

interface TopoNode {
  id: number
  asset_id: number | null
  node_type: string
  label: string
  pos_x: number
  pos_y: number
  status: string | null
  ip_address: string | null
}
interface TopoEdge {
  id: number
  source_node: number
  target_node: number
  source_port: string | null
  target_port: string | null
  link_type: string | null
  method: string | null
  confidence: number
}

const NODE_COLOR: Record<string, string> = {
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
  hypervisor:   '#065f46',
  vm:           '#1d4ed8',
  unknown:      '#374151',
}
const NODE_ICON: Record<string, React.ReactNode> = {
  server:       <Server    size={14} />,
  switch:       <Network   size={14} />,
  router:       <Network   size={14} />,
  firewall:     <Shield    size={14} />,
  storage:      <HardDrive size={14} />,
  nas:          <HardDrive size={14} />,
  san:          <HardDrive size={14} />,
  fc_switch:    <Network   size={14} />,
  load_balancer:<Network   size={14} />,
  hypervisor:   <Server    size={14} />,
  vm:           <Cpu       size={14} />,
}

function metricColor(value: number): string {
  if (value >= 90) return '#ef4444'
  if (value >= 70) return '#f59e0b'
  if (value >= 50) return '#eab308'
  return '#22c55e'
}

function DeviceNode({ data }: NodeProps) {
  const baseBg = NODE_COLOR[data.node_type] ?? NODE_COLOR.unknown
  const icon   = NODE_ICON[data.node_type]
  const ring   = data.status === 'online'  ? 'border-green-500'
               : data.status === 'offline' ? 'border-red-500'
               : 'border-[var(--c-border)]'

  // Metric overlay: if metricValue is present, blend background toward metric color
  const overlayValue = data.metricValue as number | undefined
  const bg = overlayValue !== undefined
    ? metricColor(overlayValue)
    : baseBg

  // Alert indicator
  const alertSeverity = data.alertSeverity as string | undefined

  return (
    <div className={`rounded-xl border-2 ${ring} px-3 py-2 min-w-[110px] shadow-lg cursor-pointer relative`}
      style={{ background: overlayValue !== undefined ? `${bg}cc` : bg }}>
      <Handle type="target" position={Position.Top}    style={{ background: '#4b5563' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#4b5563' }} />
      {/* Alert dot */}
      {alertSeverity && (
        <div className={`absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--c-bg)] ${
          alertSeverity === 'critical' ? 'bg-red-500 animate-pulse' : 'bg-orange-400'
        }`} />
      )}
      <div className="flex items-center gap-1.5 text-[var(--c-text)]">
        {icon}
        <span className="text-xs font-semibold truncate max-w-[90px]">{data.label}</span>
      </div>
      {data.ip_address && (
        <p className="text-[10px] text-[var(--c-text)] mt-0.5 font-mono">{data.ip_address}</p>
      )}
      {overlayValue !== undefined ? (
        <div className="mt-1 flex items-center gap-1">
          <div className="flex-1 bg-black/30 rounded-full h-1.5">
            <div className="h-1.5 rounded-full" style={{ width: `${Math.min(overlayValue, 100)}%`, background: metricColor(overlayValue) }} />
          </div>
          <span className="text-[9px] font-medium text-white/90">{overlayValue.toFixed(0)}%</span>
        </div>
      ) : data.status ? (
        <div className={`mt-1 text-[9px] font-medium px-1 rounded-sm inline-block
          ${data.status === 'online' ? 'bg-green-500/30 text-green-300'
          : data.status === 'offline' ? 'bg-red-500/30 text-red-300'
          : 'bg-[var(--c-hover)] text-[var(--c-muted)]'}`}>
          {data.status}
        </div>
      ) : null}
    </div>
  )
}

const NODE_TYPES = { device: DeviceNode }

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100 })
  nodes.forEach(n => g.setNode(n.id, { width: 130, height: 70 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - 65, y: y - 35 } }
  })
}

interface SelectedNodeInfo {
  id: string
  label: string
  node_type: string
  ip_address: string | null
  status: string | null
  asset_id: number | null
  metrics: { cpu_usage: number; mem_usage: number; disk_usage_pct: number } | null
  metricsLoading: boolean
}

function TopologyInner() {
  const [nodes,       setNodes,       onNodesChange] = useNodesState([])
  const [edges,       setEdges]       = useEdgesState([])
  const [loading,     setLoading]     = useState(true)
  const [dirty,       setDirty]       = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [connOnly,    setConnOnly]    = useState(true)
  const [layer,       setLayer]       = useState<'physical' | 'san'>('physical')
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [selected,    setSelected]    = useState<SelectedNodeInfo | null>(null)
  const [overlayMode, setOverlayMode] = useState<'' | 'cpu' | 'memory'>('')
  const [nodeMetrics, setNodeMetrics] = useState<Record<string, { cpu: number; mem: number }>>({})
  const [nodeAlerts,  setNodeAlerts]  = useState<Record<string, string>>({}) // asset_id → severity
  const hasPositions = useRef(false)
  const allData = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const connOnlyRef = useRef(connOnly)

  const applyFilter = useCallback((allNodes: Node[], allEdges: Edge[], connectedOnly: boolean) => {
    if (!connectedOnly) { setNodes(allNodes); setEdges(allEdges); return }
    const connected = new Set<string>()
    allEdges.forEach(e => { connected.add(e.source); connected.add(e.target) })
    const filtered = allEdges.length > 0
      ? allNodes.filter(n => connected.has(n.id))
      : allNodes
    const laid = (!hasPositions.current && filtered.length > 0)
      ? applyDagreLayout(filtered, allEdges)
      : filtered
    setNodes(laid)
    setEdges(allEdges)
  }, [setNodes, setEdges])

  const load = useCallback(async () => {
    setLoading(true)
    setDirty(false)
    setSelected(null)
    hasPositions.current = false
    try {
      const res  = await fetch(`/api/topology?layer=${layer}`)
      const data = await res.json() as { nodes: TopoNode[]; edges: TopoEdge[] }

      // 저장된 위치가 있으면 사용, 없으면 dagre 레이아웃
      hasPositions.current = data.nodes.some(n => n.pos_x !== 0 || n.pos_y !== 0)

      const rfNodes: Node[] = data.nodes.map(n => ({
        id:       String(n.id),
        type:     'device',
        position: { x: n.pos_x, y: n.pos_y },
        data: {
          label:     n.label,
          node_type: n.node_type,
          status:    n.status,
          ip_address:n.ip_address,
          asset_id:  n.asset_id,
        },
      }))

      const rfEdges: Edge[] = data.edges.map(e => ({
        id:           String(e.id),
        source:       String(e.source_node),
        target:       String(e.target_node),
        label:        e.method === 'storage_connection'
                        ? (e.link_type?.toUpperCase() ?? '') + (e.target_port ? ` → ${e.target_port}` : '')
                        : e.source_port && e.target_port
                          ? `${e.source_port} ↔ ${e.target_port}`
                          : e.source_port || '',
        labelStyle:   { fontSize: 9, fill: '#9ca3af' },
        labelBgStyle: { fill: 'var(--c-card)', fillOpacity: 0.8 },
        style:        {
          stroke: e.method === 'auto_lldp'          ? '#22d3ee'
                : e.method === 'auto_arp'           ? '#fb923c'
                : e.method === 'auto_wwn'           ? '#c084fc'
                : e.method === 'storage_connection' ? '#a855f7'
                : e.method === 'virtual_host'       ? '#00ff88'
                : '#6b7280',
          strokeWidth: 1.5,
          strokeDasharray: e.method === 'virtual_host' ? '5 3' : undefined,
        },
        markerEnd:    { type: MarkerType.ArrowClosed, color: '#4b5563' },
        animated:     e.method === 'auto_lldp' || e.method === 'auto_arp' || e.method === 'auto_wwn' || e.method === 'storage_connection',
      }))

      allData.current = { nodes: rfNodes, edges: rfEdges }
      applyFilter(rfNodes, rfEdges, connOnlyRef.current)
    } finally {
      setLoading(false)
    }
  }, [applyFilter, layer])

  useEffect(() => { load() }, [load])

  // 노드 드래그 후 dirty 마크
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes)
    if (changes.some(c => c.type === 'position' && c.dragging === false)) {
      setDirty(true)
    }
  }, [onNodesChange])

  // connOnly ref 동기화 + 필터 변경 시 재적용
  useEffect(() => {
    connOnlyRef.current = connOnly
    if (allData.current.nodes.length > 0) {
      applyFilter(allData.current.nodes, allData.current.edges, connOnly)
    }
  }, [connOnly, applyFilter])

  // 위치 저장
  const savePositions = useCallback(async () => {
    setSaving(true)
    try {
      const positions = nodes.map(n => ({
        id: parseInt(n.id),
        x: n.position.x,
        y: n.position.y,
      }))
      await fetch('/api/topology', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [nodes])

  // Fetch metrics for overlay
  useEffect(() => {
    if (!overlayMode) return
    const assetIds = nodes.map(n => n.data.asset_id).filter(Boolean) as number[]
    if (assetIds.length === 0) return
    Promise.all(
      assetIds.map(id =>
        fetch(`/api/metrics?asset_id=${id}&range=1h`).then(r => r.json()).then(data => {
          const pts = data.metrics ?? []
          const latest = pts[pts.length - 1]
          return { id, cpu: Number(latest?.cpu_usage ?? 0), mem: Number(latest?.mem_usage ?? 0) }
        }).catch(() => ({ id, cpu: 0, mem: 0 }))
      )
    ).then(results => {
      const m: Record<string, { cpu: number; mem: number }> = {}
      results.forEach(r => { m[String(r.id)] = { cpu: r.cpu, mem: r.mem } })
      setNodeMetrics(m)
    })
  }, [overlayMode, nodes])

  // Fetch alerts for node indicators
  useEffect(() => {
    fetch('/api/alerts?active=true&limit=200')
      .then(r => r.json())
      .then(data => {
        const alerts: Record<string, string> = {}
        for (const a of (data.alerts ?? [])) {
          if (!a.asset_id) continue
          const key = String(a.asset_id)
          const sev = a.severity ?? 'warning'
          if (!alerts[key] || sev === 'critical') alerts[key] = sev
        }
        setNodeAlerts(alerts)
      })
      .catch(() => {})
  }, [loading])

  // Apply overlay and alert data to nodes
  useEffect(() => {
    if (!overlayMode && Object.keys(nodeAlerts).length === 0) return
    setNodes(prev => prev.map(n => {
      const assetId = n.data.asset_id
      const metric = assetId ? nodeMetrics[String(assetId)] : undefined
      const alertSev = assetId ? nodeAlerts[String(assetId)] : undefined
      const metricValue = overlayMode && metric
        ? (overlayMode === 'cpu' ? metric.cpu : metric.mem)
        : undefined
      if (n.data.metricValue === metricValue && n.data.alertSeverity === alertSev) return n
      return { ...n, data: { ...n.data, metricValue, alertSeverity: alertSev } }
    }))
  }, [overlayMode, nodeMetrics, nodeAlerts, setNodes])

  return (
    <div className="flex flex-col h-screen bg-[var(--c-bg)]" style={{ height: 'calc(100vh - 64px)' }}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--c-border)] shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[var(--c-text)]">시스템 구성</h1>
          <p className="text-xs text-[var(--c-faint)]">물리 장비 간 연결 구조</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Layer Toggle */}
          <div className="flex rounded-lg border border-[var(--c-border)] overflow-hidden">
            {(['physical', 'san'] as const).map(l => (
              <button key={l} onClick={() => setLayer(l)}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  layer === l
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'text-[var(--c-faint)] hover:text-[var(--c-text)] hover:bg-[var(--c-hover)]'
                }`}>
                {l === 'physical' ? 'Physical' : 'SAN'}
              </button>
            ))}
          </div>

          <button onClick={() => setConnOnly(v => !v)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              connOnly
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                : 'text-[var(--c-faint)] border-[var(--c-border)] hover:text-[var(--c-text)]'
            }`}>
            {connOnly ? '연결된 장비만' : '전체 장비'}
          </button>

          {/* Metric Overlay Toggle */}
          <div className="flex rounded-lg border border-[var(--c-border)] overflow-hidden">
            <button onClick={() => setOverlayMode(v => v === 'cpu' ? '' : 'cpu')}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                overlayMode === 'cpu' ? 'bg-orange-500/20 text-orange-400' : 'text-[var(--c-faint)] hover:text-[var(--c-text)] hover:bg-[var(--c-hover)]'
              }`}>
              <Thermometer size={12} />CPU
            </button>
            <button onClick={() => setOverlayMode(v => v === 'memory' ? '' : 'memory')}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                overlayMode === 'memory' ? 'bg-purple-500/20 text-purple-400' : 'text-[var(--c-faint)] hover:text-[var(--c-text)] hover:bg-[var(--c-hover)]'
              }`}>
              <Thermometer size={12} />MEM
            </button>
          </div>

          <button onClick={() => {
              const laid = applyDagreLayout(
                allData.current.nodes.length > 0 ? [...allData.current.nodes] : [...nodes],
                allData.current.edges.length > 0 ? allData.current.edges : [...edges]
              )
              setNodes(laid)
              setDirty(true)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-hover)] transition-colors">
            <LayoutGrid size={13} />자동 배치
          </button>

          <button onClick={() => setDiscoverOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-hover)] transition-colors">
            <Search size={13} />자동 탐지
          </button>

          <button onClick={() => load()}
            className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <RefreshCw size={15} />
          </button>

          {dirty && (
            <button onClick={savePositions} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 transition-colors disabled:opacity-50">
              <Save size={13} />
              {saving ? '저장 중...' : '위치 저장'}
            </button>
          )}
        </div>
      </div>

      {/* React Flow */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--c-faint)]">
            <RefreshCw size={20} className="animate-spin mr-2" /> 로딩 중...
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--c-faint)]">
            <Network size={40} className="mb-3 opacity-30" />
            <p className="text-sm">토폴로지 데이터가 없습니다</p>
            <p className="text-xs mt-1">에이전트가 LLDP 데이터를 수집하면 자동으로 표시됩니다</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
            style={{ background: 'var(--c-bg)' }}
            onNodeClick={(_, node) => {
              const info: SelectedNodeInfo = {
                id: node.id,
                label: node.data.label,
                node_type: node.data.node_type,
                ip_address: node.data.ip_address,
                status: node.data.status,
                asset_id: node.data.asset_id,
                metrics: null,
                metricsLoading: !!node.data.asset_id,
              }
              setSelected(info)
              if (node.data.asset_id) {
                fetch(`/api/metrics?asset_id=${node.data.asset_id}&range=1h`)
                  .then(r => r.json())
                  .then(data => {
                    const pts = data.metrics ?? []
                    const latest = pts[pts.length - 1]
                    setSelected(prev => prev?.id === node.id ? {
                      ...prev,
                      metricsLoading: false,
                      metrics: latest ? {
                        cpu_usage: Number(latest.cpu_usage ?? 0),
                        mem_usage: Number(latest.mem_usage ?? 0),
                        disk_usage_pct: Number(latest.disk_usage_pct ?? 0),
                      } : null,
                    } : prev)
                  })
                  .catch(() => setSelected(prev => prev?.id === node.id ? { ...prev, metricsLoading: false } : prev))
              }
            }}
          >
            <Background variant={BackgroundVariant.Dots} color="var(--c-border)" gap={20} />
            <Controls style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }} />
            <MiniMap
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              nodeColor={n => NODE_COLOR[n.data?.node_type] ?? '#374151'}
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        )}

        {/* Node Info Panel */}
        {selected && (
          <div className="absolute top-4 right-4 w-72 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl shadow-2xl p-4 z-10">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {NODE_ICON[selected.node_type] ?? <Server size={14} />}
                <span className="text-sm font-semibold text-[var(--c-text)]">{selected.label}</span>
              </div>
              <button onClick={() => setSelected(null)} className="text-[var(--c-faint)] hover:text-[var(--c-text)]">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--c-faint)]">타입</span>
                <span className="text-[var(--c-text)] capitalize">{selected.node_type.replace('_', ' ')}</span>
              </div>
              {selected.ip_address && (
                <div className="flex justify-between">
                  <span className="text-[var(--c-faint)]">IP</span>
                  <span className="text-[var(--c-text)] font-mono">{selected.ip_address}</span>
                </div>
              )}
              {selected.status && (
                <div className="flex justify-between">
                  <span className="text-[var(--c-faint)]">상태</span>
                  <span className={selected.status === 'online' ? 'text-green-400' : selected.status === 'offline' ? 'text-red-400' : 'text-[var(--c-muted)]'}>{selected.status}</span>
                </div>
              )}
              {selected.metricsLoading && (
                <p className="text-[var(--c-faint)] text-center py-2"><RefreshCw size={12} className="inline animate-spin mr-1" />메트릭 로딩...</p>
              )}
              {selected.metrics && (
                <div className="border-t border-[var(--c-border)] pt-2 space-y-1.5">
                  {[
                    { label: 'CPU', value: selected.metrics.cpu_usage },
                    { label: 'Memory', value: selected.metrics.mem_usage },
                    { label: 'Disk', value: selected.metrics.disk_usage_pct },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="flex justify-between mb-0.5">
                        <span className="text-[var(--c-faint)]">{label}</span>
                        <span className={`font-medium ${value >= 90 ? 'text-red-400' : value >= 70 ? 'text-orange-400' : 'text-green-400'}`}>{value.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-[var(--c-border)] rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${value >= 90 ? 'bg-red-500' : value >= 70 ? 'bg-orange-400' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(value, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!selected.metricsLoading && !selected.metrics && selected.asset_id && (
                <p className="text-[var(--c-faint)] text-center py-1">메트릭 데이터 없음</p>
              )}
              {selected.asset_id && (
                <Link
                  href={selected.node_type === 'server' ? `/servers/${selected.asset_id}` : `/network/${selected.asset_id}`}
                  className="flex items-center justify-center gap-1.5 mt-2 px-3 py-1.5 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors"
                >
                  <ExternalLink size={12} />상세 보기
                </Link>
              )}
            </div>
          </div>
        )}

        {/* 범례 */}
        {nodes.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-[var(--c-card)]/90 border border-[var(--c-border)] rounded-xl p-3 text-xs space-y-1.5 backdrop-blur">
            <p className="text-[var(--c-muted)] font-medium mb-2">범례</p>
            {Object.entries(NODE_COLOR).filter(([k]) => k !== 'unknown').map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
                <span className="text-[var(--c-muted)] capitalize">{type.replace('_', ' ')}</span>
              </div>
            ))}
            <div className="border-t border-[var(--c-border)] pt-1.5 mt-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-cyan-400" />
                <span className="text-[var(--c-muted)]">LLDP 자동 검출</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ background: '#fb923c' }} />
                <span className="text-[var(--c-muted)]">ARP/MAC 자동 검출</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ background: '#c084fc' }} />
                <span className="text-[var(--c-muted)]">WWN 자동 검출</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-[var(--c-muted)]" />
                <span className="text-[var(--c-muted)]">수동 설정</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Discovery Panel */}
      <DiscoveryPanel
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        onDiscoveryComplete={() => load()}
      />
    </div>
  )
}

export default function TopologyPage() {
  return <TopologyInner />
}
