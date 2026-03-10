'use client'

import { useState, useEffect } from 'react'
import type { SessionUser } from '@/types'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'

interface DashboardShellProps {
  user: SessionUser
  children: React.ReactNode
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Prevent background scroll when mobile nav is open
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileNavOpen])

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <Sidebar user={user} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: 'rgba(15,23,42,0.4)' }}
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <Topbar user={user} onMenuClick={() => setMobileNavOpen(prev => !prev)} />
      <main className="min-h-screen md:ml-[var(--sidebar-width)] pt-[var(--topbar-height)]">
        <div className="p-3 sm:p-4 md:p-5">{children}</div>
      </main>
    </div>
  )
}
