'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, Upload, Trash2, Play, Eye, RefreshCw,
  ChevronDown, FileText, AlertCircle, Check,
} from 'lucide-react'

/* ── Types ────────────────────────────────────────────── */
interface Device {
  asset_id: number
  name: string
  type: string
  mac_entries: number
  wwn_entries: number
  last_updated: string | null
}

interface StatusData {
  servers_with_mac: number
  devices_with_mac_table: number
  devices_with_wwn: number
  last_discovery: { discovery_type: string; created_at: string; edges_created: number } | null
  devices: Device[]
}

interface ParsedEntry {
  mac?: string
  port?: string
  vlan?: number
  type?: string
  wwn?: string
  port_name?: string
  wwn_type?: string
}

interface ParseResult {
  vendor_detected: string
  type_detected: string
  entries: ParsedEntry[]
}

interface Discovery {
  source: string
  source_port: string
  source_mac?: string
  target: string
  target_port: string
  confidence: number
  is_new: boolean
  method: string
}

interface RunResult {
  dry_run: boolean
  ethernet: { edges_created: number; edges_updated: number; discoveries: Discovery[] }
  san: { edges_created: number; edges_updated: number; discoveries: Discovery[] }
}

/* ── Props ────────────────────────────────────────────── */
interface DiscoveryPanelProps {
  open: boolean
  onClose: () => void
  onDiscoveryComplete?: () => void
}

