'use client'

import { useEffect, useState, useCallback, Fragment, Suspense } from 'react'
import {
  Package, Search, Plus, RefreshCw, Edit2, Trash2,
  Server, Network, HardDrive, Shield, GitBranch,
  ChevronDown, ChevronUp, Download, Upload, CheckSquare,
  Monitor, WifiOff, LayoutGrid, X, FileSpreadsheet,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

interface Asset {
  id: number
  name: string
  hostname: string
  ip_address: string
  asset_type: string
  status: string
  os_type: string
  location: string
  model: string | null
  manufacturer: string | null
  serial_number: string | null
  monitoring_enabled: boolean
  last_seen: string | null
  bmc_enabled: boolean
  introduced_at: string | null
  lifecycle_status: string
  decommission_at: string | null
  decommission_note: string | null
  agent_version: string | null
  registration_source: string | null
  manager: string | null
  user_name: string | null
  user_team: string | null
  org_id: number | null
}

interface Contract {
  id: number
  asset_id: number
  vendor: string
  contract_type: string
  start_date: string | null
  end_date: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
}

const TYPE_ICON: Record<string, JSX.Element> = {
  server:       <Server   size={14} className="text-cyan-400"   />,
  switch:       <Network  size={14} className="text-green-400"  />,
  router:       <Network  size={14} className="text-blue-400"   />,
  firewall:     <Shield   size={14} className="text-orange-400" />,
  storage:      <HardDrive size={14} className="text-purple-400"/>,
  fc_switch:    <Network  size={14} className="text-pink-400"   />,
  load_balancer:<Network  size={14} className="text-yellow-400" />,
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function relativeTime(dateStr: string | null): { text: string; color: string } {
  if (!dateStr) return { text: '—', color: 'text-[var(--c-faint)]' }
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 0)    return { text: '방금 전', color: 'text-green-400' }
  if (mins < 5)    return { text: `${mins}분 전`, color: 'text-green-400' }
  if (mins < 60)   return { text: `${mins}분 전`, color: 'text-yellow-400' }
  const hours = Math.floor(mins / 60)
  if (hours < 24)  return { text: `${hours}시간 전`, color: 'text-orange-400' }
  const days = Math.floor(hours / 24)
  return { text: `${days}일 전`, color: 'text-red-400' }
}

function ContractEndDate({ endDate }: { endDate: string | null }) {
  if (!endDate) return <span className="text-[var(--c-faint)]">—</span>
  const days = daysUntil(endDate)
  const cls = days < 0 ? 'text-red-400' : days <= 30 ? 'text-orange-400' : days <= 90 ? 'text-yellow-400' : 'text-[var(--c-muted)]'
  return <span className={cls}>{endDate.slice(0, 10)}</span>
}

function ContractBadge({ contract }: { contract: Contract | undefined }) {
  if (!contract) return <span className="text-[var(--c-faint)] text-xs">계약 없음</span>
  if (!contract.end_date) return <span className="text-[var(--c-faint)] text-xs">기간 미설정</span>

  const days = daysUntil(contract.end_date)
  if (days < 0)   return <span className="text-red-400 text-xs">만료됨</span>
  if (days <= 30) return <span className="text-orange-400 text-xs">{days}일 남음</span>
  if (days <= 90) return <span className="text-yellow-400 text-xs">{days}일 남음</span>
  return <span className="text-green-400 text-xs">유효 ({days}일)</span>
}

const EMPTY_ASSET = {
  name: '', hostname: '', ip_address: '', asset_type: 'server',
  os_type: '', location: '', manufacturer: '', model: '', serial_number: '',
  bmc_enabled: false, bmc_ip: '', bmc_type: 'idrac',
  monitoring_enabled: true, introduced_at: '',
  lifecycle_status: 'active', decommission_at: '', decommission_note: '',
  manager: '', user_name: '', user_team: '', org_id: '' as string | number | '',
}

const EMPTY_CONTRACT: {
  vendor: string; contract_type: string;
  start_date: string | null; end_date: string | null;
  contact_name: string; contact_email: string; contact_phone: string; notes: string;
} = {
  vendor: '', contract_type: 'maintenance',
  start_date: '', end_date: '',
  contact_name: '', contact_email: '', contact_phone: '', notes: '',
}

function AssetsPageInner() {
  const searchParams = useSearchParams()
  const [assets,    setAssets]    = useState<Asset[]>([])
  const [contracts, setContracts] = useState<Record<number, Contract>>({})
  const [total,     setTotal]     = useState(0)
  const [search,    setSearch]    = useState('')
  const [typeFilter,     setTypeFilter]     = useState(searchParams.get('type') ?? '')
  const [statusFilter,   setStatusFilter]   = useState(searchParams.get('status') ?? '')
  const [lifecycleFilter,setLifecycleFilter]= useState(searchParams.get('lifecycle') ?? '')
  const [loading,   setLoading]   = useState(true)
  const [userRole,  setUserRole]  = useState<string>('')
  const [orgList, setOrgList] = useState<{ id: number; name: string; org_type: string }[]>([])

  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => { if (d.user) setUserRole(d.user.role) }).catch(() => {})
    fetch('/api/organizations').then(r => r.json()).then(d => setOrgList(d.organizations ?? [])).catch(() => {})
  }, [])

  // Stats computed from loaded assets
  const stats = {
    total: assets.length,
    online: assets.filter(a => a.status === 'online').length,
    offline: assets.filter(a => a.status === 'offline' || a.status === 'warning').length,
    unracked: 0, // will be set after xref check — for now count assets not in xref with rack
  }

  function downloadCSV() {
    const header = ['장비명','호스트명','IP','타입','상태','OS','위치','제조사','모델','시리얼','도입시점','라이프사이클','관리담당자','사용자','사용팀']
    const rows = assets.map(a => [
      a.name, a.hostname, a.ip_address, a.asset_type, a.status,
      a.os_type, a.location, a.manufacturer ?? '', a.model ?? '',
      a.serial_number ?? '', a.introduced_at?.slice(0,10) ?? '', a.lifecycle_status,
      a.manager ?? '', a.user_name ?? '', a.user_team ?? '',
    ])
    const bom = '\uFEFF'
    const csv = bom + [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `assets_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkAction, setBulkAction] = useState('')

  function toggleSelect(id: number) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === assets.length ? new Set() : new Set(assets.map(a => a.id)))
  }
  async function executeBulkAction() {
    if (selectedIds.size === 0 || !bulkAction) return
    if (bulkAction === 'delete') {
      if (!confirm(`선택한 ${selectedIds.size}개 장비를 삭제하시겠습니까?`)) return
      await Promise.all([...selectedIds].map(id => fetch(`/api/assets?id=${id}`, { method: 'DELETE' })))
    } else {
      if (!confirm(`선택한 ${selectedIds.size}개 장비의 라이프사이클을 '${bulkAction}'(으)로 변경하시겠습니까?`)) return
      await Promise.all([...selectedIds].map(id =>
        fetch('/api/assets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, lifecycle_status: bulkAction }) })
      ))
    }
    setSelectedIds(new Set())
    setBulkAction('')
    load()
  }

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false)
  const [importData, setImportData] = useState<Record<string, string>[]>([])
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; created: number; errors: { row: number; error: string }[] } | null>(null)
  const HEADER_MAP: Record<string, string> = {
    '장비명': 'name', '장비명 *': 'name',
    '호스트명': 'hostname',
    'IP 주소': 'ip_address', 'IP 주소 *': 'ip_address',
    '타입': 'asset_type', '타입 *': 'asset_type',
    'OS': 'os_type',
    '위치': 'location',
    '제조사': 'manufacturer',
    '모델': 'model',
    '시리얼': 'serial_number',
    '도입시점': 'introduced_at',
    '관리담당자': 'manager',
    '사용자': 'user_name',
    '사용팀': 'user_team',
  }

  async function downloadTemplate() {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('자산 목록')
    ws.columns = [
      { header: '장비명 *', key: 'name', width: 20 },
      { header: '호스트명', key: 'hostname', width: 20 },
      { header: 'IP 주소 *', key: 'ip_address', width: 18 },
      { header: '타입 *', key: 'asset_type', width: 15 },
      { header: 'OS', key: 'os_type', width: 15 },
      { header: '위치', key: 'location', width: 20 },
      { header: '제조사', key: 'manufacturer', width: 15 },
      { header: '모델', key: 'model', width: 20 },
      { header: '시리얼', key: 'serial_number', width: 20 },
      { header: '도입시점', key: 'introduced_at', width: 14 },
      { header: '관리담당자', key: 'manager', width: 15 },
      { header: '사용자', key: 'user_name', width: 15 },
      { header: '사용팀', key: 'user_team', width: 15 },
    ]
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0E1A' } }
      cell.font = { color: { argb: 'FF00D4FF' }, bold: true, size: 11 }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1A2540' } } }
    })
    ws.addRow({
      name: 'Core-Switch-01', hostname: 'core-sw-01', ip_address: '192.168.1.1',
      asset_type: 'switch', os_type: 'IOS-XE', location: 'IDC-A Rack-03',
      manufacturer: 'Cisco', model: 'Catalyst 9300', serial_number: 'FCW2145xxxx',
      introduced_at: '2024-01-15', manager: '홍길동', user_name: '김철수', user_team: '인프라팀',
    })
    for (let r = 2; r <= 502; r++) {
      ws.getCell(r, 4).dataValidation = {
        type: 'list',
        formulae: ['"server,switch,router,firewall,storage,fc_switch,load_balancer"'],
      }
    }
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'asset_template.xlsx'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(file: File) {
    const buf = await file.arrayBuffer()

    let allRows: string[][] = []

    if (file.name.endsWith('.csv')) {
      const text = new TextDecoder('utf-8').decode(buf)
      allRows = text.split('\n').map(line =>
        line.replace(/\r$/, '').split(',').map(cell => cell.replace(/^"(.*)"$/, '$1').trim())
      ).filter(row => row.some(c => c))
    } else {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      const ws = wb.worksheets[0]
      if (!ws) { setImportErrors([{ row: 0, error: '시트를 찾을 수 없습니다' }]); return }
      ws.eachRow((row) => {
        const cells: string[] = []
        row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = String(cell.value ?? '').trim() })
        allRows.push(cells)
      })
    }

    if (allRows.length < 2) { setImportErrors([{ row: 0, error: '데이터가 없습니다' }]); return }

    const headers = allRows[0]
    const rows: Record<string, string>[] = []
    const errors: { row: number; error: string }[] = []

    for (let i = 1; i < allRows.length; i++) {
      const cells = allRows[i]
      const obj: Record<string, string> = {}
      headers.forEach((h, col) => {
        const field = HEADER_MAP[h]
        if (field && cells[col]) obj[field] = cells[col]
      })
      if (!obj.name && !obj.ip_address) continue
      if (!obj.name) errors.push({ row: i + 1, error: '장비명 필수' })
      if (!obj.ip_address) errors.push({ row: i + 1, error: 'IP 주소 필수' })
      if (!obj.asset_type) errors.push({ row: i + 1, error: '타입 필수' })
      rows.push(obj)
    }
    setImportData(rows)
    setImportErrors(errors)
  }

  async function executeImport() {
    setImporting(true)
    try {
      const res = await fetch('/api/assets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets: importData }),
      })
      const data = await res.json()
      setImportResult(data)
      if (data.ok) load()
    } finally {
      setImporting(false)
    }
  }

  function closeImportModal() {
    setShowImportModal(false)
    setImportData([])
    setImportErrors([])
    setImportResult(null)
  }

  // Modals
  const [editAsset,    setEditAsset]    = useState<Partial<typeof EMPTY_ASSET> & { id?: number } | null>(null)
  const [contractAsset,setContractAsset]= useState<Asset | null>(null)
  const [editContract, setEditContract] = useState<Partial<typeof EMPTY_CONTRACT> | null>(null)
  const [expandedId,   setExpandedId]   = useState<number | null>(null)
  const [xref, setXref] = useState<Record<number, { rack: { rack_name: string; start_u: number; size_u: number } | null; in_topology: boolean; agent: { last_seen: string } | null }>>({})
  const [swInstalls, setSwInstalls] = useState<Record<number, { software_name: string; software_version: string | null; vendor: string | null; end_date: string | null }[]>>({})

  useEffect(() => {
    if (expandedId && !xref[expandedId]) {
      fetch(`/api/assets/xref?id=${expandedId}`)
        .then(r => r.json())
        .then(data => setXref(prev => ({ ...prev, [expandedId]: data })))
    }
    if (expandedId && !swInstalls[expandedId]) {
      fetch(`/api/assets/software-installations?asset_id=${expandedId}`)
        .then(r => r.json())
        .then(data => setSwInstalls(prev => ({ ...prev, [expandedId]: data.installations ?? [] })))
    }
  }, [expandedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (typeFilter)      params.set('type', typeFilter)
      if (statusFilter)    params.set('status', statusFilter)
      if (lifecycleFilter) params.set('lifecycle', lifecycleFilter)
      if (search)          params.set('search', search)
      const res  = await fetch(`/api/assets?${params}`)
      const data = await res.json()
      setAssets(data.assets ?? [])
      setTotal(data.total ?? 0)

      // Load contracts
      const res2  = await fetch('/api/assets/contracts')
      const data2 = await res2.json()
      const cmap: Record<number, Contract> = {}
      for (const c of (data2.contracts ?? [])) cmap[c.asset_id] = c
      setContracts(cmap)
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, statusFilter, lifecycleFilter])

  useEffect(() => { load() }, [load])

  async function saveAsset() {
    if (!editAsset) return
    const method = editAsset.id ? 'PUT' : 'POST'
    await fetch('/api/assets', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editAsset),
    })
    setEditAsset(null)
    load()
  }

  async function deleteAsset(id: number) {
    if (!confirm('장비를 삭제하시겠습니까?')) return
    await fetch(`/api/assets?id=${id}`, { method: 'DELETE' })
    load()
  }

  async function saveContract() {
    if (!editContract || !contractAsset) return
    await fetch('/api/assets/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editContract, asset_id: contractAsset.id }),
    })
    setContractAsset(null)
    setEditContract(null)
    load()
  }

  const types = ['server','switch','router','firewall','storage','fc_switch','load_balancer']

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text)] flex items-center gap-2">
            <Package className="text-cyan-400" size={28} />
            자산 관리
          </h1>
          <p className="text-[var(--c-muted)] text-sm mt-1">장비 등록 · 유지보수 계약 · 담당자 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] hover:text-[var(--c-text)] text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />새로고침
          </button>
          <button onClick={downloadCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] hover:text-[var(--c-text)] text-sm">
            <Download size={14} />CSV
          </button>
          {userRole === 'admin' && (
            <>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] hover:text-[var(--c-text)] text-sm">
                <FileSpreadsheet size={14} />템플릿
              </button>
              <button onClick={() => setShowImportModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm">
                <Upload size={14} />가져오기
              </button>
              <button onClick={() => setEditAsset({ ...EMPTY_ASSET })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm">
                <Plus size={14} />장비 추가
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '전체 자산', value: stats.total, icon: LayoutGrid, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: '온라인',   value: stats.online,  icon: Monitor,    color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: '오프라인', value: stats.offline,  icon: WifiOff,    color: 'text-red-400',   bg: 'bg-red-500/10' },
          { label: '계약 없음', value: assets.filter(a => !contracts[a.id]).length, icon: Shield, color: 'text-orange-400', bg: 'bg-orange-500/10' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${bg}`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className="text-xs text-[var(--c-muted)]">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" size={14} />
          <input
            type="text" placeholder="이름, 호스트명, IP, 관리담당자, 사용자 검색..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
          />
        </div>
        <select
          value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
        >
          <option value="">전체 타입</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
        >
          <option value="">전체 상태</option>
          <option value="online">온라인</option>
          <option value="offline">오프라인</option>
          <option value="warning">경고</option>
        </select>
        <select
          value={lifecycleFilter} onChange={e => setLifecycleFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
        >
          <option value="">전체 라이프사이클</option>
          <option value="active">운영 중</option>
          <option value="decommission_pending">폐기 예정</option>
          <option value="decommissioned">폐기 완료</option>
          <option value="returned">반납 완료</option>
        </select>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
          <CheckSquare size={16} className="text-cyan-400" />
          <span className="text-sm text-cyan-400 font-medium">{selectedIds.size}개 선택</span>
          <select value={bulkAction} onChange={e => setBulkAction(e.target.value)}
            className="px-3 py-1.5 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-xs text-[var(--c-text)] focus:outline-none focus:border-cyan-500">
            <option value="">작업 선택...</option>
            <option value="active">운영 중으로 변경</option>
            <option value="decommission_pending">폐기 예정으로 변경</option>
            <option value="decommissioned">폐기 완료로 변경</option>
            <option value="returned">반납 완료로 변경</option>
            <option value="delete">선택 항목 삭제</option>
          </select>
          <button onClick={executeBulkAction} disabled={!bulkAction}
            className="px-3 py-1.5 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-40 transition-colors">
            실행
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto p-1 text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Asset Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)]">
              <th className="px-3 py-3 w-8">
                <input type="checkbox" checked={assets.length > 0 && selectedIds.size === assets.length}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded border-[var(--c-border)] accent-cyan-500 cursor-pointer" />
              </th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium w-8"></th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">장비명</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">타입</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">IP</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">위치</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">상태</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">최근 활동</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">도입시점</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">계약여부</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">완료시점</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">유지보수 담당자</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">관리담당자</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">사용자</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">사용팀</th>
              <th className="px-4 py-3 text-[var(--c-muted)] font-medium text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="text-center py-10 text-[var(--c-faint)]">
                <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
              </td></tr>
            ) : assets.length === 0 ? (
              <tr><td colSpan={16} className="text-center py-10 text-[var(--c-faint)]">등록된 장비가 없습니다</td></tr>
            ) : assets.map(asset => (
              <Fragment key={asset.id}>
                <tr
                  className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)] transition-colors">
                  {/* Checkbox */}
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selectedIds.has(asset.id)}
                      onChange={() => toggleSelect(asset.id)}
                      className="w-3.5 h-3.5 rounded border-[var(--c-border)] accent-cyan-500 cursor-pointer" />
                  </td>
                  {/* Expand toggle */}
                  <td className="px-4 py-3">
                    <button onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                      className="text-[var(--c-faint)] hover:text-[var(--c-text)]">
                      {expandedId === asset.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--c-text)]">{asset.name}</div>
                    <div className="text-xs text-[var(--c-faint)]">{asset.hostname}</div>
                    {asset.lifecycle_status !== 'active' && (
                      <span className={`inline-flex mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium
                        ${asset.lifecycle_status === 'decommission_pending' ? 'bg-orange-400/10 text-orange-400'
                        : asset.lifecycle_status === 'decommissioned'       ? 'bg-red-400/10 text-red-400'
                        : 'bg-slate-400/10 text-slate-400'}`}>
                        {asset.lifecycle_status === 'decommission_pending' ? '폐기 예정'
                        : asset.lifecycle_status === 'decommissioned'       ? '폐기 완료'
                        : '반납 완료'}
                      </span>
                    )}
                    {asset.registration_source && asset.registration_source !== 'manual' && (
                      <span className={`inline-flex mt-0.5 ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        asset.registration_source === 'agent'
                          ? 'bg-cyan-400/10 text-cyan-400'
                          : 'bg-purple-400/10 text-purple-400'
                      }`}>
                        {asset.registration_source === 'agent' ? 'Agent' : 'Discovery'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {TYPE_ICON[asset.asset_type] ?? <Package size={14} className="text-[var(--c-muted)]" />}
                      <span className="text-[var(--c-text)] text-xs">{asset.asset_type}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--c-text)] text-xs">{asset.ip_address}</td>
                  <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{asset.location || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                      ${asset.status === 'online'  ? 'bg-green-400/10 text-green-400'
                      : asset.status === 'offline' ? 'bg-red-400/10 text-red-400'
                      : 'bg-[var(--c-muted)]/10 text-[var(--c-muted)]'}`}>
                      {asset.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {(() => { const r = relativeTime(asset.last_seen); return <span className={r.color}>{r.text}</span> })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                    {asset.introduced_at ? asset.introduced_at.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {contracts[asset.id]
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-400/10 text-green-400">유효</span>
                      : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-[var(--c-muted)]/10 text-[var(--c-faint)]">없음</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {contracts[asset.id]
                      ? <ContractEndDate endDate={contracts[asset.id].end_date} />
                      : <span className="text-[var(--c-faint)]">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                    {contracts[asset.id]?.contact_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{asset.manager || '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{asset.user_name || '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{asset.user_team || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setContractAsset(asset)
                          if (contracts[asset.id]) {
                            const c = contracts[asset.id]
                            setEditContract({
                              ...c,
                              contact_name:  c.contact_name  ?? undefined,
                              contact_email: c.contact_email ?? undefined,
                              contact_phone: c.contact_phone ?? undefined,
                              notes:         c.notes         ?? undefined,
                            })
                          } else {
                            setEditContract({ ...EMPTY_CONTRACT })
                          }
                        }}
                        className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-0.5"
                      >
                        <Shield size={12} />계약
                      </button>
                      <button
                        onClick={() => setEditAsset({ id: asset.id, name: asset.name, hostname: asset.hostname, ip_address: asset.ip_address, asset_type: asset.asset_type, os_type: asset.os_type, location: asset.location, manufacturer: asset.manufacturer ?? '', model: asset.model ?? '', serial_number: asset.serial_number ?? '', bmc_enabled: asset.bmc_enabled, monitoring_enabled: asset.monitoring_enabled, introduced_at: asset.introduced_at ?? '', lifecycle_status: asset.lifecycle_status, decommission_at: asset.decommission_at ?? '', decommission_note: asset.decommission_note ?? '', manager: asset.manager ?? '', user_name: asset.user_name ?? '', user_team: asset.user_team ?? '', org_id: asset.org_id ?? '' })}
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        <Edit2 size={12} />
                      </button>
                      <Link href={`/assets/dependencies?id=${asset.id}`}
                        className="text-xs text-green-400 hover:text-green-300"
                        title="의존성 맵">
                        <GitBranch size={12} />
                      </Link>
                      <button onClick={() => deleteAsset(asset.id)}
                        className="text-xs text-red-400 hover:text-red-300">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Expanded detail row */}
                {expandedId === asset.id && (
                  <tr key={`detail-${asset.id}`} className="border-b border-[var(--c-border)]/30 bg-[var(--c-bg)]">
                    <td colSpan={16} className="px-8 py-4">
                      <div className="grid grid-cols-4 gap-6 text-xs">
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">제조사 / 모델</p>
                          <p className="text-[var(--c-text)]">{asset.manufacturer || '—'} {asset.model || ''}</p>
                        </div>
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">시리얼 번호</p>
                          <p className="text-[var(--c-text)] font-mono">{asset.serial_number || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">OS 타입</p>
                          <p className="text-[var(--c-text)]">{asset.os_type || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">BMC</p>
                          <p className={asset.bmc_enabled ? 'text-green-400' : 'text-[var(--c-faint)]'}>
                            {asset.bmc_enabled ? '활성화' : '비활성화'}
                          </p>
                        </div>
                        {contracts[asset.id] && (
                          <>
                            <div>
                              <p className="text-[var(--c-faint)] mb-1">계약 벤더</p>
                              <p className="text-[var(--c-text)]">{contracts[asset.id].vendor}</p>
                            </div>
                            <div>
                              <p className="text-[var(--c-faint)] mb-1">계약 기간</p>
                              <p className="text-[var(--c-text)]">
                                {contracts[asset.id].start_date?.slice(0,10) ?? '—'} ~ {contracts[asset.id].end_date?.slice(0,10) ?? '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[var(--c-faint)] mb-1">담당자</p>
                              <p className="text-[var(--c-text)]">{contracts[asset.id].contact_name || '—'}</p>
                              <p className="text-[var(--c-muted)]">{contracts[asset.id].contact_email || ''}</p>
                              <p className="text-[var(--c-muted)]">{contracts[asset.id].contact_phone || ''}</p>
                            </div>
                            {contracts[asset.id].notes && (
                              <div>
                                <p className="text-[var(--c-faint)] mb-1">메모</p>
                                <p className="text-[var(--c-text)]">{contracts[asset.id].notes}</p>
                              </div>
                            )}
                          </>
                        )}
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">관리담당자</p>
                          <p className="text-[var(--c-text)]">{asset.manager || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">사용자 / 사용팀</p>
                          <p className="text-[var(--c-text)]">{asset.user_name || '—'} {asset.user_team ? `(${asset.user_team})` : ''}</p>
                        </div>
                        {/* 교차 참조 정보 */}
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">랙 위치</p>
                          {xref[asset.id]?.rack
                            ? <p className="text-green-400">{xref[asset.id].rack!.rack_name} U{xref[asset.id].rack!.start_u}</p>
                            : <p className="text-[var(--c-faint)]">미배치</p>}
                        </div>
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">토폴로지</p>
                          <p className={xref[asset.id]?.in_topology ? 'text-green-400' : 'text-[var(--c-faint)]'}>
                            {xref[asset.id]?.in_topology ? '등록됨' : '미등록'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--c-faint)] mb-1">에이전트</p>
                          {asset.agent_version
                            ? <p className="text-cyan-400">v{asset.agent_version}</p>
                            : <p className="text-[var(--c-faint)]">미설치</p>}
                        </div>
                      </div>
                      {/* 설치 소프트웨어 */}
                      {swInstalls[asset.id] && swInstalls[asset.id].length > 0 && (
                        <div className="mt-4 pt-3 border-t border-[var(--c-border)]/30">
                          <p className="text-[var(--c-faint)] text-xs mb-2">설치 소프트웨어</p>
                          <div className="flex flex-wrap gap-2">
                            {swInstalls[asset.id].map((sw, i) => (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--c-bg)] border border-[var(--c-border)]/40 text-xs">
                                <Package size={12} className="text-purple-400" />
                                <span className="text-[var(--c-text)]">{sw.software_name}</span>
                                {sw.software_version && <span className="text-[var(--c-muted)]">v{sw.software_version}</span>}
                                {sw.vendor && <span className="text-[var(--c-faint)]">· {sw.vendor}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Asset Add/Edit Modal */}
      {editAsset && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[560px] shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-4">
              {editAsset.id ? '장비 수정' : '장비 추가'}
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['장비명 *',  'name',         'Core-Switch-01'],
                  ['호스트명',  'hostname',     'core-sw-01'],
                  ['IP 주소 *', 'ip_address',   '192.168.1.1'],
                  ['OS 타입',   'os_type',      'Linux / Windows'],
                  ['제조사',    'manufacturer', 'Cisco'],
                  ['모델',      'model',        'Catalyst 9300'],
                  ['시리얼',    'serial_number','FCW2145...'],
                  ['위치',      'location',     'IDC-A Rack-03'],
                  ['도입시점',  'introduced_at','2024-01-01'],
                  ['관리담당자', 'manager',      '홍길동'],
                  ['사용자',    'user_name',    '김철수'],
                  ['사용팀',    'user_team',    '인프라팀'],
                ].map(([label, key, ph]) => (
                  <div key={key}>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">{label}</label>
                    <input
                      className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                      placeholder={ph}
                      value={(editAsset as Record<string, unknown>)[key] as string ?? ''}
                      onChange={e => setEditAsset(p => ({ ...p!, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                {orgList.length > 0 && (
                  <div>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">소속 조직</label>
                    <select
                      className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                      value={(editAsset as Record<string, unknown>).org_id as string ?? ''}
                      onChange={e => setEditAsset(p => ({ ...p!, org_id: e.target.value ? parseInt(e.target.value) : '' }))}
                    >
                      <option value="">없음</option>
                      {orgList.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">타입 *</label>
                  <select
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editAsset.asset_type}
                    onChange={e => setEditAsset(p => ({ ...p!, asset_type: e.target.value }))}
                  >
                    {types.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex items-end gap-4 pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!editAsset.monitoring_enabled}
                      onChange={e => setEditAsset(p => ({ ...p!, monitoring_enabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-cyan-500"
                    />
                    <span className="text-sm text-[var(--c-text)]">모니터링 활성</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!editAsset.bmc_enabled}
                      onChange={e => setEditAsset(p => ({ ...p!, bmc_enabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-cyan-500"
                    />
                    <span className="text-sm text-[var(--c-text)]">BMC 활성</span>
                  </label>
                </div>
              </div>
              {editAsset.bmc_enabled && (
                <div className="grid grid-cols-2 gap-3 border-t border-[var(--c-border)] pt-3">
                  <div>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">BMC IP</label>
                    <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                      placeholder="192.168.10.1"
                      value={(editAsset as Record<string,unknown>).bmc_ip as string ?? ''}
                      onChange={e => setEditAsset(p => ({ ...p!, bmc_ip: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">BMC 타입</label>
                    <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                      value={(editAsset as Record<string,unknown>).bmc_type as string ?? 'idrac'}
                      onChange={e => setEditAsset(p => ({ ...p!, bmc_type: e.target.value }))}>
                      <option value="idrac">Dell iDRAC</option>
                      <option value="ilo">HPE iLO</option>
                      <option value="ipmi">Generic IPMI</option>
                      <option value="xcc">Lenovo XCC</option>
                      <option value="irmc">Fujitsu iRMC</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
              {/* 라이프사이클 */}
              <div className="border-t border-[var(--c-border)] pt-3 grid grid-cols-2 gap-3">
                <div className={((editAsset as Record<string,unknown>).lifecycle_status as string ?? 'active') === 'active' ? 'col-span-2' : ''}>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">라이프사이클 상태</label>
                  <select
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={(editAsset as Record<string,unknown>).lifecycle_status as string ?? 'active'}
                    onChange={e => setEditAsset(p => ({ ...p!, lifecycle_status: e.target.value }))}>
                    <option value="active">운영 중</option>
                    <option value="decommission_pending">폐기 예정</option>
                    <option value="decommissioned">폐기 완료</option>
                    <option value="returned">반납 완료</option>
                  </select>
                </div>
                {((editAsset as Record<string,unknown>).lifecycle_status as string ?? 'active') !== 'active' && (
                  <>
                    <div>
                      <label className="text-xs text-[var(--c-muted)] mb-1 block">폐기/반납일</label>
                      <input type="date"
                        className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                        value={(editAsset as Record<string,unknown>).decommission_at as string ?? ''}
                        onChange={e => setEditAsset(p => ({ ...p!, decommission_at: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-[var(--c-muted)] mb-1 block">폐기/반납 사유</label>
                      <input
                        className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                        placeholder="노후화, 교체, 임대 반납 등..."
                        value={(editAsset as Record<string,unknown>).decommission_note as string ?? ''}
                        onChange={e => setEditAsset(p => ({ ...p!, decommission_note: e.target.value }))} />
                    </div>
                  </>
                )}
              </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditAsset(null)}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] hover:text-[var(--c-text)] text-sm">취소</button>
              <button onClick={saveAsset}
                disabled={!editAsset.name || !editAsset.ip_address}
                className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">
                {editAsset.id ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contract Modal */}
      {contractAsset && editContract && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[480px] shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-1">유지보수 계약</h2>
            <p className="text-[var(--c-muted)] text-sm mb-4">{contractAsset.name}</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">벤더 *</label>
                  <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    placeholder="Cisco Korea"
                    value={editContract.vendor ?? ''}
                    onChange={e => setEditContract(p => ({ ...p!, vendor: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">계약 유형</label>
                  <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editContract.contract_type ?? 'maintenance'}
                    onChange={e => setEditContract(p => ({ ...p!, contract_type: e.target.value }))}>
                    <option value="maintenance">유지보수</option>
                    <option value="warranty">보증</option>
                    <option value="support">기술지원</option>
                    <option value="rental">임대</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">시작일 *</label>
                  <input type="date" className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editContract.start_date ?? ''}
                    onChange={e => setEditContract(p => ({ ...p!, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">종료일 *</label>
                  <input type="date" className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editContract.end_date ?? ''}
                    onChange={e => setEditContract(p => ({ ...p!, end_date: e.target.value }))} />
                </div>
              </div>
              <div className="border-t border-[var(--c-border)] pt-3 space-y-3">
                <p className="text-xs text-[var(--c-faint)]">담당자 정보</p>
                {[
                  ['이름',   'contact_name',  '홍길동'],
                  ['이메일', 'contact_email', 'support@vendor.com'],
                  ['전화',   'contact_phone', '02-1234-5678'],
                ].map(([label, key, ph]) => (
                  <div key={key}>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">{label}</label>
                    <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                      placeholder={ph}
                      value={(editContract as Record<string,unknown>)[key] as string ?? ''}
                      onChange={e => setEditContract(p => ({ ...p!, [key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">메모</label>
                  <textarea className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500 resize-none"
                    rows={2} placeholder="계약 관련 메모..."
                    value={editContract.notes ?? ''}
                    onChange={e => setEditContract(p => ({ ...p!, notes: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setContractAsset(null); setEditContract(null) }}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">취소</button>
              <button onClick={saveContract}
                disabled={!editContract.vendor || !editContract.start_date || !editContract.end_date}
                className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[800px] shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--c-text)] flex items-center gap-2">
                <Upload size={20} className="text-green-400" />자산 가져오기
              </h2>
              <button onClick={closeImportModal} className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
                <X size={18} />
              </button>
            </div>

            {/* Step 1: File selection */}
            {importData.length === 0 && !importResult && (
              <div>
                <div
                  className="border-2 border-dashed border-[var(--c-border)] rounded-xl p-12 text-center cursor-pointer hover:border-cyan-500/50 transition-colors"
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.xlsx,.csv'
                    input.onchange = (e) => {
                      const f = (e.target as HTMLInputElement).files?.[0]
                      if (f) handleImportFile(f)
                    }
                    input.click()
                  }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-cyan-500') }}
                  onDragLeave={e => { e.currentTarget.classList.remove('border-cyan-500') }}
                  onDrop={e => {
                    e.preventDefault()
                    e.currentTarget.classList.remove('border-cyan-500')
                    const f = e.dataTransfer.files[0]
                    if (f) handleImportFile(f)
                  }}
                >
                  <FileSpreadsheet size={40} className="mx-auto mb-3 text-[var(--c-faint)]" />
                  <p className="text-[var(--c-text)] font-medium">파일을 드래그하거나 클릭하여 선택</p>
                  <p className="text-[var(--c-faint)] text-xs mt-1">.xlsx 또는 .csv 파일 지원 (최대 500건)</p>
                </div>
                <p className="text-xs text-[var(--c-faint)] mt-3">
                  템플릿이 없으신가요? 상단의 <span className="text-cyan-400">템플릿</span> 버튼으로 다운로드할 수 있습니다.
                </p>
                {importErrors.length > 0 && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    {importErrors.map((e, i) => (
                      <p key={i} className="text-xs text-red-400">{e.error}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Preview */}
            {importData.length > 0 && !importResult && (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm text-[var(--c-text)]">{importData.length}건 데이터</span>
                  {importErrors.length > 0 && (
                    <span className="text-sm text-red-400">{importErrors.length}건 오류</span>
                  )}
                </div>
                <div className="overflow-x-auto border border-[var(--c-border)] rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--c-hover)]">
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">#</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">장비명</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">IP</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">타입</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">위치</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">관리담당자</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">사용자</th>
                        <th className="px-3 py-2 text-left text-[var(--c-muted)]">사용팀</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importData.slice(0, 10).map((row, i) => {
                        const hasError = importErrors.some(e => e.row === i + 2)
                        return (
                          <tr key={i} className={`border-t border-[var(--c-border)]/50 ${hasError ? 'bg-red-500/10' : ''}`}>
                            <td className="px-3 py-1.5 text-[var(--c-faint)]">{i + 1}</td>
                            <td className="px-3 py-1.5 text-[var(--c-text)]">{row.name || <span className="text-red-400">—</span>}</td>
                            <td className="px-3 py-1.5 font-mono text-[var(--c-text)]">{row.ip_address || <span className="text-red-400">—</span>}</td>
                            <td className="px-3 py-1.5 text-[var(--c-text)]">{row.asset_type || <span className="text-red-400">—</span>}</td>
                            <td className="px-3 py-1.5 text-[var(--c-muted)]">{row.location || '—'}</td>
                            <td className="px-3 py-1.5 text-[var(--c-muted)]">{row.manager || '—'}</td>
                            <td className="px-3 py-1.5 text-[var(--c-muted)]">{row.user_name || '—'}</td>
                            <td className="px-3 py-1.5 text-[var(--c-muted)]">{row.user_team || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {importData.length > 10 && (
                  <p className="text-xs text-[var(--c-faint)] mt-2">... 외 {importData.length - 10}건</p>
                )}
                {importErrors.length > 0 && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-xs text-red-400 font-medium mb-1">유효성 오류:</p>
                    {importErrors.slice(0, 5).map((e, i) => (
                      <p key={i} className="text-xs text-red-400">행 {e.row}: {e.error}</p>
                    ))}
                    {importErrors.length > 5 && <p className="text-xs text-red-400">... 외 {importErrors.length - 5}건</p>}
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setImportData([]); setImportErrors([]) }}
                    className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">다시 선택</button>
                  <button onClick={executeImport}
                    disabled={importErrors.length > 0 || importing}
                    className="flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm">
                    {importing ? '가져오는 중...' : `${importData.length}건 가져오기`}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Result */}
            {importResult && (
              <div className="text-center py-6">
                {importResult.ok ? (
                  <>
                    <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                      <CheckSquare size={24} className="text-green-400" />
                    </div>
                    <p className="text-lg font-bold text-green-400 mb-1">{importResult.created}건 등록 완료</p>
                    <p className="text-xs text-[var(--c-faint)]">자산 목록이 업데이트되었습니다</p>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                      <X size={24} className="text-red-400" />
                    </div>
                    <p className="text-lg font-bold text-red-400 mb-2">가져오기 실패</p>
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-400">{e.row > 0 ? `행 ${e.row}: ` : ''}{e.error}</p>
                    ))}
                  </>
                )}
                <button onClick={closeImportModal}
                  className="mt-4 px-6 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] hover:text-[var(--c-text)] text-sm">닫기</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--c-faint)]">로딩 중...</div>}>
      <AssetsPageInner />
    </Suspense>
  )
}
