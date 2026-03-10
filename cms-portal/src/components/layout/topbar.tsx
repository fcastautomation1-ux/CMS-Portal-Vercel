'use client'

import Link from 'next/link'
import { Menu, Sun, Moon } from 'lucide-react'
import type { SessionUser } from '@/types'
import { NotificationPanel } from '@/components/notifications/notification-panel'

const ROLE_COLORS: Record<string, string> = {
  Admin: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
  'Super Manager': 'linear-gradient(135deg, #2B7FFF, #1A6AE4)',
  Manager: 'linear-gradient(135deg, #14B8A6, #0D9488)',
  Supervisor: 'linear-gradient(135deg, #F59E0B, #D97706)',
  User: 'linear-gradient(135deg, #64748B, #475569)',
}

interface TopbarProps {
  user: SessionUser
  title?: string
  onMenuClick?: () => void
  theme?: 'light' | 'dark'
  onThemeToggle?: () => void
}

export function Topbar({ user, title, onMenuClick, theme = 'light', onThemeToggle }: TopbarProps) {
  const avatarBg = ROLE_COLORS[user.role] ?? ROLE_COLORS['User']

  return (
    <header
      className="glass-topbar fixed top-0 left-0 right-0 md:left-[var(--sidebar-width)] flex items-center justify-between px-3 sm:px-4 md:px-6 z-20 transition-[left] duration-300"
      style={{ height: 'var(--topbar-height)' }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-motion md:hidden w-9 h-9 flex items-center justify-center rounded-lg"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Open menu"
          onClick={onMenuClick}
        >
          <Menu size={18} />
        </button>

        {title && (
          <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={onThemeToggle}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        {/* Notifications */}
        <NotificationPanel />

        {/* User chip → links to profile */}
        <Link
          href="/dashboard/profile"
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg ml-1 transition-colors hover:opacity-90"
          style={{
            background: 'var(--slate-100)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: avatarBg }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="hidden sm:flex flex-col leading-none gap-0.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              {user.username}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {user.role}
            </span>
          </div>
        </Link>
      </div>
    </header>
  )
}
