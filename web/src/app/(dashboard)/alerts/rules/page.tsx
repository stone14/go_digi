'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  AlertTriangle, Plus, RefreshCw, Edit2, Trash2,
  ToggleLeft, ToggleRight, Bell,
} from 'lucide-react'

interface AlertRule {
  id: number
  name: string
  asset_id: number | null
  asset_name: string | null
  asset_type_filter: string | null
  metric: string
  operator: string
  threshold: number
  duration_m: number
  severity: string
  notify_channels: string[]
  is_active: boolean
}

const METRICS = [
  { value: 'cpu_usage',    label: 'CPU 사용률 (%)' },
  { value: 'mem_usage',    label: '메모리 사용률 (%)' },
  { value: 'disk_usage_pct', label: '디스크 사용률 (%)' },
  { value: 'net_rx_bps',   label: '네트워크 수신 (Bytes/s)' },
  { value: 'net_tx_bps',   label: '네트워크 송신 (Bytes/s)' },
  { value: 'load_avg_1m',  label: 'Load Average 1m' },
]

const OPERATORS = [
  { value: '>',  label: '> (초과)' },
  { value: '>=', label: '≥ (이상)' },
  { value: '<',  label: '< (미만)' },
  { value: '<=', label: '≤ (이하)' },
]

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-400/10 text-red-400 border border-red-400/20',
  warning:  'bg-orange-400/10 text-orange-400 border border-orange-400/20',
  info:     'bg-blue-400/10 text-blue-400 border border-blue-400/20',
}

const EMPTY_RULE = {
  name: '', asset_id: null as number | null, asset_type_filter: '',
  metric: 'cpu_usage', operator: '>', threshold: 90, duration_m: 5,
  severity: 'critical', notify_channels: ['slack'] as string[],
}

