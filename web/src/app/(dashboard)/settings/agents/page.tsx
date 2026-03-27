'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Server, Plus, Trash2, RefreshCw, Copy, CheckCircle, Clock,
  AlertCircle, Shield, Monitor, Download,
} from 'lucide-react'

interface Agent {
  id: number
  token: string
  label: string | null
  asset_id: number | null
  asset_name: string | null
  ip_address: string | null
  os: string | null
  agent_version: string | null
  last_seen: string | null
  revoked: boolean
  created_at: string
}

interface AssetRow {
  id: number
  hostname: string
  ip_address: string | null
  type: string
  os: string | null
  agent_version: string | null
}

function timeSince(dateStr: string | null): { text: string; stale: boolean } {
  if (!dateStr) return { text: '미접속', stale: true }
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2)  return { text: '방금 전', stale: false }
  if (mins < 60) return { text: `${mins}분 전`, stale: mins > 5 }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return { text: `${hrs}시간 전`, stale: true }
  return { text: `${Math.floor(hrs / 24)}일 전`, stale: true }
}

function TokenBadge({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const masked = token.slice(0, 8) + '••••••••••••••••' + token.slice(-4)

  const copy = () => {
    navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 font-mono text-xs text-[var(--c-muted)] hover:text-[var(--c-text)] group"
      title="클릭하여 복사"
    >
      <span>{masked}</span>
      {copied
        ? <CheckCircle size={11} className="text-green-400" />
        : <Copy size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
    </button>
  )
}

function InstallGuide({ agents, assets }: { agents: Agent[]; assets: AssetRow[] }) {
  const [selectedToken, setSelectedToken] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<number | ''>('')
  const [platform, setPlatform] = useState<'linux' | 'windows'>('linux')
  const [copied, setCopied] = useState(false)

  const serverUrl = typeof window !== 'undefined' ? window.location.origin : 'http://argus-server:3100'
  const token = selectedToken || '<TOKEN>'

  // 선택된 에이전트의 연결된 자산으로 OS 자동 감지
  const selectedAgent = agents.find(a => a.token === selectedToken)
  const targetAsset = selectedAsset ? assets.find(a => a.id === selectedAsset) : null
  useEffect(() => {
    if (targetAsset?.os?.toLowerCase().includes('windows')) setPlatform('windows')
    else if (targetAsset?.os) setPlatform('linux')
  }, [targetAsset])

  // Agent 미설치 서버 필터
  const noAgentServers = assets.filter(a => !a.agent_version && a.type === 'server')

  const linuxCmd = `curl -sSL ${serverUrl}/api/agent/install-script?os=linux\\&token=${token} | bash`
  const windowsCmd = `irm "${serverUrl}/api/agent/install-script?os=windows&token=${token}" | iex`
  const cmd = platform === 'linux' ? linuxCmd : windowsCmd

  const copyCmd = () => {
    navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-[var(--c-text)] flex items-center gap-2">
        <Download size={14} className="text-cyan-400" />
        Agent 원클릭 설치
      </h3>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-[var(--c-faint)] mb-1 block">대상 서버</label>
          <select
            className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)]"
            value={selectedAsset}
            onChange={e => setSelectedAsset(e.target.value ? parseInt(e.target.value) : '')}
          >
            <option value="">서버 선택 (선택사항)...</option>
            {noAgentServers.length > 0 && (
              <optgroup label="Agent 미설치 서버">
                {noAgentServers.map(a => (
                  <option key={a.id} value={a.id}>{a.hostname} ({a.ip_address || 'IP 없음'})</option>
                ))}
              </optgroup>
            )}
            <optgroup label="전체 서버">
              {assets.filter(a => a.type === 'server').map(a => (
                <option key={a.id} value={a.id}>
                  {a.hostname} ({a.ip_address || 'IP 없음'}) {a.agent_version ? '✓' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--c-faint)] mb-1 block">토큰 선택</label>
          <select
            className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)]"
            value={selectedToken}
            onChange={e => setSelectedToken(e.target.value)}
          >
            <option value="">토큰 선택...</option>
            {agents.filter(a => !a.asset_id).map(a => (
              <option key={a.id} value={a.token}>{a.label || `Token #${a.id}`} ({a.token.slice(0, 8)}...)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--c-faint)] mb-1 block">플랫폼</label>
          <div className="flex rounded-lg border border-[var(--c-border)] overflow-hidden">
            {(['linux', 'windows'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex-1 px-4 py-2 text-sm ${platform === p ? 'bg-cyan-500/20 text-cyan-400' : 'bg-[var(--c-hover)] text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}
              >
                {p === 'linux' ? 'Linux' : 'Windows'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="bg-[var(--c-bg)] rounded-lg px-4 py-3 font-mono text-xs text-[var(--c-text)] break-all pr-12">
          {cmd}
        </div>
        <button
          onClick={copyCmd}
          className="absolute top-2 right-2 p-1.5 rounded hover:bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
          title="복사"
        >
          {copied ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      </div>

      <p className="text-xs text-[var(--c-faint)]">
        대상 서버에서 위 명령어를 실행하면 Agent가 자동 설치됩니다. 토큰 미선택 시 Agent가 등록 요청하면 자동으로 자산에 등록됩니다.
      </p>
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents]     = useState<Agent[]>([])
  const [assets, setAssets]     = useState<AssetRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel]       = useState('')
  const [assetId, setAssetId]   = useState<number | ''>('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<{ id: number; token: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [agentRes, assetRes] = await Promise.all([
        fetch('/api/settings/agents'),
        fetch('/api/settings/agents?list=servers'),
      ])
      const agentData = await agentRes.json()
      const assetData = await assetRes.json()
      setAgents(agentData.agents ?? [])
      setAssets(assetData.servers ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createToken = async () => {
    setCreating(true)
    try {
      const res  = await fetch('/api/settings/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || null, asset_id: assetId || null }),
      })
      const data = await res.json()
      if (data.ok) {
        setNewToken({ id: data.id, token: data.token })
        setLabel('')
        setAssetId('')
        setShowForm(false)
        load()
      }
    } finally {
      setCreating(false)
    }
  }

  const revokeAgent = async (id: number) => {
    await fetch(`/api/settings/agents?id=${id}`, { method: 'DELETE' })
    setAgents(prev => prev.map(a => a.id === id ? { ...a, revoked: true } : a))
  }

  const active   = agents.filter(a => !a.revoked)
  const revoked  = agents.filter(a => a.revoked)
  const online   = active.filter(a => a.last_seen && Date.now() - new Date(a.last_seen).getTime() < 5 * 60000)

  // Agent 미설치 서버 수
  const noAgentCount = assets.filter(a => !a.agent_version && a.type === 'server').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Server size={20} className="text-cyan-400" />
            Agent 관리
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">토큰 발급 · 설치 대상 선택 · 상태 확인</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
        >
          <Plus size={14} />
          토큰 발급
        </button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '활성 토큰',    value: active.length,     color: 'text-[var(--c-text)]', bg: 'bg-[var(--c-card)] border-[var(--c-border)]' },
          { label: '온라인 Agent', value: online.length,     color: 'text-green-400',       bg: 'bg-green-500/10 border-green-500/20' },
          { label: 'Agent 미설치', value: noAgentCount,      color: noAgentCount > 0 ? 'text-orange-400' : 'text-green-400', bg: noAgentCount > 0 ? 'bg-orange-500/10 border-orange-500/20' : 'bg-[var(--c-card)] border-[var(--c-border)]' },
          { label: '폐기된 토큰',  value: revoked.length,    color: 'text-[var(--c-muted)]',bg: 'bg-[var(--c-card)] border-[var(--c-border)]' },
        ].map(({ label: lbl, value, color, bg }) => (
          <div key={lbl} className={`border rounded-xl p-4 ${bg}`}>
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
            <p className="text-xs text-[var(--c-muted)] mt-1">{lbl}</p>
          </div>
        ))}
      </div>

      {/* 새 토큰 발급 폼 */}
      {showForm && (
        <div className="bg-[var(--c-card)] border border-cyan-500/30 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--c-text)]">새 Agent 토큰 발급</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--c-muted)] mb-1 block">설치 대상 서버</label>
              <select
                className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)]"
                value={assetId}
                onChange={e => {
                  const v = e.target.value ? parseInt(e.target.value) : ''
                  setAssetId(v)
                  if (v && !label) {
                    const a = assets.find(s => s.id === v)
                    if (a) setLabel(a.hostname)
                  }
                }}
              >
                <option value="">선택 안함 (신규 서버 자동 등록)</option>
                <optgroup label="Agent 미설치 서버">
                  {assets.filter(a => !a.agent_version && a.type === 'server').map(a => (
                    <option key={a.id} value={a.id}>{a.hostname} ({a.ip_address || 'IP 없음'})</option>
                  ))}
                </optgroup>
                <optgroup label="전체 서버">
                  {assets.filter(a => a.type === 'server').map(a => (
                    <option key={a.id} value={a.id}>
                      {a.hostname} ({a.ip_address || 'IP 없음'}) {a.agent_version ? `v${a.agent_version}` : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
              <p className="text-xs text-[var(--c-faint)] mt-1">
                선택 안하면 Agent 등록 시 자동으로 자산에 추가됩니다.
              </p>
            </div>
            <div>
              <label className="text-xs text-[var(--c-muted)] mb-1 block">레이블 (선택)</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="web-server-01"
                className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
              />
              <p className="text-xs text-[var(--c-faint)] mt-1">Agent를 식별하기 위한 레이블입니다.</p>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setLabel(''); setAssetId('') }}
              className="px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm"
            >
              취소
            </button>
            <button
              onClick={createToken}
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {creating ? '생성 중...' : '토큰 발급'}
            </button>
          </div>
        </div>
      )}

      {/* 새 토큰 표시 */}
      {newToken && (
        <div className="bg-green-400/10 border border-green-400/30 rounded-xl p-4 space-y-2">
          <p className="text-green-400 text-sm font-medium flex items-center gap-1.5">
            <CheckCircle size={14} /> 토큰이 발급됐습니다
          </p>
          <div className="flex items-center gap-2 bg-[var(--c-hover)] rounded-lg px-4 py-3">
            <code className="text-sm font-mono text-[var(--c-text)] flex-1 break-all">{newToken.token}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(newToken.token) }}
              className="p-1.5 rounded hover:bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
            >
              <Copy size={13} />
            </button>
          </div>
          <p className="text-xs text-[var(--c-muted)]">
            이 토큰은 다시 표시되지 않습니다. Agent 설정 파일의 <code className="font-mono bg-[var(--c-hover)] px-1 rounded">token</code> 항목에 입력하세요.
          </p>
          <button onClick={() => setNewToken(null)} className="text-xs text-[var(--c-faint)] hover:text-[var(--c-muted)]">닫기</button>
        </div>
      )}

      {/* Agent 설치 안내 */}
      <InstallGuide agents={active} assets={assets} />

      {/* Agent 미설치 서버 */}
      {noAgentCount > 0 && (
        <div className="bg-[var(--c-card)] border border-orange-500/20 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--c-border)]">
            <h2 className="text-sm font-semibold text-orange-400 flex items-center gap-2">
              <Monitor size={14} />
              Agent 미설치 서버 ({noAgentCount})
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--c-hover)] border-b border-[var(--c-border)]">
                <th className="px-4 py-2.5 text-left text-xs text-[var(--c-muted)] font-semibold">장비명</th>
                <th className="px-4 py-2.5 text-left text-xs text-[var(--c-muted)] font-semibold">IP</th>
                <th className="px-4 py-2.5 text-left text-xs text-[var(--c-muted)] font-semibold">OS</th>
                <th className="px-4 py-2.5 text-left text-xs text-[var(--c-muted)] font-semibold">토큰 상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-border)]">
              {assets.filter(a => !a.agent_version && a.type === 'server').map(a => {
                const linkedToken = active.find(t => t.asset_id === a.id)
                return (
                  <tr key={a.id} className="hover:bg-[var(--c-hover)] transition-colors">
                    <td className="px-4 py-2.5 text-[var(--c-text)] font-medium">{a.hostname}</td>
                    <td className="px-4 py-2.5 text-[var(--c-muted)] font-mono text-xs">{a.ip_address || '-'}</td>
                    <td className="px-4 py-2.5 text-[var(--c-muted)] text-xs">{a.os || '-'}</td>
                    <td className="px-4 py-2.5">
                      {linkedToken ? (
                        <span className="text-xs text-cyan-400 flex items-center gap-1">
                          <CheckCircle size={11} /> 토큰 발급됨
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--c-faint)] flex items-center gap-1">
                          <Clock size={11} /> 미발급
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Agent 목록 */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--c-border)]">
          <h2 className="text-sm font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Shield size={14} className="text-cyan-400" />
            활성 토큰
          </h2>
          <button onClick={load} className="p-1.5 rounded hover:bg-[var(--c-hover)] text-[var(--c-muted)]">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-[var(--c-faint)]">
            <RefreshCw className="animate-spin mr-2" size={14} /> 로딩 중...
          </div>
        ) : active.length === 0 ? (
          <div className="text-center py-12 text-[var(--c-faint)]">
            <Server size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">발급된 토큰이 없습니다.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--c-hover)] border-b border-[var(--c-border)]">
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">상태</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">레이블 / 서버</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">토큰</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">OS / 버전</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">마지막 접속</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-border)]">
              {active.map(a => {
                const { text, stale } = timeSince(a.last_seen)
                const isOnline = a.last_seen && Date.now() - new Date(a.last_seen).getTime() < 5 * 60000
                return (
                  <tr key={a.id} className="hover:bg-[var(--c-hover)] transition-colors">
                    <td className="px-4 py-3">
                      {a.asset_id ? (
                        isOnline
                          ? <span className="flex items-center gap-1.5 text-xs text-green-400"><CheckCircle size={12} /> 온라인</span>
                          : <span className="flex items-center gap-1.5 text-xs text-[var(--c-muted)]"><AlertCircle size={12} /> 오프라인</span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-[var(--c-faint)]"><Clock size={12} /> 미등록</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--c-text)] font-medium">
                        {a.label ?? a.asset_name ?? <span className="text-[var(--c-faint)]">미설정</span>}
                      </p>
                      {a.ip_address && (
                        <p className="text-xs text-[var(--c-muted)] font-mono">{a.ip_address}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TokenBadge token={a.token} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                      {a.os ?? '—'}
                      {a.agent_version && <span className="ml-1 text-[var(--c-faint)]">v{a.agent_version}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${stale ? 'text-[var(--c-muted)]' : 'text-green-400'}`}>{text}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revokeAgent(a.id)}
                        title="토큰 폐기"
                        className="p-1.5 rounded hover:bg-red-400/10 text-[var(--c-faint)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 폐기된 토큰 */}
      {revoked.length > 0 && (
        <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden opacity-60">
          <div className="px-4 py-3 border-b border-[var(--c-border)]">
            <h2 className="text-sm font-semibold text-[var(--c-muted)]">폐기된 토큰 ({revoked.length})</h2>
          </div>
          <div className="divide-y divide-[var(--c-border)]">
            {revoked.map(a => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-4">
                <span className="text-xs text-[var(--c-faint)] line-through">{a.label ?? a.asset_name ?? '레이블 없음'}</span>
                <TokenBadge token={a.token} />
                <span className="text-xs text-[var(--c-faint)] ml-auto">
                  {new Date(a.created_at).toLocaleDateString('ko-KR')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
