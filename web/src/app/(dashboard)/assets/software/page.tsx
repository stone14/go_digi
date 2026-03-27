'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Package2, Search, Plus, RefreshCw, Edit2, Trash2, Shield, Server,
  Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'

interface InstalledServer {
  asset_id: number
  name: string
  ip_address: string
}

interface SWLicense {
  id: number
  asset_id: number | null
  vendor: string
  contract_type: string
  software_name: string | null
  software_version: string | null
  license_count: number | null
  start_date: string | null
  end_date: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  installed_servers: InstalledServer[]
}

const EMPTY_SW: Omit<SWLicense, 'id'> = {
  asset_id: null,
  vendor: '',
  contract_type: 'software',
  software_name: '',
  software_version: '',
  license_count: null,
  start_date: '',
  end_date: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  notes: '',
  installed_servers: [],
}

function daysUntil(dateStr: string | null) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function ExpiryBadge({ endDate }: { endDate: string | null }) {
  if (!endDate) return <span className="text-[var(--c-faint)] text-xs">—</span>
  const days = daysUntil(endDate)!
  if (days < 0)   return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-400/10 text-red-400">만료됨</span>
  if (days <= 30) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-orange-400/10 text-orange-400">{days}일 남음</span>
  if (days <= 90) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-400/10 text-yellow-400">{days}일 남음</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-400/10 text-green-400">유효</span>
}

/* ── Import 관련 ── */
const SW_HEADER_MAP: Record<string, string> = {
  'SW명': 'software_name', '소프트웨어명': 'software_name',
  '버전': 'software_version',
  '벤더': 'vendor', '제조사': 'vendor',
  '라이선스 수': 'license_count', '라이선스수': 'license_count',
  '시작일': 'start_date', '계약시작일': 'start_date',
  '종료일': 'end_date', '계약종료일': 'end_date', '만료일': 'end_date',
  '담당자': 'contact_name', '담당자명': 'contact_name',
  '이메일': 'contact_email', '담당자 이메일': 'contact_email',
  '전화': 'contact_phone', '연락처': 'contact_phone',
  '메모': 'notes', '비고': 'notes',
}

type ImportRow = Record<string, unknown>

