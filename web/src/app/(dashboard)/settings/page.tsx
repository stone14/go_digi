'use client'

import { useEffect, useState, useCallback } from 'react'
import { Settings, RefreshCw, Server, Clock, Database, HardDrive } from 'lucide-react'

interface SystemSetting {
  key: string
  value: string
  description: string
}

const SETTING_LABELS: Record<string, string> = {
  agent_check_interval: '에이전트 체크 주기 (분)',
  metrics_raw_days: '메트릭 원본 보관 (일)',
  metrics_1h_days: '1시간 집계 보관 (일)',
  alert_cooldown: '알림 쿨다운 (분)',
  heartbeat_timeout: '하트비트 타임아웃 (초)',
  syslog_port: 'Syslog 수신 포트',
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      setSettings(data.settings ?? [])
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
            <Settings size={28} className="text-cyan-400" />
            시스템 설정
          </h1>
          <p className="text-[var(--c-muted)] mt-1">시스템 전반 설정 · 데이터 보관 · 에이전트 정책</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-sm">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {/* 빠른 링크 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: '사용자 관리', desc: '계정 · 권한 관리', href: '/settings/users', icon: <Server size={20} /> },
          { label: 'Agent 관리', desc: '토큰 발급 · 상태', href: '/settings/agents', icon: <HardDrive size={20} /> },
          { label: 'LLM 프로바이더', desc: 'AI 예측 · 모델 설정', href: '/settings/llm', icon: <Database size={20} /> },
          { label: '파싱 패턴', desc: '로그 파싱 규칙', href: '/settings/patterns', icon: <Clock size={20} /> },
        ].map(item => (
          <a key={item.href} href={item.href}
             className="card p-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-card)] hover:border-cyan-400/50 transition-colors">
            <div className="flex items-center gap-3 mb-2 text-cyan-400">{item.icon}<span className="font-semibold">{item.label}</span></div>
            <p className="text-sm text-[var(--c-muted)]">{item.desc}</p>
          </a>
        ))}
      </div>

      {/* 시스템 설정 테이블 */}
      <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--c-border)]">
          <h2 className="font-semibold">시스템 파라미터</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-[var(--c-muted)]">로딩 중...</div>
        ) : settings.length === 0 ? (
          <div className="p-8 text-center text-[var(--c-muted)]">등록된 설정이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-[var(--c-muted)]">
                <th className="text-left px-4 py-2">설정 항목</th>
                <th className="text-left px-4 py-2">값</th>
                <th className="text-left px-4 py-2">설명</th>
              </tr>
            </thead>
            <tbody>
              {settings.map(s => (
                <tr key={s.key} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                  <td className="px-4 py-2.5 font-mono text-cyan-400">{s.key}</td>
                  <td className="px-4 py-2.5">{s.value}</td>
                  <td className="px-4 py-2.5 text-[var(--c-muted)]">{SETTING_LABELS[s.key] || s.description || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
