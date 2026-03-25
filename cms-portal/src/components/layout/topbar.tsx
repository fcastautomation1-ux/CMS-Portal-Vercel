'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Menu, Sun, Moon } from 'lucide-react'
import type { SessionUser } from '@/types'

const NotificationPanel = dynamic(
  () => import('@/components/notifications/notification-panel').then((mod) => mod.NotificationPanel),
  { ssr: false }
)

const ROLE_CONFIG: Record<string, { gradient: string; badge: string; badgeText: string }> = {
  Admin: { gradient: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', badge: 'rgba(139,92,246,0.15)', badgeText: '#7C3AED' },
  'Super Manager': { gradient: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', badge: 'rgba(43,127,255,0.15)', badgeText: '#1A6AE4' },
  Manager: { gradient: 'linear-gradient(135deg, #14B8A6, #0D9488)', badge: 'rgba(20,184,166,0.15)', badgeText: '#0D9488' },
  Supervisor: { gradient: 'linear-gradient(135deg, #F59E0B, #D97706)', badge: 'rgba(245,158,11,0.15)', badgeText: '#D97706' },
  User: { gradient: 'linear-gradient(135deg, #64748B, #475569)', badge: 'rgba(100,116,139,0.15)', badgeText: '#475569' },
}

interface TopbarProps {
  user: SessionUser
  title?: string
  onMenuClick?: () => void
  theme?: 'light' | 'dark'
  onThemeToggle?: () => void
}

export function Topbar({ user, title, onMenuClick, theme = 'light', onThemeToggle }: TopbarProps) {
  const cfg = ROLE_CONFIG[user.role] ?? ROLE_CONFIG['User']

  return (
    <header
      className="glass-topbar fixed top-0 left-0 right-0 md:left-(--sidebar-width) flex items-center justify-between px-3 sm:px-4 md:px-6 z-20 transition-[left] duration-300"
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
        <NotificationPanel currentUsername={user.username} />

        {/* User profile chip */}
        <Link
          href="/dashboard/profile"
          className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl ml-1 transition-all hover:shadow-md"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          {/* Avatar */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden"
            style={{ background: cfg.gradient }}
          >
            {user.avatarData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarData} alt={user.username} className="w-full h-full object-cover" />
            ) : (
              user.username.charAt(0).toUpperCase()
            )}
          </div>

          {/* Name + Role */}
          <div className="hidden sm:flex flex-col leading-none gap-1">
            <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>
              {user.username}
            </span>
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: cfg.badge, color: cfg.badgeText }}
            >
              {user.role}
            </span>
          </div>
        </Link>
      </div>
    </header>
  )
}
