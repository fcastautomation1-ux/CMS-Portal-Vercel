'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, CheckCheck, Info, AlertTriangle, CheckCircle, XCircle,
  X, BellOff, ArrowRight, Check,
} from 'lucide-react'
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/app/dashboard/notifications/actions'
import type { Notification } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function groupByDate(notifications: Notification[]): Array<{ label: string; items: Notification[] }> {
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const groups: Record<string, Notification[]> = {}
  for (const n of notifications) {
    const d = new Date(n.created_at).toDateString()
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(n.created_at).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })
    if (!groups[label]) groups[label] = []
    groups[label].push(n)
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }))
}

/** Derive a navigation URL from notification content */
function getNotifLink(notif: Notification): string {
  const text = `${notif.title} ${notif.body ?? ''}`.toLowerCase()
  if (text.includes('task') || text.includes('todo')) return '/dashboard/tasks'
  if (text.includes('campaign')) return '/dashboard/campaigns'
  if (text.includes('account')) return '/dashboard/accounts'
  if (text.includes('workflow')) return '/dashboard/workflows'
  if (text.includes('package')) return '/dashboard/packages'
  if (text.includes('user')) return '/dashboard/users'
  if (text.includes('department')) return '/dashboard/departments'
  if (text.includes('team')) return '/dashboard/team'
  return '/dashboard'
}

