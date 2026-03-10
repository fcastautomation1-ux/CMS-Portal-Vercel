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
          style={{ color: 'var(--slate-800)', letterSpacing: '-0.015em' }}
        >
          {title}
        </h1>
      )}

      {/* Right actions */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Notifications */}
        <button
          className="relative w-9 h-9 flex items-center justify-center rounded-xl transition-all"
          style={{ color: 'var(--slate-500)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.7)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
            style={{ background: 'var(--blue-600)' }}
          />
        </button>

        {/* User chip */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl cursor-default"
          style={{
            background: 'rgba(255,255,255,0.65)',
            border: '1px solid rgba(255,255,255,0.7)',
          }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--blue-600), var(--blue-700))' }}
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
