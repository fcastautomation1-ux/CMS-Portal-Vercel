'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell, CheckCheck, Info, AlertTriangle, CheckCircle, XCircle,
  X, BellOff, ArrowRight, Check, Search, Reply,
} from 'lucide-react'
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  sendNotificationReply,
} from '@/app/dashboard/notifications/actions'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { queryKeys } from '@/lib/query-keys'
import type { Notification } from '@/types'

function norm(n: Notification) {
  return {
    ...n,
    isRead: !!(n.read ?? n.is_read),
    bodyText: n.message ?? n.body ?? null,
    navLink: n.link ?? n.related_id ?? null,
    senderName: n.created_by ?? null,
  }
}

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
  return new Date(dateStr).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })
}

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older'
function getDateGroup(dateStr: string): DateGroup {
  const now = new Date()
  const d = new Date(dateStr)
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()
  if (d.toDateString() === today) return 'Today'
  if (d.toDateString() === yesterday) return 'Yesterday'
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) return 'This Week'
  return 'Older'
}

function groupByDate(notifications: Notification[]): Array<{ label: DateGroup; items: Notification[] }> {
  const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older']
  const groups: Record<DateGroup, Notification[]> = { Today: [], Yesterday: [], 'This Week': [], Older: [] }
  for (const n of notifications) groups[getDateGroup(n.created_at)].push(n)
  return order.filter(g => groups[g].length > 0).map(label => ({ label, items: groups[label] }))
}

function resolveNavUrl(notif: Notification): string {
  const n = norm(notif)
  if (n.navLink) {
    if (n.navLink.startsWith('todo:') || n.navLink.startsWith('task:')) return '/dashboard/tasks'
    if (n.navLink.startsWith('account:')) return '/dashboard/accounts'
    if (n.navLink.startsWith('campaign:')) return '/dashboard/campaigns'
    if (n.navLink.startsWith('workflow:')) return '/dashboard/workflows'
    if (/^[0-9a-f-]{36}$/.test(n.navLink)) return '/dashboard/tasks'
    return '/dashboard'
  }
  const text = `${notif.title} ${n.bodyText ?? ''}`.toLowerCase()
  if (text.includes('task') || text.includes('todo')) return '/dashboard/tasks'
  if (text.includes('campaign')) return '/dashboard/campaigns'
  if (text.includes('account')) return '/dashboard/accounts'
  if (text.includes('workflow')) return '/dashboard/workflows'
  if (text.includes('package')) return '/dashboard/packages'
  if (text.includes('user')) return '/dashboard/users'
  if (text.includes('department')) return '/dashboard/departments'
  return '/dashboard'
}

const TYPE_CONFIG: Record<string, { icon: typeof Info; color: string; bg: string; emoji: string }> = {  task_assigned: { icon: CheckCircle, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)', emoji: 'T' },
  task_completed: { icon: CheckCircle, color: '#10B981', bg: 'rgba(16,185,129,0.1)', emoji: 'C' },
  task_shared: { icon: Info, color: '#6366F1', bg: 'rgba(99,102,241,0.1)', emoji: 'S' },
  access_granted: { icon: CheckCircle, color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)', emoji: 'A' },
  team_update: { icon: AlertTriangle, color: '#F97316', bg: 'rgba(249,115,22,0.1)', emoji: 'U' },
  message: { icon: CheckCircle, color: '#10B981', bg: 'rgba(16,185,129,0.1)', emoji: 'M' },
  reply: { icon: Info, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)', emoji: 'R' },
  success: { icon: CheckCircle, color: '#10B981', bg: 'rgba(16,185,129,0.1)', emoji: 'OK' },
  warning: { icon: AlertTriangle, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', emoji: '!' },
  error: { icon: XCircle, color: '#EF4444', bg: 'rgba(239,68,68,0.1)', emoji: 'X' },
  info: { icon: Info, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)', emoji: 'i' },
}

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
      body: norm(notif).bodyText ?? undefined,
      icon: '/favicon.ico',
      tag: notif.id,
    })
    setTimeout(() => n.close(), 8000)
    n.onclick = () => { window.focus(); n.close() }
  } catch {}
}

