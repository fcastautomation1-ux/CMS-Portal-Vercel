'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/types'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { DeploymentWatcher } from '@/components/layout/deployment-watcher'
import { PortalWarmup } from '@/components/layout/portal-warmup'
import { CommandPalette } from '@/components/layout/command-palette'
import { saveThemePreference } from '@/app/dashboard/profile/actions'
import { usePathname, useSearchParams } from 'next/navigation'

/* ------------------------------------------------------------------ */
/*  Isolated useSearchParams wrapper – must live inside its own       */
/*  <Suspense> to avoid null-dispatcher crash during SSR hydration.   */
/* ------------------------------------------------------------------ */
function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isNavigating, setIsNavigating] = useState(false)

  useEffect(() => {
    setIsNavigating(true)
    const t = setTimeout(() => setIsNavigating(false), 300)
    return () => clearTimeout(t)
  }, [pathname, searchParams])

  return (
    <div
      className="fixed top-0 left-0 h-1 z-[100] bg-gradient-to-r from-blue-500 via-blue-400 to-indigo-500 ring-1 ring-blue-300 shadow-[0_2px_10px_rgba(59,130,246,0.5)]"
      style={{
        width: isNavigating ? '100%' : '0%',
        opacity: isNavigating ? 1 : 0,
        transition: isNavigating
          ? 'width 1.5s ease-in'
          : 'opacity 0.3s ease-out',
        pointerEvents: 'none',
      }}
    />
  )
}

interface DashboardShellProps {
  user: SessionUser
  children: React.ReactNode
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('cms_sidebar_collapsed') === 'true'
  })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Server-supplied preference from JWT takes priority; fall back to
    // localStorage so navigations within a session don't flicker.
    if (user.themePreference) return user.themePreference
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('cms_theme') as 'light' | 'dark' | null
      if (stored === 'light' || stored === 'dark') return stored
    }
    return 'light'
  })

  // Apply theme class to <html>
  useEffect(() => {
    const html = document.documentElement
    if (theme === 'dark') {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
  }, [theme])

  // Prevent background scroll when mobile nav is open
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileNavOpen])

  const handleThemeToggle = useCallback(async () => {
    const next: 'light' | 'dark' = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('cms_theme', next)
    saveThemePreference(next).catch(() => { })
  }, [theme])

  const handleCollapsedChange = useCallback((val: boolean) => {
    setSidebarCollapsed(val)
    localStorage.setItem('cms_sidebar_collapsed', val ? 'true' : 'false')
  }, [])

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <DeploymentWatcher />
      <PortalWarmup user={user} />
      <CommandPalette user={user} />
      <Suspense>
        <Sidebar
          user={user}
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={sidebarCollapsed}
          onCollapsedChange={handleCollapsedChange}
        />
      </Suspense>
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: 'rgba(15,23,42,0.4)' }}
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <Topbar
        user={user}
        onMenuClick={() => setMobileNavOpen(prev => !prev)}
        theme={theme}
        onThemeToggle={handleThemeToggle}
        sidebarCollapsed={sidebarCollapsed}
      />
      <main
        className="cms-main min-h-screen pt-[var(--topbar-height)]"
        data-collapsed={sidebarCollapsed ? 'true' : 'false'}
      >
        <div className="p-3 sm:p-4 md:p-5 md:ml-0" style={{ marginLeft: 0 }}>
          <Suspense>
            <NavigationProgress />
          </Suspense>
          {children}
        </div>
      </main>
    </div>
  )
}