const TYPE_CONFIG: Record<string, { icon: typeof Info; color: string; bg: string }> = {
  success: { icon: CheckCircle, color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  warning: { icon: AlertTriangle, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  error:   { icon: XCircle, color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  info:    { icon: Info, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
}

// ── Desktop notification helpers ──────────────────────────────────────────────

async function requestDesktopPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function fireDesktopNotification(notif: Notification) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new window.Notification(notif.title, {
      body: notif.body ?? undefined,
      icon: '/favicon.ico',
      tag: notif.id,
    })
    setTimeout(() => n.close(), 6000)
    n.onclick = () => { window.focus(); n.close() }
  } catch { /* ignore */ }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface NotificationPanelProps {
  initialCount?: number
}

export function NotificationPanel({ initialCount = 0 }: NotificationPanelProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const prevUnreadRef = useRef(initialCount)

  // Request desktop notification permission once on mount
  useEffect(() => { requestDesktopPermission() }, [])

  const refreshUnreadCount = useCallback(async () => {
    const count = await getUnreadCount()
    setUnreadCount(count)
    prevUnreadRef.current = count
  }, [])

  const refreshNotifications = useCallback(async (withLoading = false) => {
    if (withLoading) setLoading(true)
    try {
      const data = await getNotifications()
      setNotifications(data)
      data.forEach(n => seenIdsRef.current.add(n.id))
      await refreshUnreadCount()
      return data
    } finally {
      if (withLoading) setLoading(false)
    }
  }, [refreshUnreadCount])

  // Lock body scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Seed current notifications and fetch unread count immediately.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [data, count] = await Promise.all([
        getNotifications(),
        getUnreadCount(),
      ])
      if (cancelled) return
      data.forEach(n => seenIdsRef.current.add(n.id))
      setUnreadCount(count)
      prevUnreadRef.current = count
    })()
    return () => { cancelled = true }
  }, [])

  // Fetch full list when panel is opened
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const data = await refreshNotifications(true)
      if (cancelled) return
      setNotifications(data)
    })()
    return () => { cancelled = true }
  }, [open, refreshNotifications])

  // Poll every 30 s for new notifications
  const pollNotifications = useCallback(async () => {
    const data = await getNotifications()
    const unreadItems = data.filter(n => !n.is_read)
    const unseen = unreadItems.filter(n => !seenIdsRef.current.has(n.id))
    for (const notif of unseen) {
      seenIdsRef.current.add(notif.id)
      fireDesktopNotification(notif)
    }
    const count = await getUnreadCount()
    setUnreadCount(count)
    prevUnreadRef.current = count
    if (open) setNotifications(data)
  }, [open])

  useEffect(() => {
    const id = setInterval(pollNotifications, 30000)
    return () => clearInterval(id)
  }, [pollNotifications])

  async function handleNotifClick(notif: Notification) {
    setOpen(false)
    if (!notif.is_read) {
      const res = await markNotificationRead(notif.id)
      if (res.success) {
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
        await refreshUnreadCount()
      }
    }
    router.push(getNotifLink(notif))
  }

  async function handleMarkAllRead() {
    const res = await markAllNotificationsRead()
    if (!res.success) return
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    await refreshUnreadCount()
  }

  const displayed = tab === 'unread' ? notifications.filter(n => !n.is_read) : notifications
  const grouped = groupByDate(displayed)

  return (
    <>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all hover:bg-slate-100 dark:hover:bg-slate-700"
        aria-label="Notifications"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 min-w-4 h-4 px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white leading-none"
            style={{ background: '#EF4444' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-over panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: '380px',
          maxWidth: '100vw',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.15)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(59,130,246,0.1)' }}
            >
              <Bell size={15} style={{ color: '#3B82F6' }} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
                Notifications
              </h2>
              {unreadCount > 0 && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {unreadCount} unread
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ color: '#3B82F6', background: 'rgba(59,130,246,0.08)' }}
                title="Mark all as read"
              >
                <CheckCheck size={13} /> All read
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-5 pt-3 pb-0 gap-1 shrink-0">
          {(['all', 'unread'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
              style={{
                background: tab === t ? '#3B82F6' : 'transparent',
                color: tab === t ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {t}
              {t === 'unread' && unreadCount > 0 && (
                <span
                  className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: tab === t ? 'rgba(255,255,255,0.25)' : 'rgba(239,68,68,0.15)', color: tab === t ? 'white' : '#EF4444' }}
                >
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto py-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 px-6">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(59,130,246,0.08)' }}
              >
                <BellOff size={22} style={{ color: '#3B82F6' }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {tab === 'unread' ? 'All caught up!' : 'No notifications'}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {tab === 'unread' ? 'No unread notifications.' : 'Notifications will appear here.'}
                </p>
              </div>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.label}>
                {/* Date label */}
                <div className="px-5 py-1.5">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {group.label}
                  </span>
                </div>

                {group.items.map(notif => {
                  const cfg = TYPE_CONFIG[notif.type ?? 'info'] ?? TYPE_CONFIG.info
                  const Icon = cfg.icon
                  return (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => handleNotifClick(notif)}
                      className="w-full flex items-start gap-3 px-5 py-3.5 text-left transition-all group"
                      style={{
                        background: notif.is_read ? 'transparent' : 'rgba(59,130,246,0.04)',
                        borderLeft: notif.is_read ? '3px solid transparent' : '3px solid #3B82F6',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'var(--slate-50)'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = notif.is_read ? 'transparent' : 'rgba(59,130,246,0.04)'
                      }}
                    >
                      {/* Icon */}
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: cfg.bg }}
                      >
                        <Icon size={16} style={{ color: cfg.color }} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-semibold leading-snug truncate"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {notif.title}
                        </p>
                        {notif.body && (
                          <p
                            className="text-xs mt-0.5 line-clamp-2"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            {notif.body}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px]" style={{ color: 'var(--slate-400)' }}>
                            {timeAgo(notif.created_at)}
                          </span>
                          <span
                            className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5"
                            style={{ color: '#3B82F6' }}
                          >
                            Go <ArrowRight size={10} />
                          </span>
                        </div>
                      </div>

                      {/* Unread indicator or check */}
                      <div className="shrink-0 mt-1">
                        {notif.is_read ? (
                          <Check size={13} style={{ color: 'var(--slate-300)' }} />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#3B82F6' }} />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="shrink-0 px-5 py-3"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            {notifications.length > 0
              ? `Showing ${notifications.length} notification${notifications.length !== 1 ? 's' : ''} — click to navigate`
              : 'Notifications appear here in real time'}
          </p>
        </div>
      </div>
    </>
  )
}
