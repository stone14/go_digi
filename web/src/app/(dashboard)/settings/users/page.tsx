'use client'

import { useEffect, useState, useCallback } from 'react'
import { Users, Plus, Shield, CheckCircle, XCircle, RefreshCw, Key, Trash2 } from 'lucide-react'

interface User {
  id: number
  username: string
  email: string
  role: 'admin' | 'operator' | 'readonly'
  is_active: boolean
  last_login: string | null
  created_at: string
}

const ROLE_LABEL: Record<string, string> = {
  admin:    '관리자',
  operator: '운영자',
  readonly: '읽기전용',
}

const ROLE_COLOR: Record<string, string> = {
  admin:    'text-red-400 bg-red-400/10 border-red-400/20',
  operator: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  readonly: 'text-[var(--c-muted)] bg-[var(--c-hover)] border-[var(--c-border)]',
}

const EMPTY_FORM = { username: '', email: '', password: '', role: 'readonly' as User['role'] }

export default function UsersPage() {
  const [users, setUsers]       = useState<User[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ ...EMPTY_FORM })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [pwReset, setPwReset]   = useState<{ id: number; pw: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/settings/users')
      const data = await res.json()
      setUsers(data.users ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createUser = async () => {
    if (!form.username || !form.email || !form.password) return
    setSaving(true); setError('')
    try {
      const res  = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '생성 실패'); return }
      setForm({ ...EMPTY_FORM })
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const updateRole = async (id: number, role: User['role']) => {
    await fetch('/api/settings/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role }),
    })
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u))
  }

  const toggleActive = async (u: User) => {
    await fetch('/api/settings/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, is_active: !u.is_active }),
    })
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x))
  }

  const resetPassword = async (id: number) => {
    const pw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase()
    await fetch('/api/settings/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password: pw }),
    })
    setPwReset({ id, pw })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--c-text)] flex items-center gap-2">
            <Users size={20} className="text-cyan-400" />
            사용자 관리
          </h1>
          <p className="text-sm text-[var(--c-muted)] mt-0.5">계정 생성 · 역할 설정 · 비밀번호 초기화</p>
        </div>
        <button
          onClick={() => { setShowForm(s => !s); setError('') }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
        >
          <Plus size={14} />
          사용자 추가
        </button>
      </div>

      {/* 비밀번호 초기화 결과 */}
      {pwReset && (
        <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-yellow-400 text-sm font-medium">임시 비밀번호가 생성됐습니다</p>
            <p className="text-[var(--c-text)] font-mono text-lg mt-1">{pwReset.pw}</p>
            <p className="text-xs text-[var(--c-muted)] mt-1">사용자에게 전달 후 반드시 변경하도록 안내하세요.</p>
          </div>
          <button onClick={() => setPwReset(null)} className="text-[var(--c-muted)] hover:text-[var(--c-text)] text-xs">닫기</button>
        </div>
      )}

      {/* 추가 폼 */}
      {showForm && (
        <div className="bg-[var(--c-card)] border border-cyan-500/30 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--c-text)]">새 사용자</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--c-muted)] mb-1 block">아이디 *</label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="admin2"
                className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--c-muted)] mb-1 block">이메일 *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@company.com"
                className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--c-muted)] mb-1 block">초기 비밀번호 *</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] placeholder-[var(--c-faint)] focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--c-muted)] mb-1 block">역할</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as User['role'] }))}
                className="w-full px-3 py-2 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg text-sm text-[var(--c-text)] focus:outline-none focus:border-cyan-500"
              >
                <option value="readonly">읽기전용</option>
                <option value="operator">운영자</option>
                <option value="admin">관리자</option>
              </select>
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }); setError('') }}
              className="px-4 py-2 rounded-lg bg-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)] text-sm"
            >
              취소
            </button>
            <button
              onClick={createUser}
              disabled={saving || !form.username || !form.email || !form.password}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {saving ? '생성 중...' : '생성'}
            </button>
          </div>
        </div>
      )}

      {/* 사용자 목록 */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--c-faint)]">
            <RefreshCw className="animate-spin mr-2" size={15} /> 로딩 중...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--c-hover)] border-b border-[var(--c-border)]">
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">사용자</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">역할</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">상태</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">마지막 로그인</th>
                <th className="px-4 py-3 text-left text-xs text-[var(--c-muted)] font-semibold uppercase tracking-wide">생성일</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-border)]">
              {users.map(u => (
                <tr key={u.id} className={`hover:bg-[var(--c-hover)] transition-colors ${!u.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[var(--c-hover)] border border-[var(--c-border)] flex items-center justify-center text-xs font-semibold text-[var(--c-text)] uppercase">
                        {u.username[0]}
                      </div>
                      <div>
                        <p className="text-[var(--c-text)] font-medium">{u.username}</p>
                        <p className="text-xs text-[var(--c-muted)]">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={e => updateRole(u.id, e.target.value as User['role'])}
                      className={`text-xs font-medium px-2 py-1 rounded-lg border bg-transparent focus:outline-none cursor-pointer ${ROLE_COLOR[u.role]}`}
                    >
                      <option value="readonly">읽기전용</option>
                      <option value="operator">운영자</option>
                      <option value="admin">관리자</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(u)}
                      className={`flex items-center gap-1 text-xs font-medium ${u.is_active ? 'text-green-400' : 'text-[var(--c-muted)]'}`}
                    >
                      {u.is_active
                        ? <><CheckCircle size={13} /> 활성</>
                        : <><XCircle size={13} /> 비활성</>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                    {u.last_login
                      ? new Date(u.last_login).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--c-muted)]">
                    {new Date(u.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => resetPassword(u.id)}
                        title="비밀번호 초기화"
                        className="p-1.5 rounded hover:bg-yellow-400/10 text-[var(--c-faint)] hover:text-yellow-400 transition-colors"
                      >
                        <Key size={13} />
                      </button>
                      <button
                        onClick={() => toggleActive(u)}
                        title={u.is_active ? '비활성화' : '활성화'}
                        className="p-1.5 rounded hover:bg-red-400/10 text-[var(--c-faint)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 역할 설명 */}
      <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl p-4">
        <p className="text-xs font-semibold text-[var(--c-muted)] mb-3 flex items-center gap-1.5">
          <Shield size={12} /> 역할 권한
        </p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          {[
            { role: 'admin',    label: '관리자',   desc: '전체 CRUD, 사용자 관리, 시스템 설정' },
            { role: 'operator', label: '운영자',   desc: '조회 + 알림 처리, 규칙 편집, 인시던트 관리' },
            { role: 'readonly', label: '읽기전용', desc: '모든 페이지 조회 전용' },
          ].map(({ role, label, desc }) => (
            <div key={role} className={`rounded-lg border px-3 py-2 ${ROLE_COLOR[role]}`}>
              <p className="font-semibold">{label}</p>
              <p className="text-[var(--c-muted)] mt-0.5 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
