import { Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header  from '@/components/layout/Header'
import { ThemeProvider } from '@/lib/theme'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden">
        <Suspense fallback={<div className="w-56 flex-shrink-0 bg-[var(--c-card)] border-r border-[var(--c-border)]" />}>
          <Sidebar />
        </Suspense>
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  )
}