export default function AlertRulesPage() {
  const [rules,   setRules]   = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editRule, setEditRule] = useState<Partial<typeof EMPTY_RULE> & { id?: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/alerts/rules')
      const data = await res.json()
      setRules(data.rules ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveRule() {
    if (!editRule) return
    const method = editRule.id ? 'PUT' : 'POST'
    await fetch('/api/alerts/rules', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editRule),
    })
    setEditRule(null)
    load()
  }

  async function deleteRule(id: number) {
    if (!confirm('알림 규칙을 삭제하시겠습니까?')) return
    await fetch(`/api/alerts/rules?id=${id}`, { method: 'DELETE' })
    load()
  }

  async function toggleRule(id: number, active: boolean) {
    await fetch('/api/alerts/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: active }),
    })
    load()
  }

  function toggleChannel(ch: string) {
    const channels = editRule?.notify_channels ?? []
    const next = channels.includes(ch)
      ? channels.filter(c => c !== ch)
      : [...channels, ch]
    setEditRule(p => ({ ...p!, notify_channels: next }))
  }

  const metricLabel = (m: string) => METRICS.find(x => x.value === m)?.label ?? m

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <AlertTriangle className="text-orange-400" size={20} />
            알림 규칙
          </h1>
          <p className="text-[var(--c-muted)] text-sm mt-0.5">임계값 기반 자동 알림 규칙 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />새로고침
          </button>
          <button onClick={() => setEditRule({ ...EMPTY_RULE })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm">
            <Plus size={14} />규칙 추가
          </button>
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] bg-[var(--c-hover)]">
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">규칙명</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">대상</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">조건</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">지속시간</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">심각도</th>
              <th className="text-left px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">채널</th>
              <th className="text-center px-4 py-3 text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">활성</th>
              <th className="px-4 py-3 text-right text-[var(--c-muted)] text-xs font-semibold uppercase tracking-wide">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">
                <RefreshCw className="inline animate-spin mr-2" size={14} />로딩 중...
              </td></tr>
            ) : rules.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--c-faint)]">
                <Bell size={32} className="mx-auto mb-2 opacity-20" />
                등록된 알림 규칙이 없습니다
              </td></tr>
            ) : rules.map(rule => (
              <tr key={rule.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors">
                <td className="px-4 py-3 font-medium text-[var(--c-text)]">{rule.name}</td>
                <td className="px-4 py-3 text-[var(--c-muted)] text-xs">
                  {rule.asset_name ?? rule.asset_type_filter ?? '전체 서버'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-cyan-400">
                  {metricLabel(rule.metric)} {rule.operator} {rule.threshold}
                </td>
                <td className="px-4 py-3 text-[var(--c-muted)] text-xs">{rule.duration_m}분</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${SEV_BADGE[rule.severity] ?? ''}`}>
                    {rule.severity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {(rule.notify_channels ?? []).map(ch => (
                      <span key={ch} className="px-1.5 py-0.5 rounded bg-[var(--c-border)] text-[var(--c-muted)] text-[10px]">{ch}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleRule(rule.id, !rule.is_active)}>
                    {rule.is_active
                      ? <ToggleRight size={22} className="text-cyan-400" />
                      : <ToggleLeft  size={22} className="text-[var(--c-faint)]" />}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditRule({ id: rule.id, name: rule.name, asset_id: rule.asset_id, asset_type_filter: rule.asset_type_filter ?? '', metric: rule.metric, operator: rule.operator, threshold: rule.threshold, duration_m: rule.duration_m, severity: rule.severity, notify_channels: rule.notify_channels })}
                      className="text-cyan-400 hover:text-cyan-300"><Edit2 size={13} /></button>
                    <button onClick={() => deleteRule(rule.id)}
                      className="text-red-400 hover:text-red-300"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {editRule && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[500px] shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--c-text)] mb-4">
              {editRule.id ? '알림 규칙 수정' : '알림 규칙 추가'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">규칙명 *</label>
                <input className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                  placeholder="High CPU Alert"
                  value={editRule.name ?? ''}
                  onChange={e => setEditRule(p => ({ ...p!, name: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">메트릭 *</label>
                  <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editRule.metric}
                    onChange={e => setEditRule(p => ({ ...p!, metric: e.target.value }))}>
                    {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">심각도 *</label>
                  <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editRule.severity}
                    onChange={e => setEditRule(p => ({ ...p!, severity: e.target.value }))}>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">연산자</label>
                  <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editRule.operator}
                    onChange={e => setEditRule(p => ({ ...p!, operator: e.target.value }))}>
                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">임계값</label>
                  <input type="number" className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editRule.threshold ?? 90}
                    onChange={e => setEditRule(p => ({ ...p!, threshold: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--c-muted)] mb-1 block">지속시간 (분)</label>
                  <input type="number" className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                    value={editRule.duration_m ?? 5}
                    onChange={e => setEditRule(p => ({ ...p!, duration_m: parseInt(e.target.value) }))} />
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--c-muted)] mb-2 block">알림 채널</label>
                <div className="flex gap-2">
                  {['slack','email','webhook'].map(ch => (
                    <button key={ch} type="button"
                      onClick={() => toggleChannel(ch)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors
                        ${editRule.notify_channels?.includes(ch)
                          ? 'bg-cyan-600/20 border-cyan-500 text-cyan-400'
                          : 'bg-[var(--c-hover)] border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}>
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--c-muted)] mb-1 block">대상 장비 타입 (선택)</label>
                <select className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
                  value={editRule.asset_type_filter ?? ''}
                  onChange={e => setEditRule(p => ({ ...p!, asset_type_filter: e.target.value || undefined }))}>
                  <option value="">전체 장비</option>
                  <option value="server">Server</option>
                  <option value="switch">Switch</option>
                  <option value="router">Router</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditRule(null)}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm">취소</button>
              <button onClick={saveRule}
                disabled={!editRule.name}
                className="flex-1 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">
                {editRule.id ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
