'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/types'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { DeploymentWatcher } from '@/components/layout/deployment-watcher'
import { PortalWarmup } from '@/components/layout/portal-warmup'
import { CommandPalette } from '@/components/layout/command-palette'
import { saveThemePreference } from '@/app/dashboard/profile/actions'
import { usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

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

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isNavigating, setIsNavigating] = useState(false)

  // Trigger brief progress bar on ANY navigation / param change
  useEffect(() => {
    setIsNavigating(true)
    const t = setTimeout(() => setIsNavigating(false), 800)
    return () => clearTimeout(t)
  }, [pathname, searchParams])

  const handleCollapsedChange = useCallback((val: boolean) => {
    setSidebarCollapsed(val)
    localStorage.setItem('cms_sidebar_collapsed', val ? 'true' : 'false')
  }, [])

  const mainMargin = sidebarCollapsed
    ? 'var(--sidebar-collapsed-width)'
    : 'var(--sidebar-width)'

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <DeploymentWatcher />
      <PortalWarmup user={user} />
      <CommandPalette user={user} />
      <Sidebar
        user={user}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={handleCollapsedChange}
      />
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
      />
      <main
        className="min-h-screen pt-[var(--topbar-height)] transition-[margin-left] duration-300"
        style={{ marginLeft: `max(0px, ${mainMargin})` }}
      >
        <div className="p-3 sm:p-4 md:p-5 md:ml-0" style={{ marginLeft: 0 }}>
          <AnimatePresence>
            {isNavigating && (
              <motion.div
                initial={{ width: '0%', opacity: 1 }}
                animate={{ width: '100%', opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, ease: 'easeIn' }}
                className="fixed top-0 left-0 h-1 z-[100] bg-gradient-to-r from-blue-500 via-blue-400 to-indigo-500 ring-1 ring-blue-300 shadow-[0_2px_10px_rgba(59,130,246,0.5)]"
              />
            )}
          </AnimatePresence>
          {children}
        </div>
      </main>
    </div>
  )
}
