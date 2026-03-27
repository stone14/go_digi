'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ShieldCheck, RefreshCw, Plus, Edit2, Trash2,
  Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2,
} from 'lucide-react'

interface DomainSSL {
  id: number; domain: string; domain_type: string; issuer: string | null
  issued_at: string | null; expires_at: string | null; auto_renew: boolean
  contact_name: string | null; contact_email: string | null; notes: string | null
}

const EMPTY: Omit<DomainSSL, 'id'> = {
  domain: '', domain_type: 'ssl', issuer: '', issued_at: '', expires_at: '',
  auto_renew: false, contact_name: '', contact_email: '', notes: '',
}

function daysUntil(d: string | null) {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <span className="text-[var(--c-faint)] text-xs">—</span>
  const days = daysUntil(expiresAt)!
  if (days < 0)   return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-red-400/10 text-red-400">만료됨</span>
  if (days <= 30) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-orange-400/10 text-orange-400">{days}일</span>
  if (days <= 90) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-yellow-400/10 text-yellow-400">{days}일</span>
  return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-green-400/10 text-green-400">유효</span>
}

/* ── Import 관련 ── */
const SSL_HEADER_MAP: Record<string, string> = {
  '도메인': 'domain', '도메인명': 'domain',
  '구분': 'domain_type', '타입': 'domain_type',
  '발급기관': 'issuer', '발급자': 'issuer',
  '발급일': 'issued_at',
  '만료일': 'expires_at', '만료일자': 'expires_at',
  '자동갱신': 'auto_renew',
  '담당자': 'contact_name', '담당자명': 'contact_name',
  '이메일': 'contact_email', '담당자 이메일': 'contact_email',
  '메모': 'notes', '비고': 'notes',
}

type ImportRow = Record<string, unknown>