/* ── Component ────────────────────────────────────────── */
export default function DiscoveryPanel({ open, onClose, onDiscoveryComplete }: DiscoveryPanelProps) {
  // Status
  const [status, setStatus] = useState<StatusData | null>(null)

  // Upload form
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedAsset, setSelectedAsset] = useState<number | ''>('')
  const [vendor, setVendor] = useState<string>('auto')
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // New device registration
  const [showNewDevice, setShowNewDevice] = useState(false)
  const [newDeviceName, setNewDeviceName] = useState('')
  const [newDeviceIp, setNewDeviceIp] = useState('')
  const [creatingDevice, setCreatingDevice] = useState(false)

  // Parse result
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Discovery
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  /* ── Load status ───────────────────────────────────── */
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/topology/discover/status')
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (open) loadStatus()
  }, [open, loadStatus])

  /* ── Parse file or text ────────────────────────────── */
  const doParse = useCallback(async (file?: File) => {
    setParsing(true)
    setParsed(null)
    setSaveMsg('')
    try {
      let res: Response
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('vendor', vendor)
        res = await fetch('/api/topology/discover/parse', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/topology/discover/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pasteText, vendor }),
        })
      }
      if (res.ok) setParsed(await res.json())
    } finally {
      setParsing(false)
    }
  }, [vendor, pasteText])

  const handleFile = useCallback((file: File) => {
    doParse(file)
  }, [doParse])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  /* ── Save parsed data ──────────────────────────────── */
  const handleSave = useCallback(async () => {
    if (!parsed || !selectedAsset) return
    setSaving(true)
    setSaveMsg('')
    try {
      const isWwn = parsed.type_detected === 'wwn'
      const url = isWwn
        ? '/api/topology/discover/wwn-table'
        : '/api/topology/discover/device-table'

      const entries = isWwn
        ? parsed.entries.map(e => ({ wwn: e.wwn, port_name: e.port_name, wwn_type: e.wwn_type || 'switch_port' }))
        : parsed.entries.map(e => ({ mac: e.mac, port: e.port, vlan: e.vlan, type: e.type }))

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: selectedAsset, entries, replace: true }),
      })

      if (res.ok) {
        const d = await res.json()
        setSaveMsg(`저장 완료: ${d.inserted}건 추가, ${d.updated}건 갱신`)
        loadStatus()
        setParsed(null)
        setPasteText('')
      }
    } finally {
      setSaving(false)
    }
  }, [parsed, selectedAsset, loadStatus])

  /* ── Delete device data ────────────────────────────── */
  const handleDelete = useCallback(async (assetId: number) => {
    await fetch(`/api/topology/discover/device-table?asset_id=${assetId}`, { method: 'DELETE' })
    loadStatus()
  }, [loadStatus])

  /* ── Create new device (auto-register to assets) ──── */
  const handleCreateDevice = useCallback(async () => {
    if (!newDeviceName.trim() || !selectedCategory) return
    setCreatingDevice(true)
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newDeviceName.trim(),
          ip_address: newDeviceIp.trim() || '0.0.0.0',
          asset_type: selectedCategory,
          registration_source: 'discovery',
        }),
      })
      if (res.ok) {
        const { id } = await res.json()
        setNewDeviceName('')
        setNewDeviceIp('')
        setShowNewDevice(false)
        await loadStatus()
        if (id) setSelectedAsset(id)
      }
    } finally {
      setCreatingDevice(false)
    }
  }, [newDeviceName, newDeviceIp, selectedCategory, loadStatus])

  /* ── Run discovery ─────────────────────────────────── */
  const handleRun = useCallback(async (dryRun: boolean) => {
    setRunning(true)
    setRunResult(null)
    try {
      const res = await fetch('/api/topology/discover/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all', dry_run: dryRun }),
      })
      if (res.ok) {
        const r = await res.json() as RunResult
        setRunResult(r)
        if (!dryRun && onDiscoveryComplete) onDiscoveryComplete()
      }
    } finally {
      setRunning(false)
    }
  }, [onDiscoveryComplete])

  /* ── Render ────────────────────────────────────────── */
  if (!open) return null

  const devices = status?.devices ?? []

  const DEVICE_CATEGORIES = [
    { value: 'network',   label: 'L2/L3 스위치' },
    { value: 'security',  label: '방화벽 / IDS / IPS' },
    { value: 'fc_switch', label: 'SAN 스위치 (FC)' },
    { value: 'san',       label: '스토리지 (SAN)' },
  ]
  const filteredDevices = selectedCategory
    ? devices.filter(d => d.type === selectedCategory)
    : devices

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[460px] z-50 bg-[var(--c-card)] border-l border-[var(--c-border)] shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--c-border)] shrink-0">
          <h2 className="text-sm font-bold text-[var(--c-text)]">자동 토폴로지 탐지</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--c-hover)] text-[var(--c-muted)]">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Upload Form ─────────────────────── */}
          <Section title="구성 정보 업로드">
            {/* Category selector */}
            <label className="block text-xs text-[var(--c-muted)] mb-1">장비 카테고리</label>
            <div className="relative mb-3">
              <select
                value={selectedCategory}
                onChange={e => { setSelectedCategory(e.target.value); setSelectedAsset(''); setShowNewDevice(false) }}
                className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-3 py-2 text-xs text-[var(--c-text)] appearance-none pr-8"
              >
                <option value="">카테고리를 선택하세요</option>
                {DEVICE_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-[var(--c-faint)] pointer-events-none" />
            </div>

            {/* Device selector — only visible after category is selected */}
            {selectedCategory && (
              <>
                <label className="block text-xs text-[var(--c-muted)] mb-1">장비 선택</label>
                <div className="relative mb-3">
                  <select
                    value={selectedAsset}
                    onChange={e => setSelectedAsset(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-3 py-2 text-xs text-[var(--c-text)] appearance-none pr-8"
                  >
                    <option value="">
                      {filteredDevices.length === 0 ? '등록된 장비 없음' : '장비를 선택하세요'}
                    </option>
                    {filteredDevices.map(d => (
                      <option key={d.asset_id} value={d.asset_id}>{d.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-[var(--c-faint)] pointer-events-none" />
                </div>
              </>
            )}

            {/* New device registration */}
            {selectedCategory && !showNewDevice && (
              <button
                onClick={() => setShowNewDevice(true)}
                className="mb-3 text-[10px] text-[var(--cyan)] hover:underline"
              >
                + 새 장비 추가
              </button>
            )}
            {showNewDevice && selectedCategory && (
              <div className="mb-3 p-2.5 border border-[var(--cyan)]/30 rounded-md bg-[var(--cyan-bg)] space-y-2">
                <p className="text-[10px] text-[var(--c-muted)] font-medium">
                  새 {DEVICE_CATEGORIES.find(c => c.value === selectedCategory)?.label} 등록
                </p>
                <input
                  value={newDeviceName}
                  onChange={e => setNewDeviceName(e.target.value)}
                  placeholder="장비명 (필수)"
                  className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--c-text)] placeholder:text-[var(--c-faint)]"
                />
                <input
                  value={newDeviceIp}
                  onChange={e => setNewDeviceIp(e.target.value)}
                  placeholder="IP 주소 (선택)"
                  className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--c-text)] placeholder:text-[var(--c-faint)]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateDevice}
                    disabled={creatingDevice || !newDeviceName.trim()}
                    className="px-2.5 py-1 text-[10px] bg-[var(--cyan)] text-white rounded-md hover:opacity-90 disabled:opacity-50"
                  >
                    {creatingDevice ? '등록 중...' : '등록'}
                  </button>
                  <button
                    onClick={() => { setShowNewDevice(false); setNewDeviceName(''); setNewDeviceIp('') }}
                    className="px-2.5 py-1 text-[10px] text-[var(--c-muted)] border border-[var(--c-border)] rounded-md hover:bg-[var(--c-hover)]"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}

            {/* Vendor */}
            <div className="mb-3">
              <label className="block text-xs text-[var(--c-muted)] mb-1">벤더</label>
              <div className="relative">
                <select
                  value={vendor}
                  onChange={e => setVendor(e.target.value)}
                  className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-3 py-2 text-xs text-[var(--c-text)] appearance-none pr-8"
                >
                  <option value="auto">자동감지</option>
                  <option value="cisco">Cisco</option>
                  <option value="juniper">Juniper</option>
                  <option value="fortigate">FortiGate</option>
                  <option value="brocade">Brocade FC</option>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-[var(--c-faint)] pointer-events-none" />
              </div>
            </div>

            {/* Drop zone */}
            <input ref={fileRef} type="file" accept=".txt,.csv,.log" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors mb-3
                ${dragOver
                  ? 'border-[var(--cyan)] bg-[var(--cyan-bg)]'
                  : 'border-[var(--c-border)] hover:border-[var(--c-muted)]'
                }`}
            >
              <Upload size={20} className="mx-auto mb-1.5 text-[var(--c-faint)]" />
              <p className="text-xs text-[var(--c-muted)]">파일을 드래그하거나 클릭</p>
              <p className="text-[10px] text-[var(--c-faint)] mt-0.5">.txt, .csv, .log</p>
            </div>

            {/* Paste area */}
            <label className="block text-xs text-[var(--c-muted)] mb-1">또는 직접 붙여넣기</label>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={4}
              placeholder="show mac address-table, switchshow 등의 출력을 붙여넣으세요"
              className="w-full bg-[var(--c-input)] border border-[var(--c-border)] rounded-md px-3 py-2 text-xs text-[var(--c-text)] font-mono resize-none placeholder:text-[var(--c-faint)]"
            />
            {pasteText.trim() && (
              <button onClick={() => doParse()} disabled={parsing}
                className="mt-2 px-3 py-1.5 text-xs bg-[var(--cyan-bg)] text-[var(--cyan)] border border-[var(--cyan)]/30 rounded-md hover:bg-[var(--cyan)]/20 disabled:opacity-50">
                {parsing ? '파싱 중...' : '파싱'}
              </button>
            )}
          </Section>

          {/* ── Parse Result ────────────────────── */}
          {parsed && (
            <Section title={`파싱 결과: ${parsed.entries.length}건 (${parsed.vendor_detected}, ${parsed.type_detected === 'wwn' ? 'WWN' : parsed.type_detected === 'arp' ? 'ARP' : 'MAC'})`}>
              <div className="max-h-40 overflow-y-auto border border-[var(--c-border)] rounded-md">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[var(--c-surface)]">
                      {parsed?.type_detected === 'wwn' ? (
                        <>
                          <th className="px-2 py-1.5 text-left text-[var(--c-muted)] font-medium">WWN</th>
                          <th className="px-2 py-1.5 text-left text-[var(--c-muted)] font-medium">Port</th>
                          <th className="px-2 py-1.5 text-left text-[var(--c-muted)] font-medium">Type</th>
                        </>
                      ) : (
                        <>
                          <th className="px-2 py-1.5 text-left text-[var(--c-muted)] font-medium">MAC</th>
                          <th className="px-2 py-1.5 text-left text-[var(--c-muted)] font-medium">Port</th>
                          <th className="px-2 py-1.5 text-left text-[var(--c-muted)] font-medium">VLAN</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.entries.slice(0, 50).map((e, i) => (
                      <tr key={i} className="border-t border-[var(--c-border)]">
                        {parsed?.type_detected === 'wwn' ? (
                          <>
                            <td className="px-2 py-1 font-mono text-[var(--c-text)]">{e.wwn}</td>
                            <td className="px-2 py-1 text-[var(--c-muted)]">{e.port_name}</td>
                            <td className="px-2 py-1 text-[var(--c-muted)]">{e.wwn_type}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-1 font-mono text-[var(--c-text)]">{e.mac}</td>
                            <td className="px-2 py-1 text-[var(--c-muted)]">{e.port}</td>
                            <td className="px-2 py-1 text-[var(--c-muted)]">{e.vlan ?? '-'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.entries.length > 50 && (
                  <p className="px-2 py-1 text-[10px] text-[var(--c-faint)]">...외 {parsed.entries.length - 50}건</p>
                )}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => { setParsed(null); setPasteText('') }}
                  className="px-3 py-1.5 text-xs text-[var(--c-muted)] border border-[var(--c-border)] rounded-md hover:bg-[var(--c-hover)]">
                  <RefreshCw size={12} className="inline mr-1" />다시 파싱
                </button>
                <button onClick={handleSave} disabled={saving || !selectedAsset}
                  className="px-3 py-1.5 text-xs bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/30 rounded-md hover:bg-[var(--green)]/20 disabled:opacity-50">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
              {!selectedAsset && parsed && (
                <p className="text-[10px] text-[var(--orange)] mt-1">
                  <AlertCircle size={10} className="inline mr-0.5" />장비를 먼저 선택하세요
                </p>
              )}
              {saveMsg && (
                <p className="text-[10px] text-[var(--green)] mt-1">
                  <Check size={10} className="inline mr-0.5" />{saveMsg}
                </p>
              )}
            </Section>
          )}

          {/* ── Saved Data ──────────────────────── */}
          {devices.length > 0 && (
            <Section title="저장된 데이터">
              <div className="space-y-1.5">
                {devices.filter(d => d.mac_entries > 0 || d.wwn_entries > 0).map(d => (
                  <div key={d.asset_id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-[var(--c-surface)] text-xs">
                    <div>
                      <span className="text-[var(--c-text)] font-medium">{d.name}</span>
                      <span className="text-[var(--c-faint)] ml-2">
                        {d.mac_entries > 0 && `${d.mac_entries} MAC`}
                        {d.mac_entries > 0 && d.wwn_entries > 0 && ' / '}
                        {d.wwn_entries > 0 && `${d.wwn_entries} WWN`}
                      </span>
                    </div>
                    <button onClick={() => handleDelete(d.asset_id)}
                      className="p-1 text-[var(--c-faint)] hover:text-[var(--red)] transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {devices.every(d => d.mac_entries === 0 && d.wwn_entries === 0) && (
                  <p className="text-xs text-[var(--c-faint)]">저장된 데이터가 없습니다</p>
                )}
              </div>
            </Section>
          )}

          {/* ── Discovery Run ───────────────────── */}
          <div className="flex gap-2">
            <button onClick={() => handleRun(true)} disabled={running}
              className="flex items-center gap-1.5 px-3 py-2 text-xs border border-[var(--c-border)] rounded-md text-[var(--c-muted)] hover:bg-[var(--c-hover)] disabled:opacity-50">
              <Eye size={13} />미리보기
            </button>
            <button onClick={() => handleRun(false)} disabled={running}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-[var(--cyan-bg)] text-[var(--cyan)] border border-[var(--cyan)]/30 rounded-md hover:bg-[var(--cyan)]/20 disabled:opacity-50">
              <Play size={13} />{running ? '실행 중...' : '탐지 실행'}
            </button>
          </div>

          {/* ── Results ─────────────────────────── */}
          {runResult && (
            <Section title="결과">
              <div className="space-y-1 text-xs">
                {[...runResult.ethernet.discoveries, ...runResult.san.discoveries].map((d, i) => (
                  <div key={i} className="flex items-start gap-1.5 py-1">
                    <span className={`shrink-0 mt-0.5 ${d.is_new ? 'text-[var(--green)]' : 'text-[var(--c-faint)]'}`}>
                      {d.is_new ? <Check size={12} /> : <FileText size={12} />}
                    </span>
                    <span className="text-[var(--c-text)]">
                      {d.source} <span className="text-[var(--c-faint)]">{d.source_port}</span>
                      {' → '}
                      {d.target} <span className="text-[var(--c-faint)]">{d.target_port}</span>
                    </span>
                    <span className={`ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                      d.method === 'auto_arp'
                        ? 'bg-[var(--orange-bg)] text-[var(--orange)]'
                        : 'bg-[var(--purple-bg)] text-[var(--purple)]'
                    }`}>
                      {d.method === 'auto_arp' ? 'ARP' : 'WWN'}
                    </span>
                  </div>
                ))}
                {runResult.ethernet.discoveries.length === 0 && runResult.san.discoveries.length === 0 && (
                  <p className="text-[var(--c-faint)]">발견된 연결이 없습니다</p>
                )}
                <div className="pt-2 border-t border-[var(--c-border)] text-[var(--c-muted)]">
                  {runResult.dry_run ? '(미리보기)' : ''}{' '}
                  새 연결 {runResult.ethernet.edges_created + runResult.san.edges_created}건
                  {' / '}갱신 {runResult.ethernet.edges_updated + runResult.san.edges_updated}건
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  )
}

/* ── Sub-components ────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[var(--c-muted)] uppercase tracking-wide mb-2">{title}</h3>
      {children}
    </div>
  )
}

