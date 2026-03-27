'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Brain, Save, RefreshCw, CheckCircle, AlertTriangle,
  Loader2, Settings, Zap, Bell, Eye, EyeOff,
} from 'lucide-react'

type Provider = 'ollama' | 'openai' | 'anthropic'

interface LLMConfig {
  llm_enabled: string
  llm_provider: string
  llm_api_url: string
  llm_api_key: string
  llm_model: string
  llm_predict_enabled: string
  llm_predict_interval: string
  llm_alert_email: string
}

interface Prediction {
  id: number
  asset_name: string
  predicted_at: string
  issue_type: string
  severity: string
  confidence: number
  summary: string
  alert_sent: boolean
}

const PROVIDER_LABELS: Record<Provider, string> = {
  ollama:    'Ollama (로컬)',
  openai:    'OpenAI',
  anthropic: 'Anthropic',
}

const DEFAULT_MODELS: Record<Provider, string> = {
  ollama:    'llama3.2',
  openai:    'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
  warning:  'text-orange-400 bg-orange-400/10 border-orange-400/20',
  info:     'text-blue-400 bg-blue-400/10 border-blue-400/20',
}

const ISSUE_LABEL: Record<string, string> = {
  cpu_spike:       'CPU 급증',
  mem_leak:        '메모리 누수',
  disk_full:       '디스크 고갈',
  network_anomaly: '네트워크 이상',
  process_anomaly: '프로세스 이상',
  log_error:       '로그 오류',
  cpu_capacity:    'CPU 용량',
  mem_capacity:    '메모리 용량',
}

