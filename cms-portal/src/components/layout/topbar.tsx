'use client'

import { Bell } from 'lucide-react'
import type { SessionUser } from '@/types'

interface TopbarProps {
  user: SessionUser
  title?: string
}

export function Topbar({ user, title }: TopbarProps) {
  return (
    <header
      className="glass-topbar fixed top-0 right-0 flex items-center justify-between px-6 z-20"
      style={{
        left: 'var(--sidebar-width)',
        height: 'var(--topbar-height)',
      }}
    >
      {/* Page title */}
      {title && (
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--slate-800)' }}
        >
          {title}
        </h1>
      )}

      {/* Right actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <button
          className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all hover:bg-slate-100 text-slate-500"
          aria-label="Notifications"
        >
          <Bell size={17} />
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--blue-600)' }}
          />
        </button>

        {/* User chip */}
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-default"
          style={{
            background: 'var(--slate-50)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: 'var(--blue-600)' }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--slate-700)' }}>
            {user.username}
          </span>
        </div>
      </div>
    </header>
  )
}
