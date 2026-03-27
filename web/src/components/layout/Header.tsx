'use client'

import { Bell, Search, User, Sun, Moon, LogOut, ChevronDown } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { useRouter } from 'next/navigation'

const ROLE_LABEL: Record<string, string> = {
  admin: '관리자',
  operator: '운영자',
  readonly: '읽기전용',
}

export default function Header() {
  const [alertCount, setAlertCount] = useState(0)
  const { theme, toggle } = useTheme()
  const router = useRouter()

  const [userInfo, setUserInfo] = useState<{ username: string; role: string } | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/alerts?status=active&count=true')
      .then(r => r.json())
      .then(d => setAlertCount(d.count ?? 0))
      .catch(() => {})

    fetch('/api/auth')
      .then(r => r.json())
      .then(d => { if (d.user) setUserInfo(d.user) })
      .catch(() => {})

    const id = setInterval(() => {
      fetch('/api/alerts?status=active&count=true')
        .then(r => r.json())
        .then(d => setAlertCount(d.count ?? 0))
        .catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <header className="header-shell h-14 border-b px-6 flex items-center justify-between flex-shrink-0 transition-colors">
      {/* 검색 */}
      <div className="header-search flex items-center gap-2 rounded-md px-3 py-1.5 w-72 transition-colors">
        <Search size={14} />
        <input
          type="text"
          placeholder="장비명, IP 검색..."
          className="bg-transparent text-sm outline-none w-full"
        />
      </div>

      <div className="flex items-center gap-3">
        {/* 라이트/다크 토글 */}
        <button
          onClick={toggle}
          className="header-icon p-2 transition-colors rounded-lg"
          title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* 알림 */}
        <button className="header-icon relative p-2 transition-colors rounded-lg">
          <Bell size={18} />
          {alertCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </button>

        {/* 사용자 드롭다운 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(p => !p)}
            className="header-icon flex items-center gap-2 text-sm transition-colors rounded-lg p-1 pr-2"
          >
            <div className="header-avatar w-7 h-7 rounded-full flex items-center justify-center">
              <User size={14} />
            </div>
            {userInfo && (
              <span className="text-xs text-[var(--c-muted)] hidden sm:inline">{userInfo.username}</span>
            )}
            <ChevronDown size={12} className="text-[var(--c-faint)]" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--c-card)] border border-[var(--c-border)] rounded-xl shadow-2xl z-50 overflow-hidden">
              {userInfo && (
                <div className="px-4 py-3 border-b border-[var(--c-border)]">
                  <p className="text-sm font-medium text-[var(--c-text)]">{userInfo.username}</p>
                  <p className="text-xs text-[var(--c-muted)] mt-0.5">
                    {ROLE_LABEL[userInfo.role] ?? userInfo.role}
                  </p>
                </div>
              )}
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-[var(--c-hover)] transition-colors"
              >
                <LogOut size={14} />
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
