'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logoutAction } from '@/app/login/actions'
import type { SessionUser, SidebarTaskCounts } from '@/types'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { getCachedSidebarTaskCounts } from '@/app/dashboard/tasks/actions'
import { getTeamStats } from '@/app/dashboard/team/actions'
import { buildRealtimeEqFilter, subscribeToPostgresChanges } from '@/lib/realtime'
import {
  LayoutGrid,
  TrendingUp,
  Users,
  GitBranch,
  Settings,
  BarChart2,
  CheckSquare,
  Building2,
  UsersRound,
  PieChart,
  Package,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  Mail,
  Layers,
  Inbox,
  ListOrdered,
  Loader2,
} from 'lucide-react'

interface PublicBranding {
  portal_name: string
  portal_tagline: string
  logo_url: string | null
}

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  color: string
}

interface NavSection {
  id: string
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <Home size={17} />, color: '#2B7FFF' },
      { label: 'Tasks', href: '/dashboard/tasks', icon: <CheckSquare size={17} />, color: '#10B981' },
      { label: 'Team', href: '/dashboard/team', icon: <UsersRound size={17} />, color: '#EC4899' },
      { label: 'Hall Queue', href: '/dashboard/team?scope=tasks_queue', icon: <Inbox size={17} />, color: '#7e5daa' },
      { label: 'Task Priority', href: '/dashboard/tasks/queue-priority', icon: <ListOrdered size={17} />, color: '#7C3AED' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    items: [
      { label: 'Users', href: '/dashboard/users', icon: <Users size={17} />, color: '#8B5CF6' },
      { label: 'Departments', href: '/dashboard/departments', icon: <Building2 size={17} />, color: '#0D9488' },
      { label: 'Clusters', href: '/dashboard/clusters', icon: <Layers size={17} />, color: '#2B7FFF' },
      { label: 'Looker Reports', href: '/dashboard/looker', icon: <BarChart2 size={17} />, color: '#6366F1' },
      { label: 'Analytics', href: '/dashboard/analytics', icon: <PieChart size={17} />, color: '#8B5CF6' },
      { label: 'Packages', href: '/dashboard/packages', icon: <Package size={17} />, color: '#F59E0B' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      { label: 'Accounts', href: '/dashboard/accounts', icon: <LayoutGrid size={17} />, color: '#14B8A6' },
      { label: 'Campaigns', href: '/dashboard/campaigns', icon: <TrendingUp size={17} />, color: '#F97316' },
      { label: 'Workflows', href: '/dashboard/workflows', icon: <GitBranch size={17} />, color: '#10B981' },
      { label: 'Rules', href: '/dashboard/rules', icon: <Settings size={17} />, color: '#F59E0B' },
      { label: 'Integrations', href: '/dashboard/settings', icon: <Mail size={17} />, color: '#0EA5E9' },
    ],
  },
]

function isNavItemVisible(href: string, user: SessionUser): boolean {
  const { role, moduleAccess: ma, allowedAccounts, allowedCampaigns, allowedLookerReports, teamMembers } = user
  const isAdminOrSM = role === 'Admin' || role === 'Super Manager'
  const isManager = role === 'Manager'

  switch (href) {
    case '/dashboard':
      return true // always visible

    case '/dashboard/accounts':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.enabled === true
      return allowedAccounts.length > 0

    case '/dashboard/campaigns':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.enabled === true
      return allowedCampaigns.length > 0

    case '/dashboard/users':
      if (isAdminOrSM) return true
      if (isManager) return ma?.users?.enabled === true
      return false

    case '/dashboard/workflows':
    case '/dashboard/rules':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.accessLevel === 'all'
      return false

    case '/dashboard/looker':
      if (isAdminOrSM) return true
      if (isManager) return ma?.looker?.enabled === true
      return allowedLookerReports.length > 0

    case '/dashboard/tasks':
      return true

    case '/dashboard/departments':
    case '/dashboard/packages':
      return isAdminOrSM || isManager

    case '/dashboard/team':
      if (isAdminOrSM) return true
      return teamMembers.length > 0

    case '/dashboard/team?scope=tasks_queue':
      // Only show Hall Queue to managers, supervisors, super managers, and admins
      if (user.clusterIds.length === 0) return false
      return isAdminOrSM || isManager || role === 'Supervisor'

    case '/dashboard/tasks/queue-priority':
      // Show to any user who belongs to at least one hall cluster
      return user.clusterIds.length > 0

    case '/dashboard/analytics':
      return isAdminOrSM

    case '/dashboard/settings':
      return isAdminOrSM

    case '/dashboard/clusters':
      return isAdminOrSM

    default:
      return true
  }
}

