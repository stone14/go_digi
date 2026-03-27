import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

interface AssetInfo {
  id: number
  name: string
  asset_type: string
  status: string
  ip_address: string | null
}

// GET /api/assets/dependencies?id=N
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const idParam = new URL(req.url).searchParams.get('id')

  // id 없으면 전체 자산 목록만 반환 (드롭다운용)
  if (!idParam) {
    const assets = await query<AssetInfo>(
      `SELECT id, name, type AS asset_type, status,
              ip_address::text AS ip_address
       FROM assets WHERE is_active = true ORDER BY name`
    )
    return NextResponse.json({ assets })
  }

  const id = parseInt(idParam)

  // 중심 자산
  const center = await queryOne<AssetInfo>(
    `SELECT id, name, type AS asset_type, status,
            ip_address::text AS ip_address
     FROM assets WHERE id = $1 AND is_active = true`,
    [id]
  )
  if (!center) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const nodeMap = new Map<number, AssetInfo & { conn_types: string[] }>()
  const edges: { source_id: number; target_id: number; conn_type: string; label: string }[] = []

  const addNode = (a: AssetInfo, connType: string) => {
    if (nodeMap.has(a.id)) {
      nodeMap.get(a.id)!.conn_types.push(connType)
    } else {
      nodeMap.set(a.id, { ...a, conn_types: [connType] })
    }
  }

  const topoRows = await query<{
    src_asset_id: number | null; src_name: string | null
    src_type: string | null; src_status: string | null; src_ip: string | null
    tgt_asset_id: number | null; tgt_name: string | null
    tgt_type: string | null; tgt_status: string | null; tgt_ip: string | null
    link_type: string | null
    center_topo_id: number | null
  }>(
    `SELECT
       sn.asset_id AS src_asset_id, sa.name AS src_name,
       sa.type     AS src_type,    sa.status AS src_status,
       sa.ip_address::text AS src_ip,
       tn.asset_id AS tgt_asset_id, ta.name AS tgt_name,
       ta.type     AS tgt_type,    ta.status AS tgt_status,
       ta.ip_address::text AS tgt_ip,
       te.link_type,
       cn.id AS center_topo_id
     FROM topology_edges te
     JOIN topology_nodes sn ON sn.id = te.source_node
     JOIN topology_nodes tn ON tn.id = te.target_node
     LEFT JOIN assets sa ON sa.id = sn.asset_id
     LEFT JOIN assets ta ON ta.id = tn.asset_id
     LEFT JOIN topology_nodes cn ON cn.asset_id = $1
     WHERE (sn.asset_id = $1 OR tn.asset_id = $1)
       AND te.is_active = true`,
    [id]
  )

  for (const r of topoRows) {
    const lt = r.link_type ?? 'ethernet'
    // 반대편 자산
    if (r.src_asset_id === id) {
      if (r.tgt_asset_id) {
        addNode({ id: r.tgt_asset_id, name: r.tgt_name!, asset_type: r.tgt_type!, status: r.tgt_status!, ip_address: r.tgt_ip }, lt)
        edges.push({ source_id: id, target_id: r.tgt_asset_id, conn_type: lt, label: lt })
      }
    } else {
      if (r.src_asset_id) {
        addNode({ id: r.src_asset_id, name: r.src_name!, asset_type: r.src_type!, status: r.src_status!, ip_address: r.src_ip }, lt)
        edges.push({ source_id: r.src_asset_id, target_id: id, conn_type: lt, label: lt })
      }
    }
  }

  const storRows = await query<{
    storage_id: number; storage_name: string; storage_type: string
    storage_status: string; storage_ip: string | null
    server_id: number; server_name: string; server_type: string
    server_status: string; server_ip: string | null
    connection_type: string
  }>(
    `SELECT
       s.id AS storage_id, s.name AS storage_name, s.type AS storage_type,
       s.status AS storage_status, s.ip_address::text AS storage_ip,
       a.id AS server_id,  a.name AS server_name,  a.type AS server_type,
       a.status AS server_status, a.ip_address::text AS server_ip,
       sc.connection_type
     FROM storage_connections sc
     JOIN assets s ON s.id = sc.storage_asset_id
     JOIN assets a ON a.id = sc.server_asset_id
     WHERE (sc.storage_asset_id = $1 OR sc.server_asset_id = $1)
       AND sc.is_active = true`,
    [id]
  )

  for (const r of storRows) {
    const ct = r.connection_type
    if (r.storage_id === id) {
      addNode({ id: r.server_id, name: r.server_name, asset_type: r.server_type, status: r.server_status, ip_address: r.server_ip }, ct)
      edges.push({ source_id: id, target_id: r.server_id, conn_type: ct, label: ct })
    } else {
      addNode({ id: r.storage_id, name: r.storage_name, asset_type: r.storage_type, status: r.storage_status, ip_address: r.storage_ip }, ct)
      edges.push({ source_id: r.storage_id, target_id: id, conn_type: ct, label: ct })
    }
  }

  // 이 자산이 하이퍼바이저인 경우: 그 위에 올라간 VM들의 서버 자산
  const vmFromHost = await query<{
    vm_asset_id: number | null; vm_name: string; vm_status: string; vm_ip: string | null
  }>(
    `SELECT vm.asset_id AS vm_asset_id, vm.vm_name,
            CASE vm.power_state WHEN 'running' THEN 'online' ELSE 'offline' END AS vm_status,
            vm.ip_address::text AS vm_ip
     FROM virtual_machines vm
     JOIN virtual_hosts vh ON vh.id = vm.host_id
     WHERE vh.asset_id = $1`,
    [id]
  )
  for (const r of vmFromHost) {
    if (r.vm_asset_id) {
      addNode({ id: r.vm_asset_id, name: r.vm_name, asset_type: 'server', status: r.vm_status, ip_address: r.vm_ip }, 'virtual')
      edges.push({ source_id: id, target_id: r.vm_asset_id, conn_type: 'virtual', label: 'VM' })
    } else {
      // VM에 asset_id가 없으면 가상 노드 (음수 id로 구분)
      const vId = -(vm_fromHost_idx++)
      nodeMap.set(vId, { id: vId, name: r.vm_name, asset_type: 'vm', status: r.vm_status, ip_address: r.vm_ip, conn_types: ['virtual'] })
      edges.push({ source_id: id, target_id: vId, conn_type: 'virtual', label: 'VM' })
    }
  }

  // 이 자산이 VM 에이전트인 경우: 어느 하이퍼바이저에 속하는지
  const vmToHost = await query<{
    host_asset_id: number | null; host_name: string | null
    host_status: string | null; host_ip: string | null
  }>(
    `SELECT vh.asset_id AS host_asset_id, a.name AS host_name,
            a.status AS host_status, a.ip_address::text AS host_ip
     FROM virtual_machines vm
     JOIN virtual_hosts vh ON vh.id = vm.host_id
     LEFT JOIN assets a ON a.id = vh.asset_id
     WHERE vm.asset_id = $1`,
    [id]
  )
  for (const r of vmToHost) {
    if (r.host_asset_id) {
      addNode({ id: r.host_asset_id, name: r.host_name!, asset_type: 'server', status: r.host_status!, ip_address: r.host_ip }, 'virtual')
      edges.push({ source_id: r.host_asset_id, target_id: id, conn_type: 'virtual', label: 'Hypervisor' })
    }
  }

  // 중복 엣지 제거
  const edgeSet = new Set<string>()
  const uniqueEdges = edges.filter(e => {
    const k = `${Math.min(e.source_id, e.target_id)}-${Math.max(e.source_id, e.target_id)}-${e.conn_type}`
    if (edgeSet.has(k)) return false
    edgeSet.add(k); return true
  })

  const nodes = [...nodeMap.values()]

  // 연결 타입별 요약
  const summary = {
    network: uniqueEdges.filter(e => ['ethernet','fiber','lag','fc'].includes(e.conn_type)).length,
    storage: uniqueEdges.filter(e => ['nfs','iscsi','fc','smb','sas'].includes(e.conn_type)).length,
    virtual: uniqueEdges.filter(e => e.conn_type === 'virtual').length,
  }

  return NextResponse.json({ center, nodes, edges: uniqueEdges, summary })
}

let vm_fromHost_idx = 10000