export default function SoftwarePage() {
  const [list,    setList]    = useState<SWLicense[]>([])
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState<Partial<SWLicense> & { id?: number } | null>(null)
  const [userRole, setUserRole] = useState<string>('')

  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => { if (d.user) setUserRole(d.user.role) }).catch(() => {})
  }, [])

  /* Import state */
  const [showImport, setShowImport]     = useState(false)
  const [importRows, setImportRows]     = useState<ImportRow[]>([])
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([])
  const [importResult, setImportResult] = useState<{ ok: boolean; created: number; errors: { row: number; error: string }[] } | null>(null)
  const [importing, setImporting]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/assets/contracts?type=software')
      const data = await res.json()
      setList(data.contracts ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = list.filter(sw => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      sw.software_name?.toLowerCase().includes(q) ||
      sw.vendor.toLowerCase().includes(q) ||
      sw.software_version?.toLowerCase().includes(q) ||
      sw.contact_name?.toLowerCase().includes(q)
    )
  })

  // Summary stats
  const total    = list.length
  const expiring = list.filter(sw => { const d = daysUntil(sw.end_date); return d !== null && d >= 0 && d <= 90 }).length
  const expired  = list.filter(sw => { const d = daysUntil(sw.end_date); return d !== null && d < 0 }).length
  const totalLic = list.reduce((s, sw) => s + (sw.license_count ?? 0), 0)

  async function save() {
    if (!editItem) return
    const method = editItem.id ? 'PUT' : 'POST'
    await fetch('/api/assets/contracts', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editItem, contract_type: 'software' }),
    })
    setEditItem(null)
    load()
  }

  async function del(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    await fetch(`/api/assets/contracts?id=${id}`, { method: 'DELETE' })
    load()
  }

  /* ── Template Download ── */
  async function downloadTemplate() {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('SW 인벤토리')
    const cols = [
      { header: 'SW명 *',     key: 'software_name',    width: 25 },
      { header: '버전',       key: 'software_version', width: 15 },
      { header: '벤더 *',     key: 'vendor',           width: 20 },
      { header: '라이선스 수', key: 'license_count',   width: 12 },
      { header: '시작일',     key: 'start_date',       width: 14 },
      { header: '종료일',     key: 'end_date',         width: 14 },
      { header: '담당자',     key: 'contact_name',     width: 14 },
      { header: '이메일',     key: 'contact_email',    width: 22 },
      { header: '전화',       key: 'contact_phone',    width: 16 },
      { header: '메모',       key: 'notes',            width: 30 },
    ]
    ws.columns = cols
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0a0e1a' } }
      cell.font = { color: { argb: 'FF00d4ff' }, bold: true, size: 11 }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1a2540' } } }
    })
    ws.addRow(['Oracle Database EE', '19c', 'Oracle Korea', 10, '2025-01-01', '2025-12-31', '홍길동', 'support@oracle.com', '02-1234-5678', '엔터프라이즈 라이선스'])
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'sw_template.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /* ── Import File Handler ── */
  async function handleImportFile(file: File) {
    const buf = await file.arrayBuffer()
    let rows: ImportRow[] = []

    if (file.name.endsWith('.csv')) {
      const text = new TextDecoder('utf-8').decode(buf)
      const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim())
      if (lines.length < 2) return
      const headers = lines[0].split(',').map(h => h.trim())
      const keys = headers.map(h => SW_HEADER_MAP[h] ?? h)
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim())
        const row: ImportRow = {}
        keys.forEach((k, j) => { row[k] = vals[j] ?? '' })
        rows.push(row)
      }
    } else {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      const ws = wb.worksheets[0]
      if (!ws || ws.rowCount < 2) return
      const headerRow = ws.getRow(1)
      const keys: string[] = []
      headerRow.eachCell((cell, colNumber) => {
        const h = String(cell.value ?? '').trim()
        keys[colNumber] = SW_HEADER_MAP[h] ?? h
      })
      for (let r = 2; r <= ws.rowCount; r++) {
        const row: ImportRow = {}
        const wsRow = ws.getRow(r)
        let empty = true
        wsRow.eachCell((cell, colNumber) => {
          const v = cell.value
          row[keys[colNumber]] = v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? '')
          if (v) empty = false
        })
        if (!empty) rows.push(row)
      }
    }

    // Client-side validation
    const errs: { row: number; error: string }[] = []
    rows.forEach((r, i) => {
      if (!r.software_name) errs.push({ row: i + 1, error: 'SW명 필수' })
      if (!r.vendor) errs.push({ row: i + 1, error: '벤더 필수' })
    })
    setImportRows(rows)
    setImportErrors(errs)
    setImportResult(null)
  }

  async function executeImport() {
    setImporting(true)
    try {
      const res = await fetch('/api/assets/contracts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: importRows }),
      })
      const data = await res.json()
      setImportResult(data)
      if (data.ok) load()
    } finally {
      setImporting(false)
    }
  }

  function closeImportModal() {
    setShowImport(false)
    setImportRows([])
    setImportErrors([])
    setImportResult(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Package2 size={20} className="text-purple-400" /> SW 인벤토리
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">소프트웨어 라이선스 · 계약 · 만료 현황</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)] transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {userRole === 'admin' && (
            <>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-[var(--c-text)] text-sm">
                <FileSpreadsheet size={14} />템플릿
              </button>
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm">
                <Upload size={14} />가져오기
              </button>
              <button onClick={() => setEditItem({ ...EMPTY_SW })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm">
                <Plus size={14} />SW 추가
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 SW',        value: total,      color: 'text-[var(--c-text)]' },
          { label: '총 라이선스 수',  value: totalLic,   color: 'text-cyan-400' },
          { label: '만료 임박 (90일)', value: expiring,  color: 'text-yellow-400' },
          { label: '만료됨',          value: expired,    color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" size={14} />
        <input
          type="text" placeholder="SW명, 벤더, 버전, 담당자 검색..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)]">
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">SW명</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">버전</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">벤더</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium text-center">라이선스</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">계약기간</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">만료 상태</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">설치 서버</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">담당자</th>
              <th className="px-4 py-3 text-[var(--c-muted)] font-medium text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-10 text-[var(--c-faint)]">
                <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-[var(--c-faint)]">등록된 SW가 없습니다</td></tr>
            ) : filtered.map(sw => (
              <tr key={sw.id}
                className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)] transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--c-text)]">{sw.software_name || '—'}</div>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)] font-mono">
                  {sw.software_version || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-text)]">{sw.vendor}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm font-bold text-cyan-400">
                    {sw.license_count ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                  {sw.start_date?.slice(0,10) ?? '—'} ~ {sw.end_date?.slice(0,10) ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <ExpiryBadge endDate={sw.end_date} />
                </td>
                <td className="px-4 py-3">
                  {sw.installed_servers?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {sw.installed_servers.map(s => (
                        <Link key={s.asset_id} href={`/servers/${s.asset_id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 text-[10px] hover:bg-cyan-500/20 transition-colors">
                          <Server size={9} />
                          {s.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[var(--c-faint)] text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="text-[var(--c-text)]">{sw.contact_name || '—'}</div>
                  {sw.contact_phone && <div className="text-[var(--c-faint)]">{sw.contact_phone}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setEditItem({ ...sw })}
                      className="text-xs text-purple-400 hover:text-purple-300">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => del(sw.id)}
                      className="text-xs text-red-400 hover:text-red-300">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[720px] shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--c-text)] flex items-center gap-2">
                <Upload size={18} className="text-green-400" /> SW 가져오기
              </h2>
              <button onClick={closeImportModal} className="text-[var(--c-muted)] hover:text-[var(--c-text)]"><X size={18} /></button>
            </div>

            {importResult ? (
              /* ── Result ── */
              <div className="text-center py-6">
                {importResult.ok ? (
                  <>
                    <CheckCircle2 size={48} className="mx-auto text-green-400 mb-3" />
                    <p className="text-lg font-bold text-green-400">{importResult.created}건 등록 완료</p>
                  </>
                ) : (
                  <>
                    <AlertCircle size={48} className="mx-auto text-red-400 mb-3" />
                    <p className="text-lg font-bold text-red-400">오류 발생</p>
                    <div className="mt-3 text-left max-h-40 overflow-y-auto">
                      {importResult.errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-400">{e.row > 0 ? `${e.row}행: ` : ''}{e.error}</p>
                      ))}
                    </div>
                  </>
                )}
                <button onClick={closeImportModal} className="mt-4 px-6 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] text-sm">닫기</button>
              </div>
            ) : importRows.length > 0 ? (
              /* ── Preview ── */
              <div>
                <p className="text-sm text-[var(--c-muted)] mb-2">미리보기 — {importRows.length}건</p>
                {importErrors.length > 0 && (
                  <div className="mb-3 p-2 bg-red-400/10 rounded-lg">
                    {importErrors.map((e, i) => (
                      <p key={i} className="text-xs text-red-400">{e.row}행: {e.error}</p>
                    ))}
                  </div>
                )}
                <div className="overflow-x-auto max-h-60 border border-[var(--c-border)] rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--c-border)] bg-[var(--c-hover)]">
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">#</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">SW명</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">벤더</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">버전</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">라이선스</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">시작일</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">종료일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 10).map((r, i) => {
                        const hasErr = importErrors.some(e => e.row === i + 1)
                        return (
                          <tr key={i} className={`border-b border-[var(--c-border)]/50 ${hasErr ? 'bg-red-400/5' : ''}`}>
                            <td className="px-2 py-1.5 text-[var(--c-faint)]">{i + 1}</td>
                            <td className="px-2 py-1.5 text-[var(--c-text)]">{String(r.software_name ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-text)]">{String(r.vendor ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.software_version ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.license_count ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.start_date ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.end_date ?? '')}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {importRows.length > 10 && (
                  <p className="text-xs text-[var(--c-faint)] mt-1">외 {importRows.length - 10}건...</p>
                )}
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setImportRows([]); setImportErrors([]) }}
                    className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] text-sm">다시 선택</button>
                  <button onClick={executeImport}
                    disabled={importErrors.length > 0 || importing}
                    className="flex-1 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm">
                    {importing ? '등록 중...' : `${importRows.length}건 등록`}
                  </button>
                </div>
              </div>
            ) : (
              /* ── File Selection ── */
              <div
                className="border-2 border-dashed border-[var(--c-border)] rounded-xl p-10 text-center cursor-pointer hover:border-purple-500/50 transition-colors"
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f) }}
                onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.csv'; input.onchange = () => { if (input.files?.[0]) handleImportFile(input.files[0]) }; input.click() }}
              >
                <FileSpreadsheet size={40} className="mx-auto text-[var(--c-faint)] mb-3" />
                <p className="text-sm text-[var(--c-text)]">Excel (.xlsx) 또는 CSV 파일을 드래그하거나 클릭하세요</p>
                <p className="text-xs text-[var(--c-faint)] mt-1">템플릿을 다운로드하여 데이터를 입력한 후 업로드하세요</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[560px] shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-4 flex items-center gap-2">
              <Package2 size={18} className="text-purple-400" />
              {editItem.id ? 'SW 수정' : 'SW 추가'}
            </h2>
            <div className="space-y-3">
              {/* SW 기본 정보 */}
              <p className="text-xs text-[var(--c-faint)] border-b border-[var(--c-border)] pb-1">소프트웨어 정보</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['SW명 *',  'software_name',    'Oracle Database EE'],
                  ['버전',    'software_version', '19c / 2022'],
                  ['벤더 *',  'vendor',           'Oracle Korea'],
                  ['라이선스 수', 'license_count', '10'],
                ] as [string, string, string][]).map(([label, key, ph]) => (
                  <div key={key}>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">{label}</label>
                    <input
                      className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-purple-500"
                      placeholder={ph}
                      type={key === 'license_count' ? 'number' : 'text'}
                      value={(editItem as Record<string, unknown>)[key] as string ?? ''}
                      onChange={e => setEditItem(p => ({
                        ...p!,
                        [key]: key === 'license_count' ? (e.target.value ? parseInt(e.target.value) : null) : e.target.value
                      }))}
                    />
                  </div>
                ))}
              </div>

              {/* 계약 기간 */}
              <p className="text-xs text-[var(--c-faint)] border-b border-[var(--c-border)] pb-1 mt-2">계약 기간</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">시작일</label>
                  <input type="date"
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-purple-500"
                    value={editItem.start_date ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">종료일</label>
                  <input type="date"
                    className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-purple-500"
                    value={editItem.end_date ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, end_date: e.target.value }))} />
                </div>
              </div>

              {/* 담당자 */}
              <p className="text-xs text-[var(--c-faint)] border-b border-[var(--c-border)] pb-1 mt-2">담당자</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['이름',   'contact_name',  '홍길동'],
                  ['전화',   'contact_phone', '02-1234-5678'],
                  ['이메일', 'contact_email', 'support@vendor.com'],
                ] as [string, string, string][]).map(([label, key, ph]) => (
                  <div key={key}>
                    <label className="text-xs text-[var(--c-muted)] mb-1 block">{label}</label>
                    <input
                      className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-purple-500"
                      placeholder={ph}
                      value={(editItem as Record<string, unknown>)[key] as string ?? ''}
                      onChange={e => setEditItem(p => ({ ...p!, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>

              {/* 메모 */}
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">메모</label>
                <textarea
                  className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-purple-500 resize-none"
                  rows={2} placeholder="라이선스 관련 메모..."
                  value={editItem.notes ?? ''}
                  onChange={e => setEditItem(p => ({ ...p!, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditItem(null)}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] text-sm">취소</button>
              <button onClick={save}
                disabled={!editItem.software_name || !editItem.vendor}
                className="flex-1 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm">
                {editItem.id ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