interface SidebarProps {
  user: SessionUser
  mobileOpen?: boolean
  onClose?: () => void
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
}

export function Sidebar({
  user,
  mobileOpen = false,
  onClose,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const refreshTimerRef = useRef<number | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    workspace: true,
    data: true,
    automation: true,
  })
  const [tasksOpen, setTasksOpen] = useState(true)
  const [teamOpen, setTeamOpen] = useState(true)
  const [teamTaskOpen, setTeamTaskOpen] = useState(true)
  // Tracks the href of a nav item immediately after click, before navigation resolves.
  // Cleared automatically when pathname/searchParams update (navigation complete).
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    setPendingHref(null)
  }, [pathname, searchParams])

  const brandingQuery = useQuery({
    queryKey: ['public-branding'],
    queryFn: () =>
      fetch('/api/public-branding')
        .then((r) => r.json())
        .then((d): PublicBranding => ({
          portal_name: d?.portal_name || 'CMS Portal',
          portal_tagline: d?.portal_tagline || 'Operations Hub',
          logo_url: d?.logo_url || null,
        }))
        .catch((): PublicBranding => ({ portal_name: 'CMS Portal', portal_tagline: 'Operations Hub', logo_url: null })),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
  const branding = brandingQuery.data ?? { portal_name: 'CMS Portal', portal_tagline: 'Operations Hub', logo_url: null }

  const taskCountsQuery = useQuery({
    queryKey: queryKeys.taskSidebarCounts(user.username),
    queryFn: () => getCachedSidebarTaskCounts().catch(() => ({ all: 0, completed: 0, in_progress: 0, pending: 0, overdue: 0, queue: 0 } satisfies SidebarTaskCounts)),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    // Realtime invalidation already keeps this fresh without forcing a mount fetch.
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
  const myAllCounts = taskCountsQuery.data ?? { all: 0, completed: 0, in_progress: 0, pending: 0, overdue: 0, queue: 0 }

  const teamStatsQuery = useQuery({
    queryKey: queryKeys.teamStats(user.username),
    queryFn: () => getTeamStats().catch(() => null),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
  const teamStats = teamStatsQuery.data ?? null

  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => isNavItemVisible(item.href, user)),
      })).filter((section) => section.items.length > 0),
    [user]
  )

  const toggleSection = (sectionId: string) => {
    setOpenSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction()
      router.push('/login')
      router.refresh()
    })
  }

  const isTaskScopeActive = pathname === '/dashboard/tasks'
  const activeTaskStatus = searchParams.get('status') ?? 'all'
  const isTeamActive = pathname === '/dashboard/team' || pathname.startsWith('/dashboard/team/')
  const activeTeamScope = isTeamActive ? (searchParams.get('scope') ?? 'users') : 'users'
  const teamTaskLinks = [
    { label: 'All task', scope: 'tasks_all', badge: 'bg-blue-500/15 text-blue-700' },
    { label: 'Completed', scope: 'tasks_completed', badge: 'bg-green-600/15 text-green-700' },
    { label: 'In Progress', scope: 'tasks_in_progress', badge: 'bg-cyan-500/15 text-cyan-700' },
    { label: 'Pending', scope: 'tasks_pending', badge: 'bg-amber-500/15 text-amber-700' },
    { label: 'Overdue', scope: 'tasks_overdue', badge: 'bg-rose-500/15 text-rose-700' },
  ]
  const statusBadgeClass = (tone: 'all' | 'completed' | 'in_progress' | 'pending' | 'overdue' | 'queue', active: boolean) => {
    if (active) {
      if (tone === 'completed') return 'bg-green-100 text-green-700'
      if (tone === 'in_progress') return 'bg-cyan-100 text-cyan-700'
      if (tone === 'pending') return 'bg-amber-100 text-amber-700'
      if (tone === 'overdue') return 'bg-rose-100 text-rose-700'
      if (tone === 'queue') return 'bg-violet-100 text-violet-700'
      return 'bg-blue-100 text-blue-700'
    }
    if (tone === 'completed') return 'bg-green-600/15 text-green-700'
    if (tone === 'in_progress') return 'bg-cyan-500/15 text-cyan-700'
    if (tone === 'pending') return 'bg-amber-500/15 text-amber-700'
    if (tone === 'overdue') return 'bg-rose-500/15 text-rose-700'
    if (tone === 'queue') return 'bg-violet-500/15 text-violet-700'
    return 'bg-blue-500/15 text-blue-700'
  }

  useEffect(() => {
    // Debounce at 3 s — short enough to feel responsive, long enough to absorb burst
    // updates from task mutations that touch multiple rows (e.g. bulk actions).
    const scheduleRefresh = () => {
      if (document.hidden) return // skip when tab is in background
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskSidebarCounts(user.username) })
      }, 3_000)
    }

    // Use per-user column filters so each realtime channel only receives events
    // for rows directly involving this user.  Without these filters, every
    // todos change (from any user) would fire a sidebar count refresh for every
    // connected session — the main concurrency amplification source at ~50 users.
    const unsubscribe = subscribeToPostgresChanges(
      `sidebar-task-counts:${user.username}`,
      [
        { table: 'todos', filter: buildRealtimeEqFilter('username', user.username) },
        { table: 'todos', filter: buildRealtimeEqFilter('assigned_to', user.username) },
        { table: 'todos', filter: buildRealtimeEqFilter('pending_approver', user.username) },
        { table: 'todos', filter: buildRealtimeEqFilter('completed_by', user.username) },
      ],
      scheduleRefresh
    )

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      unsubscribe()
    }
  }, [queryClient, user.username])

  useEffect(() => {
    const onBrandingUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ['public-branding'] })
    }
    window.addEventListener('portal-branding-updated', onBrandingUpdated)
    return () => {
      window.removeEventListener('portal-branding-updated', onBrandingUpdated)
    }
  }, [queryClient])

  return (
    <aside
      className={cn(
        'glass-sidebar fixed left-0 top-0 h-screen flex flex-col z-40 transition-all duration-300',
        'md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
      style={{ width: collapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)' }}
    >
      {/* ── Logo ─────────────────────────────────────────────── */}
      <div
        className="flex items-center h-16 shrink-0 overflow-hidden"
        style={{ borderBottom: '1px solid var(--color-border)', padding: collapsed ? '0 14px' : '0 20px' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: 'linear-gradient(135deg, var(--blue-600), var(--violet-600))' }}
        >
          {branding.logo_url ? (
            <Image src={branding.logo_url} alt={branding.portal_name} width={32} height={32} className="w-full h-full object-cover" unoptimized />
          ) : (
            <ShieldCheck size={15} className="text-white" />
          )}
        </div>
        {!collapsed && (
          <div className="ml-3 min-w-0">
            <div className="font-bold text-sm leading-tight truncate" style={{ color: 'var(--color-text)', letterSpacing: '-0.01em' }}>
              {branding.portal_name}
            </div>
            <div className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text-muted)' }}>{branding.portal_tagline}</div>
          </div>
        )}
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3" style={{ padding: collapsed ? '12px 8px' : '12px' }}>
        {collapsed ? (
          <ul className="flex flex-col gap-0.5">
            {visibleSections.flatMap((section) => section.items).map((item) => {
              const isActive = item.href === '/dashboard'
                ? (pathname === '/dashboard' || pathname === '/dashboard/')
                : (pathname === item.href || pathname.startsWith(item.href + '/'))
              const isPendingNav = pendingHref === item.href

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => { setPendingHref(item.href); onClose?.() }}
                    title={item.label}
                    prefetch={false}
                    className={cn(
                      'group relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium transition-all duration-150',
                      (isActive || isPendingNav) && 'text-white'
                    )}
                    style={(isActive || isPendingNav) ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` } : undefined}
                  >
                    {!(isActive || isPendingNav) && (
                      <span
                        className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ background: `${item.color}12` }}
                      />
                    )}
                    <span className="relative z-10" style={{ color: (isActive || isPendingNav) ? 'white' : item.color }}>
                      {isPendingNav && !isActive ? <Loader2 size={17} className="animate-spin" /> : item.icon}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="space-y-3">
            {visibleSections.map((section) => {
              const isOpen = openSections[section.id] ?? true

              return (
                <div key={section.id} className="rounded-xl border border-[var(--color-border)]/80 bg-white/50 p-1.5">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-50"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
                      {section.label}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn('shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')}
                    />
                  </button>

                  {isOpen && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {section.items.map((item) => {
                        const isActive = item.href === '/dashboard'
                          ? (pathname === '/dashboard' || pathname === '/dashboard/')
                          : item.href === '/dashboard/team?scope=tasks_queue'
                          ? pathname === '/dashboard/team' && searchParams.get('scope') === 'tasks_queue'
                          : (pathname === item.href || pathname.startsWith(item.href + '/'))

                        if (item.href === '/dashboard/team') {
                          return (
                            <li key={item.href} className="overflow-hidden rounded-lg">
                              <button
                                type="button"
                              onClick={() => {
                                  setPendingHref('/dashboard/team?scope=users')
                                  onClose?.()
                                  router.push('/dashboard/team?scope=users', { scroll: false })
                                }}
                                className={cn(
                                  'group relative flex w-full items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150',
                                  isTeamActive && 'text-white'
                                )}
                                style={isTeamActive ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` } : undefined}
                              >
                                {!isTeamActive && (
                                  <span
                                    className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                                    style={{ background: `${item.color}12` }}
                                  />
                                )}
                                <span className="relative z-10 shrink-0" style={{ color: isTeamActive ? 'white' : item.color }}>
                                  {item.icon}
                                </span>
                                <span className="relative z-10 flex-1 truncate text-left" style={{ color: isTeamActive ? 'white' : 'var(--color-text)' }}>
                                  {item.label}
                                </span>
                                <span
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setTeamOpen((current) => !current)
                                  }}
                                  className="relative z-10 shrink-0"
                                >
                                  <ChevronDown size={12} className={cn('transition-transform', teamOpen && 'rotate-180', isTeamActive ? 'text-white/80' : 'text-slate-400')} />
                                </span>
                              </button>

                              {teamOpen && (
                                <div className="mt-1 space-y-1 pl-4">
                                  <div className="pl-2 border-l border-slate-200 space-y-0.5">
                                    {/* User link */}
                                    <Link
                                      href="/dashboard/team?scope=users"
                                      onClick={() => { setPendingHref('/dashboard/team?scope=users'); onClose?.() }}
                                      prefetch={false}
                                      scroll={false}
                                      className={cn(
                                        'flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-medium transition',
                                        (isTeamActive && activeTeamScope === 'users') || pendingHref === '/dashboard/team?scope=users'
                                          ? 'bg-slate-100 text-slate-900'
                                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                      )}
                                    >
                                      <span>Users</span>
                                      {pendingHref === '/dashboard/team?scope=users' && !(isTeamActive && activeTeamScope === 'users')
                                        ? <Loader2 size={11} className="animate-spin text-slate-500" />
                                        : teamStats && (
                                          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                            {teamStats.users}
                                          </span>
                                        )
                                      }
                                    </Link>

                                    {/* Task collapsible */}
                                    <div className="border-l border-slate-200 pl-2">
                                      <div className="flex items-center rounded-lg transition hover:bg-slate-50">
                                        <Link
                                          href="/dashboard/team?scope=tasks_all"
                                          onClick={() => { setPendingHref('/dashboard/team?scope=tasks_all'); onClose?.() }}
                                          prefetch={false}
                                          scroll={false}
                                          className="flex flex-1 items-center gap-1 px-2 py-1.5 text-xs font-semibold text-slate-700"
                                        >
                                          <span>Tasks</span>
                                        </Link>
                                        <button
                                          type="button"
                                          onClick={() => setTeamTaskOpen((current) => !current)}
                                          className="px-2 py-1.5"
                                        >
                                          <ChevronDown size={12} className={cn('shrink-0 text-slate-400 transition-transform', teamTaskOpen && 'rotate-180')} />
                                        </button>
                                      </div>

                                      {teamTaskOpen && (
                                        <ul className="mt-0.5 space-y-0.5 pl-2">
                                          {teamTaskLinks.map((link) => {
                                            const isSubActive = isTeamActive && activeTeamScope === link.scope
                                            const isSubPending = pendingHref === `/dashboard/team?scope=${link.scope}`
                                            return (
                                              <li key={link.scope}>
                                                <Link
                                                  href={`/dashboard/team?scope=${link.scope}`}
                                                  onClick={() => { setPendingHref(`/dashboard/team?scope=${link.scope}`); onClose?.() }}
                                                  prefetch={false}
                                                  scroll={false}
                                                  className={cn(
                                                    'flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-medium transition',
                                                    (isSubActive || isSubPending)
                                                      ? 'bg-slate-100 text-slate-900'
                                                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                                  )}
                                                >
                                                  <span>{link.label}</span>
                                                  {isSubPending && !isSubActive
                                                    ? <Loader2 size={11} className="animate-spin text-slate-500" />
                                                    : teamStats && (
                                                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', link.badge)}>
                                                        {teamStats[link.scope as keyof typeof teamStats]}
                                                      </span>
                                                    )
                                                  }
                                                </Link>
                                              </li>
                                            )
                                          })}
                                        </ul>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </li>
                          )
                        }

                        if (item.href === '/dashboard/tasks') {
                          return (
                            <li key={item.href} className="overflow-hidden rounded-lg">
                              <button
                                type="button"
                                onClick={() => setTasksOpen((current) => !current)}
                                className={cn(
                                  'group relative flex w-full items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150',
                                  isTaskScopeActive && 'text-white'
                                )}
                                style={isTaskScopeActive ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` } : undefined}
                              >
                                {!isTaskScopeActive && (
                                  <span
                                    className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                                    style={{ background: `${item.color}12` }}
                                  />
                                )}
                                <span className="relative z-10 shrink-0" style={{ color: isTaskScopeActive ? 'white' : item.color }}>
                                  {item.icon}
                                </span>
                                <span className="relative z-10 flex-1 truncate text-left" style={{ color: isTaskScopeActive ? 'white' : 'var(--color-text)' }}>
                                  {item.label}
                                </span>
                                <ChevronDown size={12} className={cn('relative z-10 shrink-0 transition-transform', tasksOpen && 'rotate-180', isTaskScopeActive ? 'text-white/80' : 'text-slate-400')} />
                              </button>

                              {tasksOpen && (
                                <ul className="mt-1 space-y-1 pl-6">
                                  {([
                                    { label: 'All task', status: 'all', count: myAllCounts.all, tone: 'all' as const },
                                    { label: 'Complete', status: 'completed', count: myAllCounts.completed, tone: 'completed' as const },                                    { label: 'In Progress', status: 'in_progress', count: myAllCounts.in_progress, tone: 'in_progress' as const },                                    { label: 'Pending', status: 'pending', count: myAllCounts.pending, tone: 'pending' as const },
                                    { label: 'Overdue', status: 'overdue', count: myAllCounts.overdue, tone: 'overdue' as const },
                                    ...(user.clusterIds.length === 0 ? [{ label: 'Queue', status: 'queue' as const, count: myAllCounts.queue, tone: 'queue' as const }] : []),
                                  ] as const).map((statusLink) => {
                                    const thisHref = `/dashboard/tasks?scope=my_all&status=${statusLink.status}`
                                    const isSubActive = pathname === '/dashboard/tasks' && activeTaskStatus === statusLink.status
                                    const isSubPending = pendingHref === thisHref
                                    return (
                                      <li key={statusLink.status}>
                                        <Link
                                          href={thisHref}
                                          onClick={() => { setPendingHref(thisHref); onClose?.() }}
                                          prefetch={false}
                                          scroll={false}
                                          className={cn(
                                            'flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition',
                                            (isSubActive || isSubPending) ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                          )}
                                        >
                                          <span>{statusLink.label}</span>
                                          {isSubPending && !isSubActive
                                            ? <Loader2 size={11} className="animate-spin text-slate-500" />
                                            : <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', statusBadgeClass(statusLink.tone, isSubActive))}>
                                                {statusLink.count}
                                              </span>
                                          }
                                        </Link>
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                            </li>
                          )
                        }

                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => { setPendingHref(item.href); onClose?.() }}
                              prefetch={false}
                              className={cn(
                                'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                                (isActive || pendingHref === item.href) && 'text-white'
                              )}
                              style={(isActive || pendingHref === item.href) ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` } : undefined}
                            >
                              {!(isActive || pendingHref === item.href) && (
                                <span
                                  className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                                  style={{ background: `${item.color}12` }}
                                />
                              )}
                              <span className="relative z-10 shrink-0" style={{ color: (isActive || pendingHref === item.href) ? 'white' : item.color }}>
                                {item.icon}
                              </span>
                              <span className="relative z-10 flex-1 truncate text-left" style={{ color: (isActive || pendingHref === item.href) ? 'white' : 'var(--color-text)' }}>
                                {item.label}
                              </span>
                              {item.href === '/dashboard/team?scope=tasks_queue' && teamStats && teamStats.tasks_queue > 0 && (
                                <span className={cn('relative z-10 rounded-full px-2 py-0.5 text-[11px] font-semibold', (isActive || pendingHref === item.href) ? 'bg-white/20 text-white' : 'bg-orange-500/15 text-orange-600')}>
                                  {teamStats.tasks_queue}
                                </span>
                              )}
                              {pendingHref === item.href && !isActive
                                ? <Loader2 size={12} className="relative z-10 shrink-0 animate-spin opacity-80" />
                                : isActive && item.href !== '/dashboard/team?scope=tasks_queue' && <ChevronRight size={12} className="relative z-10 shrink-0 opacity-60" />
                              }
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </nav>

      {/* ── Collapse toggle + Logout ─────────────────────── */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid var(--color-border)', padding: collapsed ? '12px 8px' : '12px' }}
      >
        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className="hidden md:flex btn-motion w-full items-center rounded-lg text-sm font-medium transition-all hover:bg-red-50 hover:text-red-600 mb-1"
          style={{
            color: 'var(--color-text-muted)',
            gap: collapsed ? 0 : '10px',
            padding: collapsed ? '8px 0' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : (
            <>
              <ChevronLeft size={15} />
              <span>Collapse</span>
            </>
          )}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isPending}
          className="btn-motion w-full flex items-center rounded-lg text-sm font-medium transition-all disabled:opacity-50 hover:bg-red-50 hover:text-red-600"
          style={{
            color: 'var(--color-text-muted)',
            gap: collapsed ? 0 : '10px',
            padding: collapsed ? '8px 0' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={15} />
          {!collapsed && <span>{isPending ? 'Signing out…' : 'Sign out'}</span>}
        </button>
      </div>
    </aside>
  )
}