export default function SslPage() {
  const [list,    setList]    = useState<DomainSSL[]>([])
  const [tab,     setTab]     = useState<'all' | 'ssl' | 'domain'>('all')
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState<Partial<DomainSSL> & { id?: number } | null>(null)
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
      const res  = await fetch('/api/assets/ssl')
      const data = await res.json()
      setList(data.domains ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = tab === 'all' ? list : list.filter(d => d.domain_type === tab)
  const expiring = list.filter(d => { const x = daysUntil(d.expires_at); return x !== null && x >= 0 && x <= 90 }).length
  const expired  = list.filter(d => { const x = daysUntil(d.expires_at); return x !== null && x < 0 }).length

  async function save() {
    if (!editItem) return
    const method = editItem.id ? 'PUT' : 'POST'
    await fetch('/api/assets/ssl', {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editItem),
    })
    setEditItem(null); load()
  }

  async function del(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    await fetch(`/api/assets/ssl?id=${id}`, { method: 'DELETE' })
    load()
  }

  /* ── Template Download ── */
  async function downloadTemplate() {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('도메인 SSL')
    const cols = [
      { header: '도메인 *',    key: 'domain',        width: 30 },
      { header: '구분 *',      key: 'domain_type',   width: 12 },
      { header: '발급기관',    key: 'issuer',        width: 18 },
      { header: '발급일',      key: 'issued_at',     width: 14 },
      { header: '만료일',      key: 'expires_at',    width: 14 },
      { header: '자동갱신',    key: 'auto_renew',    width: 10 },
      { header: '담당자',      key: 'contact_name',  width: 14 },
      { header: '이메일',      key: 'contact_email', width: 22 },
      { header: '메모',        key: 'notes',         width: 30 },
    ]
    ws.columns = cols
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0a0e1a' } }
      cell.font = { color: { argb: 'FF00d4ff' }, bold: true, size: 11 }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1a2540' } } }
    })
    ws.addRow(['www.example.com', 'ssl', 'DigiCert', '2025-01-01', '2026-01-01', 'Y', '홍길동', 'admin@company.com', 'Wildcard SSL'])
    // domain_type validation
    ws.getColumn('domain_type').eachCell((cell, rowNumber) => {
      if (rowNumber > 1) {
        cell.dataValidation = { type: 'list', allowBlank: false, formulae: ['"ssl,domain"'] }
      }
    })
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ssl_domain_template.xlsx'
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
      const keys = headers.map(h => SSL_HEADER_MAP[h] ?? h)
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
        keys[colNumber] = SSL_HEADER_MAP[h] ?? h
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
    const validTypes = ['ssl', 'domain']
    rows.forEach((r, i) => {
      if (!r.domain) errs.push({ row: i + 1, error: '도메인 필수' })
      if (!r.domain_type || !validTypes.includes(String(r.domain_type))) {
        errs.push({ row: i + 1, error: `구분 오류: ${r.domain_type ?? '(없음)'} — ssl 또는 domain` })
      }
    })
    setImportRows(rows)
    setImportErrors(errs)
    setImportResult(null)
  }

  async function executeImport() {
    setImporting(true)
    try {
      const res = await fetch('/api/assets/ssl/import', {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <ShieldCheck size={20} className="text-green-400" /> 도메인 / SSL
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">SSL 인증서 · 도메인 만료 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {userRole === 'admin' && (
            <>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-[var(--c-text)] text-sm">
                <FileSpreadsheet size={14} />템플릿
              </button>
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm">
                <Upload size={14} />가져오기
              </button>
              <button onClick={() => setEditItem({ ...EMPTY })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm">
                <Plus size={14} />추가
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체',       value: list.length,                                              color: 'text-[var(--c-text)]' },
          { label: 'SSL 인증서', value: list.filter(d => d.domain_type === 'ssl').length,         color: 'text-green-400' },
          { label: '도메인',     value: list.filter(d => d.domain_type === 'domain').length,      color: 'text-cyan-400' },
          { label: '만료/임박',  value: expiring + expired,                                        color: expired > 0 ? 'text-red-400' : 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
            <p className="text-xs text-[var(--c-muted)]">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tab */}
      <div className="flex gap-1 bg-[var(--c-card)] border border-[var(--c-border)] rounded-lg p-1 w-fit">
        {(['all','ssl','domain'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${tab === t ? 'bg-[var(--c-hover)] text-[var(--c-text)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}>
            {t === 'all' ? '전체' : t === 'ssl' ? 'SSL' : '도메인'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)]">
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">도메인</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">구분</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">발급기관</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">유효기간</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">만료</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">자동갱신</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] font-medium">담당자</th>
              <th className="px-4 py-3 text-right text-[var(--c-muted)] font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">
                <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">항목 없음</td></tr>
            ) : filtered.map(d => (
              <tr key={d.id} className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)]">
                <td className="px-4 py-3 font-mono text-sm text-[var(--c-text)]">{d.domain}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${d.domain_type === 'ssl' ? 'bg-green-400/10 text-green-400' : 'bg-cyan-400/10 text-cyan-400'}`}>
                    {d.domain_type === 'ssl' ? 'SSL' : '도메인'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{d.issuer || '—'}</td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                  {d.issued_at?.slice(0,10) ?? '—'} ~ {d.expires_at?.slice(0,10) ?? '—'}
                </td>
                <td className="px-4 py-3"><ExpiryBadge expiresAt={d.expires_at} /></td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${d.auto_renew ? 'text-green-400' : 'text-[var(--c-faint)]'}`}>
                    {d.auto_renew ? '자동' : '수동'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{d.contact_name || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditItem({ ...d })} className="text-cyan-400 hover:text-cyan-300"><Edit2 size={13}/></button>
                    <button onClick={() => del(d.id)} className="text-red-400 hover:text-red-300"><Trash2 size={13}/></button>
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
                <Upload size={18} className="text-cyan-400" /> 도메인/SSL 가져오기
              </h2>
              <button onClick={closeImportModal} className="text-[var(--c-muted)] hover:text-[var(--c-text)]"><X size={18} /></button>
            </div>

            {importResult ? (
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
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">도메인</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">구분</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">발급기관</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">만료일</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">자동갱신</th>
                        <th className="px-2 py-1.5 text-left text-[var(--c-muted)]">담당자</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 10).map((r, i) => {
                        const hasErr = importErrors.some(e => e.row === i + 1)
                        return (
                          <tr key={i} className={`border-b border-[var(--c-border)]/50 ${hasErr ? 'bg-red-400/5' : ''}`}>
                            <td className="px-2 py-1.5 text-[var(--c-faint)]">{i + 1}</td>
                            <td className="px-2 py-1.5 text-[var(--c-text)]">{String(r.domain ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.domain_type ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.issuer ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.expires_at ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.auto_renew ?? '')}</td>
                            <td className="px-2 py-1.5 text-[var(--c-muted)]">{String(r.contact_name ?? '')}</td>
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
                    className="flex-1 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm">
                    {importing ? '등록 중...' : `${importRows.length}건 등록`}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-[var(--c-border)] rounded-xl p-10 text-center cursor-pointer hover:border-green-500/50 transition-colors"
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

      {/* Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[520px] shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-4">
              {editItem.id ? '수정' : '추가'} — 도메인 / SSL
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">도메인 *</label>
                  <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    placeholder="www.example.com" value={editItem.domain ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, domain: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">구분</label>
                  <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    value={editItem.domain_type ?? 'ssl'}
                    onChange={e => setEditItem(p => ({ ...p!, domain_type: e.target.value }))}>
                    <option value="ssl">SSL 인증서</option>
                    <option value="domain">도메인</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">발급기관</label>
                  <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    placeholder="DigiCert" value={editItem.issuer ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, issuer: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">발급일</label>
                  <input type="date" className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    value={editItem.issued_at ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, issued_at: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">만료일</label>
                  <input type="date" className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    value={editItem.expires_at ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, expires_at: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">담당자</label>
                  <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    placeholder="홍길동" value={editItem.contact_name ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, contact_name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">담당자 이메일</label>
                  <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-green-500"
                    placeholder="it@company.com" value={editItem.contact_email ?? ''}
                    onChange={e => setEditItem(p => ({ ...p!, contact_email: e.target.value }))} />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input type="checkbox" checked={!!editItem.auto_renew}
                  onChange={e => setEditItem(p => ({ ...p!, auto_renew: e.target.checked }))}
                  className="w-4 h-4 rounded accent-green-500" />
                <span className="text-sm text-[var(--c-text)]">자동 갱신</span>
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditItem(null)}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-text)] text-sm">취소</button>
              <button onClick={save} disabled={!editItem.domain}
                className="flex-1 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm">
                {editItem.id ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