interface NotificationPanelProps {
  initialCount?: number
  currentUsername?: string
}

export function NotificationPanel({ initialCount = 0, currentUsername = '' }: NotificationPanelProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread' | 'read'>('all')
  const [search, setSearch] = useState('')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const prevUnreadRef = useRef(initialCount)

  const syncUnreadFromList = useCallback((list: Notification[]) => {
    const count = list.filter(n => !norm(n).isRead).length
    setUnreadCount(count)
    prevUnreadRef.current = count
  }, [])

  const refreshNotifications = useCallback(async (withLoading = false) => {
    if (withLoading) setLoading(true)
    try {
      const data = await getNotifications()
      setNotifications(data)
      data.forEach(n => seenIdsRef.current.add(n.id))
      syncUnreadFromList(data)
      return data
    } finally {
      if (withLoading) setLoading(false)
    }
  }, [syncUnreadFromList])

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications(currentUsername || 'guest'),
    queryFn: async () => {
      const data = await getNotifications()
      data.forEach(n => seenIdsRef.current.add(n.id))
      syncUnreadFromList(data)
      return data
    },
    initialData: notifications,
    enabled: Boolean(currentUsername),
    refetchInterval: 30000,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (notificationsQuery.data) {
      setNotifications(notificationsQuery.data)
      syncUnreadFromList(notificationsQuery.data)
    }
  }, [notificationsQuery.data, syncUnreadFromList])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const permGranted = await requestDesktopPermission()
      const [data, count] = await Promise.all([getNotifications(), getUnreadCount()])
      if (cancelled) return
      const unreadItems = data.filter(n => !norm(n).isRead)
      if (permGranted) {
        for (const notif of unreadItems) fireDesktopNotification(notif)
      }
      data.forEach(n => seenIdsRef.current.add(n.id))
      const listUnread = unreadItems.length
      const resolved = typeof count === 'number' && count >= 0 ? count : listUnread
      setUnreadCount(resolved)
      prevUnreadRef.current = resolved
      setNotifications(data)
      queryClient.setQueryData(queryKeys.notifications(currentUsername || 'guest'), data)
      queryClient.setQueryData(queryKeys.notificationCount(currentUsername || 'guest'), resolved)
    })()
    return () => { cancelled = true }
  }, [currentUsername, queryClient])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const data = await refreshNotifications(true)
      if (!cancelled) setNotifications(data)
    })()
    return () => { cancelled = true }
  }, [open, refreshNotifications])

  const pollNotifications = useCallback(async () => {
    const data = await getNotifications()
    const unreadItems = data.filter(n => !norm(n).isRead)
    const unseen = unreadItems.filter(n => !seenIdsRef.current.has(n.id))
    for (const notif of unseen) {
      seenIdsRef.current.add(notif.id)
      fireDesktopNotification(notif)
    }
    syncUnreadFromList(data)
    if (open) setNotifications(data)
  }, [open, syncUnreadFromList])

  useEffect(() => {
    const id = setInterval(pollNotifications, 30000)
    return () => clearInterval(id)
  }, [pollNotifications])

  useEffect(() => {
    if (!currentUsername) return

    return subscribeToPostgresChanges(
      `notifications:${currentUsername}`,
      [
        { table: 'notifications', filter: `user_id=eq.${currentUsername}` },
      ],
      () => {
        void pollNotifications()
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(currentUsername) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationCount(currentUsername) })
      }
    )
  }, [currentUsername, pollNotifications, queryClient])

  async function handleNotifClick(notif: Notification) {
    const n = norm(notif)
    if (!n.isRead) {
      const res = await markNotificationRead(notif.id)
      if (res.success) {
        const updated = notifications.map(x => x.id === notif.id ? { ...x, read: true, is_read: true } : x)
        setNotifications(updated)
        syncUnreadFromList(updated)
      }
    }
    setOpen(false)
    router.push(resolveNavUrl(notif))
  }

  async function handleMarkAllRead() {
    if (markingAllRead) return
    setMarkingAllRead(true)
    const res = await markAllNotificationsRead()
    if (res.success) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true, is_read: true })))
      setUnreadCount(0)
      prevUnreadRef.current = 0
      setTab('unread')
    } else {
      await refreshNotifications(true)
    }
    setMarkingAllRead(false)
  }

  async function handleDelete(id: string) {
    const res = await deleteNotification(id)
    if (res.success) {
      const updated = notifications.filter(n => n.id !== id)
      setNotifications(updated)
      syncUnreadFromList(updated)
    }
  }

  async function handleSendReply(notif: Notification) {
    const n = norm(notif)
    if (!replyText.trim() || !n.senderName || !currentUsername) return
    setSendingReply(true)
    await sendNotificationReply({
      to_user: n.senderName,
      reply_message: replyText.trim(),
      original_link: n.navLink,
      from_user: currentUsername,
    })
    setSendingReply(false)
    setReplyingTo(null)
    setReplyText('')
  }

  const searchLower = search.toLowerCase()
  const preFilter = search
    ? notifications.filter(n => {
        const nb = norm(n)
        return (
          n.title.toLowerCase().includes(searchLower) ||
          (nb.bodyText ?? '').toLowerCase().includes(searchLower) ||
          (nb.senderName ?? '').toLowerCase().includes(searchLower)
        )
      })
    : notifications

  const displayed =
    tab === 'unread' ? preFilter.filter(n => !norm(n).isRead) :
    tab === 'read' ? preFilter.filter(n => norm(n).isRead) :
    preFilter

  const grouped = groupByDate(displayed)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all hover:bg-slate-100 dark:hover:bg-slate-700"
        aria-label="Notifications"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white leading-none" style={{ background: '#EF4444' }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }} onClick={() => setOpen(false)} />
      )}

      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: '400px',
          maxWidth: '100vw',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.15)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.1)' }}>
              <Bell size={15} style={{ color: '#3B82F6' }} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Notifications</h2>
              {unreadCount > 0 && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{unreadCount} unread</p>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {(unreadCount > 0 || notifications.some(n => !norm(n).isRead)) && (
              <button
                onClick={handleMarkAllRead}
                disabled={markingAllRead}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ color: '#3B82F6', background: 'rgba(59,130,246,0.08)', opacity: markingAllRead ? 0.6 : 1, cursor: markingAllRead ? 'not-allowed' : 'pointer' }}
                title="Mark all as read"
              >
                <CheckCheck size={13} /> {markingAllRead ? 'Marking...' : 'Mark all read'}
              </button>
            )}
            <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text-muted)' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-3 pb-0 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notifications..."
              className="w-full h-8 pl-8 pr-3 rounded-lg text-xs outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex px-5 pt-2 pb-0 gap-1 shrink-0">
          {(['all', 'unread', 'read'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
              style={{ background: tab === t ? '#3B82F6' : 'transparent', color: tab === t ? 'white' : 'var(--color-text-muted)' }}
            >
              {t}
              {t === 'unread' && unreadCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: tab === t ? 'rgba(255,255,255,0.25)' : 'rgba(239,68,68,0.15)', color: tab === t ? 'white' : '#EF4444' }}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 px-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.08)' }}>
                <BellOff size={22} style={{ color: '#3B82F6' }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {search ? `No matches for "${search}"` : tab === 'unread' ? 'All caught up!' : tab === 'read' ? 'No read notifications' : 'No notifications'}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {search ? 'Try a different search term' : tab === 'unread' ? 'No unread notifications.' : 'Notifications will appear here.'}
                </p>
              </div>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.label}>
                <div className="px-5 py-2" style={{ background: group.label === 'Today' ? 'linear-gradient(135deg, #eff6ff, #dbeafe)' : 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: group.label === 'Today' ? '#1D4ED8' : 'var(--color-text-muted)' }}>
                    {group.label}
                  </span>
                </div>

                {group.items.map(notif => {
                  const n = norm(notif)
                  const cfg = TYPE_CONFIG[notif.type ?? 'info'] ?? TYPE_CONFIG.info
                  const isReplying = replyingTo === notif.id
                  const canReply = !!(n.senderName && n.senderName !== currentUsername)

                  return (
                    <div key={notif.id}>
                      <div
                        className="relative group"
                        style={{
                          background: n.isRead ? 'transparent' : 'linear-gradient(90deg, rgba(59,130,246,0.06), transparent)',
                          borderLeft: n.isRead ? '3px solid transparent' : '3px solid #3B82F6',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canReply && (
                            <button
                              onClick={e => { e.stopPropagation(); setReplyingTo(isReplying ? null : notif.id); setReplyText('') }}
                              className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
                              style={{ background: 'rgba(99,102,241,0.12)', color: '#6366F1' }}
                              title="Reply"
                            >
                              <Reply size={11} />
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); void handleDelete(notif.id) }}
                            className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
                            style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444' }}
                            title="Dismiss"
                          >
                            <X size={11} />
                          </button>
                        </div>

                        <button type="button" onClick={() => void handleNotifClick(notif)} className="w-full flex items-start gap-3 px-5 py-3.5 text-left pr-16">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 text-base" style={{ background: cfg.bg, opacity: n.isRead ? 0.5 : 1 }}>
                            {cfg.emoji}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-snug truncate" style={{ color: n.isRead ? 'var(--slate-500)' : 'var(--color-text)', fontWeight: n.isRead ? '500' : '600' }}>
                              {notif.title}
                            </p>
                            {n.bodyText && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>{n.bodyText}</p>}
                            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1">
                              <span className="text-[11px]" style={{ color: 'var(--slate-400)' }}>Time: {timeAgo(notif.created_at)}</span>
                              {n.senderName && <span className="text-[11px]" style={{ color: 'var(--slate-400)' }}>By: {n.senderName}</span>}
                              <span className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5" style={{ color: '#3B82F6' }}>
                                Go <ArrowRight size={9} />
                              </span>
                            </div>
                          </div>

                          <div className="shrink-0 mt-2">
                            {n.isRead ? (
                              <div className="flex items-center justify-center w-4 h-4 rounded-full" style={{ background: 'rgba(148,163,184,0.2)' }}>
                                <Check size={10} style={{ color: 'var(--slate-400)' }} />
                              </div>
                            ) : (
                              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#3B82F6', boxShadow: '0 0 6px rgba(59,130,246,0.6)' }} />
                            )}
                          </div>
                        </button>

                        {isReplying && (
                          <div className="px-5 pb-3 pt-0 pl-17" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-2 items-center">
                              <input
                                autoFocus
                                value={replyText}
                                onChange={e => setReplyText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void handleSendReply(notif); if (e.key === 'Escape') setReplyingTo(null) }}
                                placeholder="Type a reply..."
                                className="flex-1 h-8 px-3 text-xs rounded-lg outline-none"
                                style={{ border: '1.5px solid #6366F1', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                              />
                              <button
                                onClick={() => void handleSendReply(notif)}
                                disabled={sendingReply || !replyText.trim()}
                                className="h-8 px-3 text-xs font-bold rounded-lg text-white"
                                style={{ background: 'linear-gradient(135deg, #6366F1, #4F46E5)', opacity: sendingReply || !replyText.trim() ? 0.5 : 1 }}
                              >
                                {sendingReply ? '...' : 'Send'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="shrink-0 px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            {notifications.length > 0
              ? `Showing ${displayed.length} of ${notifications.length} notification${notifications.length !== 1 ? 's' : ''}`
              : 'Notifications appear here in real time'}
          </p>
        </div>
      </div>
    </>
  )
}
