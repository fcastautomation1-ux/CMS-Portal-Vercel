'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { logoutAction } from '@/app/login/actions'
import type { SessionUser } from '@/types'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { getTodos } from '@/app/dashboard/tasks/actions'
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
} from 'lucide-react'

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
    ],
  },
  {
    id: 'data',
    label: 'Data',
    items: [
      { label: 'Users', href: '/dashboard/users', icon: <Users size={17} />, color: '#8B5CF6' },
      { label: 'Departments', href: '/dashboard/departments', icon: <Building2 size={17} />, color: '#0D9488' },
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

    case '/dashboard/analytics':
      return isAdminOrSM

    case '/dashboard/settings':
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
  const [isPending, startTransition] = useTransition()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    workspace: true,
    data: true,
    automation: true,
  })
  const [tasksOpen, setTasksOpen] = useState(true)
  const [taskGroupsOpen, setTaskGroupsOpen] = useState<Record<string, boolean>>({
    my_assign_task: true,
    assign_to_me: true,
  })

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(user.username),
    queryFn: () => getTodos().catch(() => []),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  const sidebarTasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data])

  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => isNavItemVisible(item.href, user)),
      })).filter((section) => section.items.length > 0),
    [user]
  )

  useEffect(() => {
    visibleSections.forEach((section) => {
      section.items.forEach((item) => {
        router.prefetch(item.href)
      })
    })
  }, [router, visibleSections])

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
  const openTaskView = (scope: string, status: 'all' | 'completed' | 'pending' | 'overdue' = 'all') => {
    onClose?.()
    router.push(`/dashboard/tasks?scope=${scope}&status=${status}`, { scroll: false })
  }

  const isTaskScopeActive = pathname === '/dashboard/tasks'
  const activeTaskScope = searchParams.get('scope') ?? 'my_all'
  const activeTaskStatus = searchParams.get('status') ?? 'all'
  const statusBadgeClass = (tone: 'all' | 'completed' | 'pending' | 'overdue', active: boolean) => {
    if (active) {
      if (tone === 'completed') return 'bg-green-100 text-green-700'
      if (tone === 'pending') return 'bg-amber-100 text-amber-700'
      if (tone === 'overdue') return 'bg-rose-100 text-rose-700'
      return 'bg-blue-100 text-blue-700'
    }
    if (tone === 'completed') return 'bg-green-600/15 text-green-700'
    if (tone === 'pending') return 'bg-amber-500/15 text-amber-700'
    if (tone === 'overdue') return 'bg-rose-500/15 text-rose-700'
    return 'bg-blue-500/15 text-blue-700'
  }
  const createdByMeTasks = sidebarTasks.filter((t) => !t.archived && t.username.toLowerCase() === user.username.toLowerCase())
  const assignedToMeTasks = sidebarTasks.filter((t) => {
    if (t.archived) return false
    const userLower = user.username.toLowerCase()
    if ((t.username || '').toLowerCase() === userLower) return false
    if ((t.assigned_to || '').toLowerCase() === userLower) return true
    const assignees = t.multi_assignment?.assignees ?? []
    return assignees.some((a) =>
      (a.username || '').toLowerCase() === userLower ||
      (Array.isArray(a.delegated_to) && a.delegated_to.some((s) => (s.username || '').toLowerCase() === userLower))
    )
  })
  const buildStatusCounts = useCallback((tasks: typeof sidebarTasks) => {
    const now = new Date()
    return {
      all: tasks.length,
      completed: tasks.filter((task) => task.completed || task.task_status === 'done').length,
      pending: tasks.filter((task) => !task.completed && task.task_status !== 'done' && !(task.due_date && new Date(task.due_date) < now)).length,
      overdue: tasks.filter((task) => !task.completed && !!task.due_date && new Date(task.due_date) < now).length,
    }
  }, [])
  const taskGroups = useMemo(
    () => ([
      {
        id: 'my_assign_task',
        label: 'My assign task',
        scope: 'created_by_me',
        counts: buildStatusCounts(createdByMeTasks),
      },
      {
        id: 'assign_to_me',
        label: 'Assign to me',
        scope: 'assigned_to_me',
        counts: buildStatusCounts(assignedToMeTasks),
      },
    ] as const),
    [buildStatusCounts, createdByMeTasks, assignedToMeTasks]
  )
  const taskPrefetchUrls = useMemo(
    () =>
      taskGroups.flatMap((group) => ([
        `/dashboard/tasks?scope=${group.scope}&status=all`,
        `/dashboard/tasks?scope=${group.scope}&status=completed`,
        `/dashboard/tasks?scope=${group.scope}&status=pending`,
        `/dashboard/tasks?scope=${group.scope}&status=overdue`,
      ])),
    [taskGroups]
  )

  useEffect(() => {
    taskPrefetchUrls.forEach((href) => {
      router.prefetch(href)
    })
  }, [router, taskPrefetchUrls])

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
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--blue-600), var(--violet-600))' }}
        >
          <ShieldCheck size={15} className="text-white" />
        </div>
        {!collapsed && (
          <div className="ml-3 min-w-0">
            <div className="font-bold text-sm leading-tight truncate" style={{ color: 'var(--color-text)', letterSpacing: '-0.01em' }}>
              CMS Portal
            </div>
            <div className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>Operations Hub</div>
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

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    title={item.label}
                    className={cn(
                      'group relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium transition-all duration-150',
                      isActive && 'text-white'
                    )}
                    style={isActive ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` } : undefined}
                  >
                    {!isActive && (
                      <span
                        className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ background: `${item.color}12` }}
                      />
                    )}
                    <span className="relative z-10" style={{ color: isActive ? 'white' : item.color }}>
                      {item.icon}
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
                          : (pathname === item.href || pathname.startsWith(item.href + '/'))

                        if (item.href === '/dashboard/tasks') {
                          return (
                            <li key={item.href} className="overflow-hidden rounded-lg">
                              <button
                                type="button"
                                onClick={() => setTasksOpen((current) => !current)}
                                className={cn(
                                  'group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
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
                                <span className="relative z-10 flex-1 truncate" style={{ color: isTaskScopeActive ? 'white' : 'var(--color-text)' }}>
                                  {item.label}
                                </span>
                                <ChevronDown size={12} className={cn('relative z-10 shrink-0 transition-transform', tasksOpen && 'rotate-180', isTaskScopeActive ? 'text-white/80' : 'text-slate-400')} />
                              </button>

                              {tasksOpen && (
                                <div className="mt-1 space-y-1 pl-4">
                                  {taskGroups.map((group) => {
                                    const groupOpen = taskGroupsOpen[group.id] ?? true
                                    const statusLinks = [
                                      { label: 'All task', status: 'all', count: group.counts.all, tone: 'all' as const },
                                      { label: 'Complete', status: 'completed', count: group.counts.completed, tone: 'completed' as const },
                                      { label: 'Pending', status: 'pending', count: group.counts.pending, tone: 'pending' as const },
                                      { label: 'Overdue', status: 'overdue', count: group.counts.overdue, tone: 'overdue' as const },
                                    ]

                                    return (
                                      <div key={group.id} className="pl-2 border-l border-slate-200">
                                        <div className="flex items-center rounded-lg transition hover:bg-slate-50">
                                          <button
                                            type="button"
                                            onClick={() => openTaskView(group.scope, 'all')}
                                            className="flex flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-sm font-semibold text-slate-700"
                                          >
                                            <span className="truncate">{group.label}</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              setTaskGroupsOpen((current) => ({ ...current, [group.id]: !groupOpen }))
                                            }}
                                            className="px-2 py-1.5"
                                          >
                                            <ChevronDown size={12} className={cn('shrink-0 text-slate-400 transition-transform', groupOpen && 'rotate-180')} />
                                          </button>
                                        </div>

                                        {groupOpen && (
                                          <ul className="mt-1 space-y-1 pl-3">
                                            {statusLinks.map((statusLink) => {
                                              const isSubActive =
                                                pathname === '/dashboard/tasks' &&
                                                activeTaskScope === group.scope &&
                                                activeTaskStatus === statusLink.status

                                              return (
                                                <li key={`${group.id}-${statusLink.status}`}>
                                                  <Link
                                                    href={`/dashboard/tasks?scope=${group.scope}&status=${statusLink.status}`}
                                                    onClick={onClose}
                                                    prefetch
                                                    scroll={false}
                                                    className={cn(
                                                      'flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition',
                                                      isSubActive
                                                        ? 'bg-slate-100 text-slate-900'
                                                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                                    )}
                                                  >
                                                    <span>{statusLink.label}</span>
                                                    <span className={cn(
                                                      'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                                      statusBadgeClass(statusLink.tone, isSubActive)
                                                    )}>
                                                      {statusLink.count}
                                                    </span>
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
                            </li>
                          )
                        }

                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={onClose}
                              className={cn(
                                'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                                isActive && 'text-white'
                              )}
                              style={isActive ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` } : undefined}
                            >
                              {!isActive && (
                                <span
                                  className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                                  style={{ background: `${item.color}12` }}
                                />
                              )}
                              <span className="relative z-10 shrink-0" style={{ color: isActive ? 'white' : item.color }}>
                                {item.icon}
                              </span>
                              <span className="relative z-10 flex-1 truncate" style={{ color: isActive ? 'white' : 'var(--color-text)' }}>
                                {item.label}
                              </span>
                              {isActive && <ChevronRight size={12} className="relative z-10 shrink-0 opacity-60" />}
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



