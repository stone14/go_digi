'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard, Server, Network, Cpu, Bell, GitBranch,
  Package, Package2, Shield, Brain, FileBarChart, Settings, ChevronDown,
  AlertTriangle, Activity, HardDrive, Layers, Globe, ShieldCheck, History, Archive,
  BarChart2,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'

interface NavItem {
  label: string
  href?: string
  icon: React.ReactNode
  children?: NavItem[]
}

const NAV: NavItem[] = [
  { label: '대시보드',    href: '/',              icon: <LayoutDashboard size={16} /> },
  {
    label: '모니터링', icon: <Activity size={16} />,
    children: [
      { label: '물리서버',       href: '/servers',   icon: <Server size={16} /> },
      { label: '가상화',        href: '/virtual',   icon: <Cpu size={16} /> },
      { label: '네트워크 장비', href: '/network',   icon: <Network size={16} /> },
      { label: '보안',          href: '/security',  icon: <Shield size={16} /> },
      { label: '감사 로그',    href: '/security/audit', icon: <FileBarChart size={16} /> },
      { label: '스토리지',      href: '/storage',   icon: <HardDrive size={16} /> },
      { label: 'BMC / 하드웨어',href: '/hardware',  icon: <Cpu size={16} /> },
      { label: '서비스 체크',   href: '/services',  icon: <Activity size={16} /> },
    ],
  },
  {
    label: '시스템 구성 현황', icon: <GitBranch size={16} />,
    children: [
      { label: '시스템 구성',       href: '/topology?layer=physical', icon: <GitBranch size={16} /> },
      { label: '의존성 맵',         href: '/assets/dependencies',     icon: <GitBranch size={16} /> },
      { label: 'Rack 실장 현황',    href: '/rack',                    icon: <Layers size={16} /> },
    ],
  },
  {
    label: '자산 관리', icon: <Package size={16} />,
    children: [
      { label: '물리 자산',    href: '/assets',           icon: <Package     size={16} /> },
      { label: 'SW 인벤토리', href: '/assets/software',  icon: <Package2    size={16} /> },
      { label: 'IP 관리',     href: '/assets/ipam',      icon: <Globe       size={16} /> },
      { label: '도메인/SSL',  href: '/assets/ssl',       icon: <ShieldCheck size={16} /> },
      { label: '용량 계획',   href: '/assets/capacity',     icon: <BarChart2   size={16} /> },
    ],
  },
  {
    label: '알림 / 장애내역', icon: <Bell size={16} />,
    children: [
      { label: '알림 현황',      href: '/alerts',           icon: <Bell size={16} /> },
      { label: '알림 규칙',      href: '/alerts/rules',     icon: <AlertTriangle size={16} /> },
      { label: '장애내역',       href: '/incidents',        icon: <AlertTriangle size={16} /> },
    ],
  },
  {
    label: 'AI 분석', icon: <Brain size={16} />,
    children: [
      { label: '이상 탐지',      href: '/ai/anomaly',  icon: <Brain size={16} /> },
      { label: '로그 요약',      href: '/ai/logs',     icon: <Brain size={16} /> },
      { label: 'AI 대화',        href: '/ai/chat',     icon: <Brain size={16} /> },
    ],
  },
  {
    label: '리포트', icon: <FileBarChart size={16} />,
    children: [
      { label: '인프라 리포트',    href: '/reports',              icon: <FileBarChart size={16} /> },
      { label: '컴플라이언스',     href: '/reports/compliance',   icon: <ShieldCheck size={16} /> },
    ],
  },
  {
    label: '설정', icon: <Settings size={16} />,
    children: [
      { label: '시스템 설정',    href: '/settings',          icon: <Settings size={16} /> },
      { label: '사용자 관리',    href: '/settings/users',    icon: <Shield size={16} /> },
      { label: 'LLM 프로바이더', href: '/settings/llm',      icon: <Brain size={16} /> },
      { label: 'Agent 관리',     href: '/settings/agents',   icon: <Server size={16} /> },
      { label: '조직 관리',     href: '/assets/organizations', icon: <Archive size={16} /> },
      { label: '파싱 패턴',      href: '/settings/patterns', icon: <Settings size={16} /> },
    ],
  },
]

// href에서 path 부분만 추출 (/topology?layer=x → /topology)
const hrefPath = (href: string) => href.split('?')[0]

function NavGroup({ item }: { item: NavItem }) {
  const pathname  = usePathname()
  const router    = useRouter()

  const hasChild  = !!item.children?.length
  const anyActive = item.children?.some(c => c.href && pathname.startsWith(hrefPath(c.href)))
  const searchParams = useSearchParams()
  // 쿼리파라미터 포함 정확히 비교
  const isActive = item.href
    ? item.href.includes('?')
      ? (() => {
          const [p, q] = item.href.split('?')
          const params = new URLSearchParams(q)
          return pathname === p && [...params.entries()].every(([k, v]) => searchParams.get(k) === v)
        })()
      : pathname === item.href
    : false

  const [open, setOpen] = useState(anyActive ?? false)

  // anyActive 변경 시 자동 열기 (다른 페이지에서 토폴로지로 이동할 때)
  useEffect(() => {
    if (anyActive) setOpen(true)
  }, [anyActive])

  if (!hasChild && item.href) {
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault()
      router.push(item.href!)
    }
    return (
      <a
        href={item.href}
        onClick={handleClick}
        className={clsx(
          'nav-item flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer',
          isActive && 'nav-item-active'
        )}
      >
        {item.icon}
        {item.label}
      </a>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'nav-group-label w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
          anyActive && 'nav-group-active'
        )}
      >
        <span className="flex items-center gap-2">{item.icon}{item.label}</span>
        <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="nav-children-border ml-4 mt-1 space-y-0.5 border-l pl-3">
          {item.children?.map(c => <NavGroup key={c.label} item={c} />)}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="sidebar-shell w-56 flex-shrink-0 border-r flex flex-col">
      {/* Logo */}
      <div className="sidebar-logo px-4 py-4 border-b">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--c-shell-active)' }}>
            <span style={{ color: 'var(--c-shell-accent)' }} className="text-sm font-bold">D</span>
          </div>
          <div>
            <p className="sidebar-logo-text text-sm font-semibold tracking-tight">Digicap</p>
            <p className="sidebar-logo-sub text-[10px] tracking-wide uppercase">Infrastructure Monitor</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(item => <NavGroup key={item.label} item={item} />)}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer px-4 py-3 border-t">
        <p className="text-xs">v1.0.0</p>
      </div>
    </aside>
  )
}
