'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, RefreshCw, Search, AlertTriangle, Filter } from 'lucide-react'

interface LogAnalysis {
  id: number
  asset_name: string
  log_source: string
  analyzed_at: string
  pattern: string
  severity: string
  count: number
  summary: string
  recommendation: string
}

const SEV_STYLE: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
  error:    'text-red-400 bg-red-400/10 border-red-400/20',
  warning:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  info:     'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
}

export default function AILogsPage() {
  const [analyses, setAnalyses] = useState<LogAnalysis[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/log-analysis')
      const data = await res.json()
      setAnalyses(data.analyses ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = analyses.filter(a =>
    !search || a.asset_name.toLowerCase().includes(search.toLowerCase())
             || a.pattern.toLowerCase().includes(search.toLowerCase())
             || a.summary.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText size={28} className="text-green-400" />
            AI 로그 분석
          </h1>
          <p className="text-[var(--c-muted)] mt-1">로그 패턴 탐지 · 이상 로그 요약 · 조치 권고</p>
        </div>
        <button onClick={load}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-sm">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: '분석 건수', value: analyses.length, color: 'text-cyan-400' },
          { label: 'Error/Critical', value: analyses.filter(a => ['error', 'critical'].includes(a.severity)).length, color: 'text-red-400' },
          { label: 'Warning', value: analyses.filter(a => a.severity === 'warning').length, color: 'text-yellow-400' },
          { label: '분석 서버', value: new Set(analyses.map(a => a.asset_name)).size, color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="p-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-card)]">
            <div className="text-sm text-[var(--c-muted)]">{s.label}</div>
            <div className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" />
        <input
          type="text"
          placeholder="서버명, 패턴, 키워드 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--c-border)] bg-[var(--c-card)] text-sm focus:outline-none focus:border-cyan-400/50"
        />
      </div>

      {/* 분석 결과 */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-[var(--c-muted)] rounded-lg border border-[var(--c-border)] bg-[var(--c-card)]">
            분석 결과 로딩 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-[var(--c-muted)] rounded-lg border border-[var(--c-border)] bg-[var(--c-card)]">
            <FileText size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">로그 분석 결과가 없습니다</p>
            <p className="text-sm mt-2">LLM 프로바이더를 설정하고 로그 분석 기능을 활성화하세요</p>
            <a href="/settings/llm" className="inline-block mt-4 px-4 py-2 rounded bg-green-500/20 text-green-400 text-sm hover:bg-green-500/30">
              LLM 설정으로 이동
            </a>
          </div>
        ) : (
          filtered.map(a => (
            <div key={a.id} className="p-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-card)] hover:border-[var(--c-border-hover)] transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs border ${SEV_STYLE[a.severity] ?? SEV_STYLE.info}`}>
                    {a.severity.toUpperCase()}
                  </span>
                  <span className="font-medium">{a.asset_name}</span>
                  <span className="text-[var(--c-muted)] text-sm">· {a.log_source}</span>
                </div>
                <div className="text-sm text-[var(--c-muted)]">
                  {new Date(a.analyzed_at).toLocaleString('ko-KR')}
                  <span className="ml-2 text-cyan-400">{a.count}건</span>
                </div>
              </div>
              <div className="text-sm mb-1">
                <span className="text-[var(--c-muted)]">패턴:</span>{' '}
                <code className="text-yellow-300 bg-yellow-400/5 px-1.5 py-0.5 rounded">{a.pattern}</code>
              </div>
              <p className="text-sm text-[var(--c-muted)]">{a.summary}</p>
              {a.recommendation && (
                <div className="mt-2 text-sm text-green-400/80 bg-green-400/5 px-3 py-2 rounded">
                  💡 {a.recommendation}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
