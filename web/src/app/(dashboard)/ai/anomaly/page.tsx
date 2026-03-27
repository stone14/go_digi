'use client'

import { useEffect, useState, useCallback } from 'react'
import { Brain, RefreshCw, AlertTriangle, CheckCircle, Clock, TrendingUp } from 'lucide-react'

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

const SEV_STYLE: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
  warning:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  info:     'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
}

export default function AnomalyPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading]         = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/predictions')
      const data = await res.json()
      setPredictions(data.predictions ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain size={28} className="text-purple-400" />
            AI 이상 탐지
          </h1>
          <p className="text-[var(--c-muted)] mt-1">LLM 기반 장애 예측 · 이상 패턴 분석</p>
        </div>
        <button onClick={load}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-sm">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: '전체 예측', value: predictions.length, color: 'text-cyan-400' },
          { label: 'Critical', value: predictions.filter(p => p.severity === 'critical').length, color: 'text-red-400' },
          { label: 'Warning', value: predictions.filter(p => p.severity === 'warning').length, color: 'text-yellow-400' },
          { label: '알림 발송', value: predictions.filter(p => p.alert_sent).length, color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="p-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-card)]">
            <div className="text-sm text-[var(--c-muted)]">{s.label}</div>
            <div className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 예측 목록 */}
      <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-card)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[var(--c-muted)]">분석 결과 로딩 중...</div>
        ) : predictions.length === 0 ? (
          <div className="p-12 text-center text-[var(--c-muted)]">
            <Brain size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">이상 탐지 결과가 없습니다</p>
            <p className="text-sm mt-2">LLM 프로바이더를 설정하고 예측 기능을 활성화하세요</p>
            <a href="/settings/llm" className="inline-block mt-4 px-4 py-2 rounded bg-purple-500/20 text-purple-400 text-sm hover:bg-purple-500/30">
              LLM 설정으로 이동
            </a>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-[var(--c-muted)]">
                <th className="text-left px-4 py-2">심각도</th>
                <th className="text-left px-4 py-2">장비</th>
                <th className="text-left px-4 py-2">유형</th>
                <th className="text-left px-4 py-2">요약</th>
                <th className="text-left px-4 py-2">신뢰도</th>
                <th className="text-left px-4 py-2">예측 시각</th>
                <th className="text-left px-4 py-2">알림</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map(p => (
                <tr key={p.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs border ${SEV_STYLE[p.severity] ?? SEV_STYLE.info}`}>
                      {p.severity.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{p.asset_name}</td>
                  <td className="px-4 py-2.5">{p.issue_type}</td>
                  <td className="px-4 py-2.5 text-[var(--c-muted)] max-w-xs truncate">{p.summary}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-[var(--c-hover)]">
                        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${p.confidence}%` }} />
                      </div>
                      <span className="text-xs">{p.confidence}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--c-muted)]">
                    {new Date(p.predicted_at).toLocaleString('ko-KR')}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.alert_sent
                      ? <CheckCircle size={16} className="text-green-400" />
                      : <Clock size={16} className="text-[var(--c-muted)]" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