export default function LLMSettingsPage() {
  const [config,      setConfig]      = useState<Partial<LLMConfig>>({})
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState<{ ok: boolean; msg: string } | null>(null)
  const [analyzing,   setAnalyzing]   = useState(false)
  const [analyzeMsg,  setAnalyzeMsg]  = useState('')
  const [saveMsg,     setSaveMsg]     = useState('')
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [showKey,     setShowKey]     = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, predRes] = await Promise.all([
        fetch('/api/llm').then(r => r.json()),
        fetch('/api/llm?type=predictions&limit=20').then(r => r.json()),
      ])
      setConfig(cfgRes.config ?? {})
      setApiKeyInput(cfgRes.config?.llm_api_key ?? '')
      setPredictions(predRes.predictions ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key: keyof LLMConfig, value: string) =>
    setConfig(prev => ({ ...prev, [key]: value }))

  const provider = (config.llm_provider ?? 'ollama') as Provider

  const handleProviderChange = (p: Provider) => {
    setConfig(prev => ({
      ...prev,
      llm_provider: p,
      llm_model: DEFAULT_MODELS[p],
      llm_api_url: p === 'ollama' ? (prev.llm_api_url || 'http://localhost:11434') : '',
    }))
    setApiKeyInput('')
    setTestResult(null)
  }

  const save = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const body: Record<string, string> = { ...config }
      if (apiKeyInput && !apiKeyInput.includes('••')) {
        body.llm_api_key = apiKeyInput
      }
      await fetch('/api/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setSaveMsg('저장됐습니다')
      setTimeout(() => setSaveMsg(''), 3000)
      load()
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const body = {
        provider,
        api_url: config.llm_api_url,
        api_key: apiKeyInput.includes('••') ? '' : apiKeyInput,
        model:   config.llm_model,
      }
      const res  = await fetch('/api/llm?action=test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setTestResult({ ok: data.ok, msg: data.ok ? '연결 성공' : (data.error || '연결 실패') })
    } catch {
      setTestResult({ ok: false, msg: '네트워크 오류' })
    } finally {
      setTesting(false)
    }
  }

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeMsg('')
    try {
      const res  = await fetch('/api/llm?action=analyze', { method: 'POST' })
      const data = await res.json()
      setAnalyzeMsg(data.ok ? '분석 완료' : (data.error || '오류'))
      if (data.ok) load()
    } finally {
      setAnalyzing(false)
      setTimeout(() => setAnalyzeMsg(''), 4000)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-[var(--c-faint)]">
      <RefreshCw size={18} className="animate-spin mr-2" /> 로딩 중...
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Brain size={20} className="text-purple-400" /> LLM 프로바이더 설정
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">AI 분석에 사용할 LLM 프로바이더를 구성합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {saveMsg && <span className="text-xs text-green-400">{saveMsg}</span>}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </div>
      </div>

      {/* 기본 설정 */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <Settings size={15} className="text-cyan-400" />
          <span className="text-sm font-semibold text-[var(--c-text)]">기본 설정</span>
        </div>

        {/* LLM 활성화 */}
        <div className="flex items-center justify-between p-3 bg-[var(--c-hover)] rounded-lg">
          <div>
            <p className="text-sm font-medium text-[var(--c-text)]">LLM 기능 활성화</p>
            <p className="text-xs text-[var(--c-muted)] mt-0.5">용량 계획 AI 분석 및 예측 분석 기능을 활성화합니다</p>
          </div>
          <button
            onClick={() => set('llm_enabled', config.llm_enabled === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.llm_enabled === 'true' ? 'bg-purple-500' : 'bg-[var(--c-border)]'
            }`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.llm_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {/* 프로바이더 선택 */}
        <div>
          <label className="text-xs text-[var(--c-muted)] mb-2 block">프로바이더</label>
          <div className="grid grid-cols-3 gap-2">
            {(['ollama', 'openai', 'anthropic'] as Provider[]).map(p => (
              <button key={p} onClick={() => handleProviderChange(p)}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  provider === p
                    ? 'border-purple-500 bg-purple-500/15 text-purple-300'
                    : 'border-[var(--c-border)] text-[var(--c-muted)] hover:border-[var(--c-text)] hover:text-[var(--c-text)]'
                }`}>
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Ollama URL */}
        {provider === 'ollama' && (
          <div>
            <label className="text-xs text-[var(--c-muted)] mb-1.5 block">API URL</label>
            <input
              value={config.llm_api_url ?? 'http://localhost:11434'}
              onChange={e => set('llm_api_url', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:outline-none focus:border-purple-500"
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        {/* API Key (OpenAI / Anthropic) */}
        {(provider === 'openai' || provider === 'anthropic') && (
          <div>
            <label className="text-xs text-[var(--c-muted)] mb-1.5 block">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                className="w-full px-3 py-2 pr-10 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:outline-none focus:border-purple-500"
                placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              />
              <button onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)] hover:text-[var(--c-text)]">
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[10px] text-[var(--c-faint)] mt-1">저장 시 암호화됩니다. 마스킹된 값은 유지됩니다.</p>
          </div>
        )}

        {/* 모델 */}
        <div>
          <label className="text-xs text-[var(--c-muted)] mb-1.5 block">모델</label>
          <input
            value={config.llm_model ?? DEFAULT_MODELS[provider]}
            onChange={e => set('llm_model', e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:outline-none focus:border-purple-500"
            placeholder={DEFAULT_MODELS[provider]}
          />
          <p className="text-[10px] text-[var(--c-faint)] mt-1">
            {provider === 'ollama' && 'Ollama에 설치된 모델명을 입력하세요 (예: llama3.2, mistral)'}
            {provider === 'openai' && 'gpt-4o, gpt-4o-mini, gpt-4-turbo 등'}
            {provider === 'anthropic' && 'claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 등'}
          </p>
        </div>

        {/* 연결 테스트 */}
        <div className="flex items-center gap-3 pt-1">
          <button onClick={test} disabled={testing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors">
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            연결 테스트
          </button>
          {testResult && (
            <span className={`flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.ok
                ? <CheckCircle size={14} />
                : <AlertTriangle size={14} />}
              {testResult.msg}
            </span>
          )}
        </div>
      </div>

      {/* 예측 분석 설정 */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain size={15} className="text-purple-400" />
          <span className="text-sm font-semibold text-[var(--c-text)]">자동 예측 분석</span>
        </div>

        <div className="flex items-center justify-between p-3 bg-[var(--c-hover)] rounded-lg">
          <div>
            <p className="text-sm font-medium text-[var(--c-text)]">자동 예측 분석 활성화</p>
            <p className="text-xs text-[var(--c-muted)] mt-0.5">주기적으로 CPU/메모리/디스크 트렌드를 LLM으로 분석합니다</p>
          </div>
          <button
            onClick={() => set('llm_predict_enabled', config.llm_predict_enabled === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.llm_predict_enabled === 'true' ? 'bg-purple-500' : 'bg-[var(--c-border)]'
            }`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.llm_predict_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[var(--c-muted)] mb-1.5 block">분석 주기 (분)</label>
            <input
              type="number" min="1" max="60"
              value={config.llm_predict_interval ?? '5'}
              onChange={e => set('llm_predict_interval', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--c-muted)] mb-1.5 flex items-center gap-1">
              <Bell size={11} /> 알림 이메일
            </label>
            <input
              type="email"
              value={config.llm_alert_email ?? ''}
              onChange={e => set('llm_alert_email', e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 text-sm bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-[var(--c-text)] focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={runAnalysis} disabled={analyzing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-50 transition-colors">
            {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
            지금 분석 실행
          </button>
          {analyzeMsg && (
            <span className="text-sm text-green-400">{analyzeMsg}</span>
          )}
        </div>
      </div>

      {/* 최근 예측 이력 */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--c-border)]">
          <span className="text-sm font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Brain size={14} className="text-purple-400" /> 최근 예측 이력
          </span>
          <button onClick={load} className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={14} />
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)]">
              {['자산', '분석 시각', '유형', '심각도', '신뢰도', '요약'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-[var(--c-muted)] font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {predictions.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-[var(--c-faint)] text-xs">예측 이력이 없습니다</td></tr>
            ) : predictions.map(p => (
              <tr key={p.id} className="border-b border-[var(--c-border)]/50 hover:bg-[var(--c-hover)]">
                <td className="px-4 py-3 font-medium text-[var(--c-text)]">{p.asset_name}</td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                  {new Date(p.predicted_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{ISSUE_LABEL[p.issue_type] ?? p.issue_type}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] border ${SEVERITY_STYLE[p.severity] ?? 'text-[var(--c-muted)]'}`}>
                    {p.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)]">{Math.round(p.confidence * 100)}%</td>
                <td className="px-4 py-3 text-xs text-[var(--c-muted)] max-w-xs truncate">{p.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
