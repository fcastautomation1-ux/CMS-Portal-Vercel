'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, Check, CheckCheck, Info, AlertTriangle, CheckCircle, XCircle, X } from 'lucide-react'
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/app/dashboard/notifications/actions'
import type { Notification } from '@/types'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function NotifIcon({ type }: { type: string | null }) {
  if (type === 'success') return <CheckCircle size={14} className="text-emerald-500" />
  if (type === 'warning') return <AlertTriangle size={14} className="text-amber-500" />
  if (type === 'error') return <XCircle size={14} className="text-red-500" />
  return <Info size={14} className="text-blue-500" />
}

function notifColor(type: string | null): string {
  if (type === 'success') return 'var(--emerald-500)'
  if (type === 'warning') return 'var(--amber-500)'
  if (type === 'error') return 'var(--rose-500)'
  return 'var(--blue-600)'
}

// ── Desktop Notification Helper ────────────────────────────────────────────────

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
      tag: notif.id, // deduplicate
      silent: false,
    })
    // Auto-close after 6 seconds
    setTimeout(() => n.close(), 6000)
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Silently fail if notifications aren't supported in this context
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface NotificationPanelProps {
  initialCount?: number
}

export function NotificationPanel({ initialCount = 0 }: NotificationPanelProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  // Track IDs we've already fired desktop notifs for (to avoid dupes)
  const seenIdsRef = useRef<Set<string>>(new Set())
  // Track previous unread count to detect new arrivals
  const prevUnreadRef = useRef(initialCount)

  // Request desktop notification permission once on mount
  useEffect(() => {
    requestDesktopPermission()
  }, [])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Fetch notifications when opened
  useEffect(() => {
    if (!open) return
    setLoading(true)
    getNotifications().then(data => {
      setNotifications(data)
      const unread = data.filter(n => !n.is_read).length
      setUnreadCount(unread)
      // Mark all fetched IDs as seen (don't re-fire desktop notif for existing)
      data.forEach(n => seenIdsRef.current.add(n.id))
      setLoading(false)
    })
  }, [open])

  // Poll for new notifications every 30 seconds, fire desktop notif on new ones
  const pollNotifications = useCallback(async () => {
    const data = await getNotifications()
    const unreadItems = data.filter(n => !n.is_read)
    const newCount = unreadItems.length

    // Fire desktop notifications for brand-new unread items we haven't seen yet
    const unseen = unreadItems.filter(n => !seenIdsRef.current.has(n.id))
    for (const notif of unseen) {
      seenIdsRef.current.add(notif.id)
      fireDesktopNotification(notif)
    }

    setUnreadCount(newCount)
    prevUnreadRef.current = newCount

    // If panel is already open, refresh the list
    if (open) {
      setNotifications(data)
    }
  }, [open])

  useEffect(() => {
    const id = setInterval(pollNotifications, 30000)
    return () => clearInterval(id)
  }, [pollNotifications])

  async function handleMarkRead(notif: Notification) {
    if (notif.is_read) return
    await markNotificationRead(notif.id)
    setNotifications(prev =>
      prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n)
    )
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all hover:bg-slate-100 dark:hover:bg-slate-700"
        aria-label="Notifications"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white leading-none"
            style={{ background: 'var(--rose-500)' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl overflow-hidden animate-slide-up z-50"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-2">
              <Bell size={15} style={{ color: 'var(--blue-600)' }} />
              <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span
                  className="text-[11px] font-bold px-1.5 py-0.5 rounded-full text-white"
                  style={{ background: 'var(--rose-500)' }}
                >
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  style={{ color: 'var(--blue-600)' }}
                >
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--blue-50)' }}
                >
                  <Bell size={18} style={{ color: 'var(--blue-600)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  No notifications yet
                </p>
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  onClick={() => handleMarkRead(notif)}
                  className="flex gap-3 px-4 py-3 cursor-pointer transition-colors"
                  style={{
                    background: notif.is_read ? 'transparent' : 'var(--blue-50)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--slate-50)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = notif.is_read ? 'transparent' : 'var(--blue-50)'
                  }}
                >
                  {/* Icon */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `${notifColor(notif.type)}15` }}
                  >
                    <NotifIcon type={notif.type} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium leading-snug"
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
                    <p className="text-[11px] mt-1" style={{ color: 'var(--slate-400)' }}>
                      {timeAgo(notif.created_at)}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {!notif.is_read && (
                    <div
                      className="w-2 h-2 rounded-full mt-2 shrink-0"
                      style={{ background: 'var(--blue-600)' }}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div
              className="px-4 py-2.5 flex items-center justify-center"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Showing last {notifications.length} notifications
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
