'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { Search, Users2, Building2, ListTodo, CircleCheckBig, Hourglass, AlertTriangle, RefreshCw, Inbox, X, PlayCircle, ChevronDown } from 'lucide-react'
import type { SessionUser } from '@/types'
import type { Todo } from '@/types'
import type { TeamMember } from '@/app/dashboard/team/actions'
import { getFreshHallQueueTodos, getTeamMembers, getTeamTodos } from '@/app/dashboard/team/actions'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/cn'
import { TaskCard } from '@/components/tasks/task-card'
import { canonicalDepartmentKey } from '@/lib/department-name'

interface Props {
  members: TeamMember[]
  tasks: Todo[]
  user?: SessionUser
}

const ROLE_GRADIENTS: Record<string, string> = {
  Admin: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
  'Super Manager': 'linear-gradient(135deg, #2B7FFF, #1A6AE4)',
  Manager: 'linear-gradient(135deg, #14B8A6, #0D9488)',
  Supervisor: 'linear-gradient(135deg, #F59E0B, #D97706)',
  User: 'linear-gradient(135deg, #64748B, #475569)',
}

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  Admin: { bg: 'rgba(139,92,246,0.12)', color: '#7C3AED' },
  'Super Manager': { bg: 'rgba(43,127,255,0.12)', color: '#1A6AE4' },
  Manager: { bg: 'rgba(20,184,166,0.12)', color: '#0D9488' },
  Supervisor: { bg: 'rgba(245,158,11,0.12)', color: '#D97706' },
  User: { bg: 'rgba(100,116,139,0.12)', color: '#475569' },
}

type TeamScope = 'users' | 'tasks_all' | 'tasks_completed' | 'tasks_in_progress' | 'tasks_pending' | 'tasks_overdue' | 'tasks_queue'
const PER_PAGE_OPTIONS = [5, 10, 15, 20, 25]

function parseTeamScope(value: string | null): TeamScope {
  switch (value) {
    case 'tasks_all':
    case 'tasks_completed':
    case 'tasks_in_progress':
    case 'tasks_pending':
    case 'tasks_overdue':
    case 'tasks_queue':
    case 'users':
      return value
    default:
      return 'users'
  }
}

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase()
}

function isTaskCompletedForUsername(task: Todo, username: string): boolean {
  const userLower = username.toLowerCase()
  const assignees = task.multi_assignment?.assignees ?? []

  const directEntry = assignees.find((entry) => (entry.username || '').toLowerCase() === userLower)
  if (directEntry) return directEntry.status === 'completed' || directEntry.status === 'accepted'

  for (const entry of assignees) {
    const delegatedEntry = Array.isArray(entry.delegated_to)
      ? entry.delegated_to.find((sub) => (sub.username || '').toLowerCase() === userLower)
      : null
    if (delegatedEntry) return delegatedEntry.status === 'completed' || delegatedEntry.status === 'accepted'
  }

  if ((task.completed_by || '').toLowerCase() === userLower) return true
  return task.completed || task.task_status === 'done'
}

function isTaskCompletedStrict(task: Todo): boolean {
  return task.completed || task.task_status === 'done' || task.workflow_state === 'final_approved'
}

export function TeamPage({ members: initialMembers, tasks: initialTasks, user }: Props) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
  const [paginationState, setPaginationState] = useState({ signature: '', page: 1 })
  const [perPage, setPerPage] = useState(5)
  const [showDeptQueueModal, setShowDeptQueueModal] = useState(false)
  const [modalDeptSearch, setModalDeptSearch] = useState('')
  const [selectedQueueDept, setSelectedQueueDept] = useState('')
  const [, startTransition] = useTransition()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scope = parseTeamScope(searchParams.get('scope'))
  const changeScope = useCallback((newScope: TeamScope) => {
    router.replace(`/dashboard/team?scope=${newScope}`, { scroll: false })
  }, [router])
  const isTaskScope = scope !== 'users'

  const currentUsername = user?.username ?? ''

  // Use cached data from React Query — served instantly on revisit within staleTime
  const { data: members = initialMembers, refetch: refetchMembers } = useQuery({
    queryKey: queryKeys.teamMembers(currentUsername),
    queryFn: () => getTeamMembers(),
    initialData: initialMembers,
    initialDataUpdatedAt: 0,   // treat SSR data as immediately stale so React Query refetches on mount
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: tasks = initialTasks, refetch: refetchTasks } = useQuery({
    queryKey: queryKeys.teamTodos(currentUsername),
    queryFn: () => getTeamTodos(),
    initialData: initialTasks,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: scope === 'tasks_queue' ? 10_000 : false,
  })

  const { data: hallQueueTasks = [], refetch: refetchHallQueueTasks } = useQuery({
    queryKey: queryKeys.teamHallQueue(currentUsername),
    queryFn: () => getFreshHallQueueTodos(),
    initialData: initialTasks.filter((task) => task.cluster_inbox === true),
    initialDataUpdatedAt: 0,
    staleTime: 0,
    gcTime: 5 * 60_000,
    enabled: scope === 'tasks_queue',
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 3_000,
  })

  const refetchAll = () => { refetchMembers(); refetchTasks(); refetchHallQueueTasks() }

  const departments = useMemo(() => {
    // Collect all dept names from members (may have old names)
    const memberDepts = members.flatMap((m) =>
      (m.department || '').split(',').map((d) => d.trim()).filter(Boolean)
    )
    // Collect all queue dept names from tasks (official names after server normalization)
    const taskDepts = tasks.filter((t) => t.queue_department).map((t) => t.queue_department!)
    // Group by canonical key; task dept names override member dept names (they're official)
    const byKey = new Map<string, string>()
    for (const d of memberDepts) {
      const key = canonicalDepartmentKey(d)
      if (key && !byKey.has(key)) byKey.set(key, d)
    }
    for (const d of taskDepts) {
      const key = canonicalDepartmentKey(d)
      if (key) byKey.set(key, d) // override with official name
    }
    return Array.from(byKey.values()).sort()
  }, [members, tasks])

  const teamMemberDeptKeys = useMemo(
    () => Array.from(new Set(
      departments.map((d) => canonicalDepartmentKey(d)).filter(Boolean)
    )),
    [departments]
  )
  const memberOptions = useMemo(() => [...new Set(members.map((member) => member.username))].sort(), [members])
  const teamMemberUsernames = useMemo(() => members.map((member) => member.username), [members])
  const taskMatchesFocusedTeam = useMemo(() => {
    const targets = memberFilter ? [memberFilter] : teamMemberUsernames
    const lowered = targets.map((username) => username.toLowerCase())
    return (task: Todo) => {
      if (lowered.includes((task.username || '').toLowerCase())) return true
      if (lowered.includes((task.assigned_to || '').toLowerCase())) return true
      if (lowered.includes((task.completed_by || '').toLowerCase())) return true
      const assignees = task.multi_assignment?.assignees ?? []
      if (assignees.some((entry) => {
        if (lowered.includes((entry.username || '').toLowerCase())) return true
        return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => lowered.includes((sub.username || '').toLowerCase()))
      })) return true
      // Also match tasks where user appears in the assignment chain (forwarded tasks)
      const chain = task.assignment_chain ?? []
      return chain.some((entry) =>
        lowered.includes((entry.user || '').toLowerCase()) ||
        lowered.includes(((entry as unknown as Record<string, unknown>).next_user as string || '').toLowerCase())
      )
    }
  }, [memberFilter, teamMemberUsernames])
  const isTaskCompletedForCurrentTeamScope = useMemo(() => {
    const targets = memberFilter ? [memberFilter] : teamMemberUsernames
    return (task: Todo) => targets.some((username) => isTaskCompletedForUsername(task, username))
  }, [memberFilter, teamMemberUsernames])

  const counts = useMemo(
    () => ({
      users: members.length,
      tasks_all: members.reduce((sum, member) => sum + member.taskStats.total, 0),
      tasks_completed: members.reduce((sum, member) => sum + member.taskStats.completed, 0),
      tasks_in_progress: tasks.filter((task) => !task.completed && task.task_status === 'in_progress').length,
      tasks_pending: members.reduce((sum, member) => sum + member.taskStats.pending, 0),
      tasks_overdue: members.reduce((sum, member) => sum + member.taskStats.overdue, 0),
      tasks_queue: scope === 'tasks_queue' ? hallQueueTasks.length : tasks.filter((task) => task.cluster_inbox === true).length,
    }),
    [hallQueueTasks.length, members, scope, tasks]
  )

  const queueByDept = useMemo(() => {
    const map: Record<string, number> = {}
    const sourceTasks = scope === 'tasks_queue' ? hallQueueTasks : tasks
    sourceTasks.forEach((task) => {
      if (task.cluster_inbox === true && task.queue_department) {
        map[task.queue_department] = (map[task.queue_department] || 0) + 1
      }
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [hallQueueTasks, scope, tasks])

  const teamMemberTaskSummary = useMemo(() => {
    const map: Record<string, { active: number; queued: number }> = {}
    tasks.forEach((task) => {
      if (!task.assigned_to || task.completed) return
      const u = task.assigned_to
      if (!map[u]) map[u] = { active: 0, queued: 0 }
      const state = (task as unknown as Record<string, unknown>).scheduler_state as string | null
      if (state === 'active') map[u].active += 1
      else if (state === 'user_queue' || state === 'paused' || state === 'blocked') map[u].queued += 1
    })
    return map
  }, [tasks])

  const filteredModalDepts = useMemo(() => {
    if (!modalDeptSearch.trim()) return queueByDept
    const q = modalDeptSearch.toLowerCase()
    return queueByDept.filter(([dept]) => dept.toLowerCase().includes(q))
  }, [queueByDept, modalDeptSearch])


  const filtered = useMemo(() => {
    let list = members

    if (deptFilter) list = list.filter((member) => {
      const depts = (member.department || '').split(',').map((d) => d.trim())
      return depts.some((d) => canonicalDepartmentKey(d) === canonicalDepartmentKey(deptFilter))
    })
    if (memberFilter) list = list.filter((member) => member.username === memberFilter)

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (member) =>
          member.username.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q)
      )
    }

    if (scope === 'tasks_all') return list.filter((member) => member.taskStats.total > 0)
    if (scope === 'tasks_completed') return list.filter((member) => member.taskStats.completed > 0)
    if (scope === 'tasks_in_progress') return list.filter((member) => member.taskStats.in_progress > 0)
    if (scope === 'tasks_pending') return list.filter((member) => member.taskStats.pending > 0)
    if (scope === 'tasks_overdue') return list.filter((member) => member.taskStats.overdue > 0)
    // Hall Queue: show all members (inbox tasks are unassigned — no member filter)
    if (scope === 'tasks_queue') return list

    return list
  }, [members, search, deptFilter, memberFilter, scope])

  const filteredTasks = useMemo(() => {
    // Hall Queue shows all cluster_inbox tasks regardless of team membership (they are unassigned)
    let list = scope === 'tasks_queue'
      ? hallQueueTasks.filter((task) => task.cluster_inbox === true)
      : tasks.filter((task) => taskMatchesFocusedTeam(task))
    const searchQuery = search.trim().toLowerCase()
    const today = new Date()

    if (deptFilter) {
      const filterKey = canonicalDepartmentKey(deptFilter)
      if (scope === 'tasks_queue') {
        list = list.filter((task) => canonicalDepartmentKey(task.queue_department || '') === filterKey)
      } else {
        list = list.filter((task) => {
          // creator_department and category can be comma-separated — split and check each
          const creatorDepts = (task.creator_department || '').split(',').map((d) => d.trim()).filter(Boolean)
          const categoryDepts = (task.category || '').split(',').map((d) => d.trim()).filter(Boolean)
          const assigneeDepts = (task.assignee_department || '').split(',').map((d) => d.trim()).filter(Boolean)
          return (
            creatorDepts.some((d) => canonicalDepartmentKey(d) === filterKey) ||
            categoryDepts.some((d) => canonicalDepartmentKey(d) === filterKey) ||
            assigneeDepts.some((d) => canonicalDepartmentKey(d) === filterKey)
          )
        })
      }
    }

    // For Hall Queue, inbox tasks are unassigned — skip member filter so they stay visible
    if (memberFilter && scope !== 'tasks_queue') {
      const memberLower = memberFilter.toLowerCase()
      list = list.filter((task) => {
        if ((task.username || '').toLowerCase() === memberLower) return true
        if ((task.assigned_to || '').toLowerCase() === memberLower) return true
        if ((task.completed_by || '').toLowerCase() === memberLower) return true
        const assignees = task.multi_assignment?.assignees ?? []
        return assignees.some((entry) => {
          if ((entry.username || '').toLowerCase() === memberLower) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === memberLower)
        })
      })
    }

    if (searchQuery) {
      list = list.filter((task) => {
        if (task.title.toLowerCase().includes(searchQuery)) return true
        if ((task.username || '').toLowerCase().includes(searchQuery)) return true
        if ((task.assigned_to || '').toLowerCase().includes(searchQuery)) return true
        if ((task.completed_by || '').toLowerCase().includes(searchQuery)) return true
        if ((task.app_name || '').toLowerCase().includes(searchQuery)) return true
        if ((task.package_name || '').toLowerCase().includes(searchQuery)) return true
        // Also check multi-assignment assignee names
        const assignees = task.multi_assignment?.assignees ?? []
        return assignees.some((entry) => {
          if ((entry.username || '').toLowerCase().includes(searchQuery)) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase().includes(searchQuery))
        })
      })
    }

    if (scope === 'tasks_completed') {
      list = list.filter((task) => isTaskCompletedStrict(task))
    } else if (scope === 'tasks_in_progress') {
      list = list.filter((task) => !isTaskCompletedStrict(task) && task.task_status === 'in_progress')
    } else if (scope === 'tasks_pending') {
      list = list.filter((task) => {
        if (isTaskCompletedStrict(task)) return false
        if (task.task_status === 'in_progress') return false
        if (task.due_date && new Date(task.due_date) < today) return false
        return true
      })
    } else if (scope === 'tasks_overdue') {
      list = list.filter((task) => !isTaskCompletedStrict(task) && !!task.due_date && new Date(task.due_date) < today)
    } else if (scope === 'tasks_queue') {
      list = list.filter((task) => task.cluster_inbox === true)
    }

    return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [tasks, hallQueueTasks, search, deptFilter, memberFilter, scope, taskMatchesFocusedTeam, isTaskCompletedForCurrentTeamScope])

  const taskPaginationSignature = `${scope}|${search}|${deptFilter}|${memberFilter}|${perPage}`
  const urlPage = (() => {
    const raw = Number(searchParams.get('page') || '1')
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1
  })()
  const currentTaskPage = paginationState.signature === taskPaginationSignature ? paginationState.page : urlPage
  const totalTaskPages = Math.max(1, Math.ceil(filteredTasks.length / perPage))
  const visibleTaskPage = Math.min(currentTaskPage, totalTaskPages)
  const paginatedTasks = useMemo(() => {
    const start = (visibleTaskPage - 1) * perPage
    return filteredTasks.slice(start, start + perPage)
  }, [filteredTasks, visibleTaskPage, perPage])

  useEffect(() => {
    const focusTaskId = searchParams.get('focus')
    if (!focusTaskId) return
    const taskEl = document.querySelector(`[data-task-id="${focusTaskId}"]`) as HTMLElement | null
    if (!taskEl) return
    taskEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [searchParams, paginatedTasks])

  const taskKpis = useMemo(() => {
    const today = new Date()
    const searchQuery = search.trim().toLowerCase()
    let relevantTasks = tasks.filter((task) => taskMatchesFocusedTeam(task))
    // Apply the same member filter as filteredTasks
    if (memberFilter && scope !== 'tasks_queue') {
      const memberLower = memberFilter.toLowerCase()
      relevantTasks = relevantTasks.filter((task) => {
        if ((task.username || '').toLowerCase() === memberLower) return true
        if ((task.assigned_to || '').toLowerCase() === memberLower) return true
        if ((task.completed_by || '').toLowerCase() === memberLower) return true
        const assignees = task.multi_assignment?.assignees ?? []
        return assignees.some((entry) => {
          if ((entry.username || '').toLowerCase() === memberLower) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === memberLower)
        })
      })
    }
    // Apply the same text search as filteredTasks so KPI numbers match the visible count
    if (searchQuery) {
      relevantTasks = relevantTasks.filter((task) => {
        if (task.title.toLowerCase().includes(searchQuery)) return true
        if ((task.username || '').toLowerCase().includes(searchQuery)) return true
        if ((task.assigned_to || '').toLowerCase().includes(searchQuery)) return true
        if ((task.completed_by || '').toLowerCase().includes(searchQuery)) return true
        if ((task.app_name || '').toLowerCase().includes(searchQuery)) return true
        if ((task.package_name || '').toLowerCase().includes(searchQuery)) return true
        const assignees = task.multi_assignment?.assignees ?? []
        return assignees.some((entry) => {
          if ((entry.username || '').toLowerCase().includes(searchQuery)) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase().includes(searchQuery))
        })
      })
    }
    return {
      total: relevantTasks.length,
      completed: relevantTasks.filter((task) => isTaskCompletedStrict(task)).length,
      in_progress: relevantTasks.filter((task) => !isTaskCompletedStrict(task) && task.task_status === 'in_progress').length,
      pending: relevantTasks.filter((task) => {
        if (isTaskCompletedStrict(task)) return false
        if (task.task_status === 'in_progress') return false
        if (task.due_date && new Date(task.due_date) < today) return false
        return true
      }).length,
      overdue: relevantTasks.filter((task) => !isTaskCompletedStrict(task) && !!task.due_date && new Date(task.due_date) < today).length,
      queue: scope === 'tasks_queue' ? hallQueueTasks.length : tasks.filter((task) => task.cluster_inbox === true).length,
    }
  }, [hallQueueTasks.length, memberFilter, scope, search, taskMatchesFocusedTeam, tasks])

  const scopeLabel = useMemo(() => {
    if (scope === 'tasks_all') return 'Task'
    if (scope === 'tasks_completed') return 'Completed Task'
    if (scope === 'tasks_in_progress') return 'In Progress Task'
    if (scope === 'tasks_pending') return 'Pending Task'
    if (scope === 'tasks_overdue') return 'Overdue Task'
    if (scope === 'tasks_queue') return 'Queue Task'
    return 'User'
  }, [scope])

  return (
    <div>
      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>Team</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {isTaskScope ? `${scopeLabel}: ${filteredTasks.length} tasks` : `${scopeLabel}: ${filtered.length} of ${counts.users} members`}
            </p>
          </div>
        </div>

        {isTaskScope && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { key: 'tasks_all', label: 'Total Task', value: taskKpis.total, icon: ListTodo, tone: 'text-[#2B7FFF]', bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]' },
              { key: 'tasks_completed', label: 'Completed Task', value: taskKpis.completed, icon: CircleCheckBig, tone: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]' },
              { key: 'tasks_in_progress', label: 'In Progress', value: taskKpis.in_progress, icon: PlayCircle, tone: 'text-[#0891B2]', bg: 'bg-[#ECFEFF]', border: 'border-[#A5F3FC]' },
              { key: 'tasks_pending', label: 'Pending', value: taskKpis.pending, icon: Hourglass, tone: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', border: 'border-[#FDE68A]' },
              { key: 'tasks_overdue', label: 'Overdue', value: taskKpis.overdue, icon: AlertTriangle, tone: 'text-[#E11D48]', bg: 'bg-[#FFF1F2]', border: 'border-[#FECDD3]' },
              { key: 'tasks_queue', label: 'Hall Queue', value: taskKpis.queue, icon: Inbox, tone: 'text-[#F97316]', bg: 'bg-[#FFF7ED]', border: 'border-[#FED7AA]' },
            ].map((item) => {
              const Icon = item.icon
              const isActive = scope === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => changeScope(item.key as TeamScope)}
                  className={cn(
                    'rounded-[18px] border bg-white px-4 py-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.09)]',
                    isActive && 'border-[#3559d8] bg-[#f8fbff] shadow-[inset_0_0_0_1px_rgba(53,89,216,0.24),0_12px_24px_rgba(15,23,42,0.08)]'
                  )}
                  style={{ borderColor: isActive ? '#3559d8' : 'var(--color-border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border', item.bg, item.border)}>
                      <Icon size={18} className={item.tone} />
                    </div>
                    <div className="text-right">
                      <div className={cn('text-[28px] font-extrabold leading-none', item.tone)}>{item.value}</div>
                      <div className="mt-1 text-[11px] font-semibold text-slate-500">{item.label}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="card mb-6 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-45 flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                placeholder="Search members..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
                style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              />
            </div>
            <select
              value={deptFilter}
              onChange={(event) => setDeptFilter(event.target.value)}
              className="h-10 min-w-35 flex-1 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">All Departments</option>
              {departments.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </select>
            <select
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
              className="h-10 min-w-32 flex-1 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">All Team Members</option>
              {memberOptions.map((member) => (
                <option key={member} value={member}>{member}</option>
              ))}
            </select>
            {!isTaskScope && (
              <button
                type="button"
                onClick={() => startTransition(() => refetchAll())}
                className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            )}
            {scope === 'tasks_queue' && (
              <button
                onClick={() => {
                  setModalDeptSearch('')
                  setSelectedQueueDept('')
                  setShowDeptQueueModal(true)
                }}
                className="flex h-10 items-center gap-2 rounded-lg border border-[#0ea5e9] bg-[#f0f9ff] px-4 text-sm font-semibold text-[#0284c7] transition-all hover:bg-[#e0f2fe]"
              >
                <Inbox size={15} />
                Dept Queue
              </button>
            )}
          </div>
        </div>

        {showDeptQueueModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between bg-[#0EA5E9] p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center rounded-lg bg-white/20 p-2">
                    <Building2 size={20} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold leading-tight">Select Department</h2>
                    <p className="text-xs font-medium text-white/80">View queued tasks and assign</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDeptQueueModal(false)}
                  className="rounded-lg bg-white/10 p-1.5 transition-colors hover:bg-white/20"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col overflow-hidden p-5">
                <h3 className="mb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">Search</h3>
                <div className="relative mb-5">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={modalDeptSearch}
                    onChange={(e) => setModalDeptSearch(e.target.value)}
                    placeholder="Type to search..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition-colors focus:border-[#0EA5E9] focus:ring-2 focus:ring-[#0EA5E9]/10"
                  />
                </div>

                <div className="flex-1 overflow-y-auto pr-2" style={{ maxHeight: '35vh' }}>
                  {filteredModalDepts.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                      No departments found in queue.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredModalDepts.map(([dept, count]) => {
                        const isSelected = selectedQueueDept === dept
                        return (
                          <div
                            key={dept}
                            onClick={() => setSelectedQueueDept(dept)}
                            className={cn(
                              'flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-all hover:bg-slate-50',
                              isSelected ? 'border-[#0EA5E9] bg-[#f0f9ff]' : 'border-slate-200'
                            )}
                          >
                            <label className="flex cursor-pointer items-center gap-3">
                              <div className="flex items-center justify-center h-4 w-4 rounded-full border border-slate-300 bg-white">
                                {isSelected && <div className="h-2 w-2 rounded-full bg-[#0EA5E9]" />}
                              </div>
                              <span className="text-sm font-semibold text-slate-700">{dept}</span>
                            </label>
                            <span className="rounded-full bg-[#0EA5E9] px-2.5 py-0.5 text-[11px] font-bold text-white">
                              {count} queued
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/50 p-4">
                <button
                  type="button"
                  onClick={() => setShowDeptQueueModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedQueueDept}
                  onClick={() => {
                    setDeptFilter(selectedQueueDept)
                    changeScope('tasks_queue')
                    setShowDeptQueueModal(false)
                  }}
                  className="rounded-xl bg-[#0EA5E9] px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#0284c7] disabled:opacity-50"
                >
                  Open Queue
                </button>
              </div>
            </div>
          </div>
        )}

        {isTaskScope ? (
          filteredTasks.length === 0 ? (
            <div className="card p-12 text-center">
              <ListTodo size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No team tasks found</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[22px] border border-[#d9e2f0] bg-white shadow-[0_18px_50px_rgba(31,65,132,0.08)]">
              <div className="bg-[#f5f7fc] px-4 py-4 sm:px-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                    <button
                      type="button"
                      onClick={() => startTransition(() => router.refresh())}
                      className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                    >
                      <RefreshCw size={13} />
                      Refresh
                    </button>
                    <span className="min-w-fit text-[11px] font-medium text-slate-400">{filteredTasks.length} tasks</span>
                  </div>

                  {filteredTasks.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#dfe5f1] bg-white px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Rows per page:</span>
                        <div className="relative">
                          <select
                            value={perPage}
                            onChange={(e) => setPerPage(Number(e.target.value))}
                            className="appearance-none rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-6 text-xs font-semibold text-slate-700 outline-none cursor-pointer hover:border-slate-300"
                          >
                            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                        <span className="text-xs text-slate-400">
                          Showing {filteredTasks.length === 0 ? 0 : (visibleTaskPage - 1) * perPage + 1}–{Math.min(visibleTaskPage * perPage, filteredTasks.length)} of {filteredTasks.length}
                        </span>
                      </div>
                      {totalTaskPages > 1 && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPaginationState({ signature: taskPaginationSignature, page: Math.max(1, visibleTaskPage - 1) })}
                            disabled={visibleTaskPage === 1}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Previous
                          </button>
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            Page {visibleTaskPage} / {totalTaskPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setPaginationState({ signature: taskPaginationSignature, page: Math.min(totalTaskPages, visibleTaskPage + 1) })}
                            disabled={visibleTaskPage === totalTaskPages}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {paginatedTasks.map((task) => (
                    <div key={task.id} data-task-id={task.id}>
                      <TaskCard
                        task={task}
                        currentUsername={user?.username ?? ''}
                        currentUserRole={user?.role}
                        currentUserDept={user?.department ?? null}
                        currentUserTeamMembers={user?.teamMembers ?? []}
                        currentUserTeamMemberDeptKeys={teamMemberDeptKeys}
                        teamMemberTaskSummary={teamMemberTaskSummary}
                        enableQueueAssign
                        onEdit={(nextTask) => {
                          sessionStorage.setItem('task-detail-back', `/dashboard/team?scope=${scope}&page=${visibleTaskPage}&focus=${nextTask.id}`)
                          router.push(`/dashboard/tasks/${nextTask.id}`)
                        }}
                        onViewDetail={(nextTask) => {
                          const backTo = `/dashboard/team?scope=${scope}&page=${visibleTaskPage}&focus=${nextTask.id}`
                          window.open(`/dashboard/tasks/${nextTask.id}?from=${encodeURIComponent(backTo)}`, '_blank', 'noopener,noreferrer')
                        }}
                        onShare={() => undefined}
                        onRefresh={() => router.refresh()}
                      />
                    </div>
                  ))}

                  {totalTaskPages > 1 && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfe5f1] bg-white px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Rows per page:</span>
                        <div className="relative">
                          <select
                            value={perPage}
                            onChange={(e) => setPerPage(Number(e.target.value))}
                            className="appearance-none rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-6 text-xs font-semibold text-slate-700 outline-none cursor-pointer hover:border-slate-300"
                          >
                            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                        <span className="text-sm text-slate-500">
                          Showing {(visibleTaskPage - 1) * perPage + 1}–{Math.min(visibleTaskPage * perPage, filteredTasks.length)} of {filteredTasks.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPaginationState({ signature: taskPaginationSignature, page: Math.max(1, visibleTaskPage - 1) })}
                          disabled={visibleTaskPage === 1}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                          Page {visibleTaskPage} / {totalTaskPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPaginationState({ signature: taskPaginationSignature, page: Math.min(totalTaskPages, visibleTaskPage + 1) })}
                          disabled={visibleTaskPage === totalTaskPages}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <Users2 size={40} className="mx-auto mb-3" style={{ color: 'var(--slate-300)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No team members found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((member) => {
              const gradient = ROLE_GRADIENTS[member.role] ?? ROLE_GRADIENTS.User
              const roleBadge = ROLE_COLORS[member.role] ?? ROLE_COLORS.User
              const completion = member.taskStats.total > 0
                ? Math.round((member.taskStats.completed / member.taskStats.total) * 100)
                : 0
              const completionColor = completion >= 80 ? '#10B981' : completion >= 50 ? '#F59E0B' : '#EF4444'

              return (
                <div
                  key={member.username}
                  onClick={() => {
                    setMemberFilter(member.username)
                    changeScope('tasks_all')
                  }}
                  className="animate-fade-in cursor-pointer rounded-2xl p-6 text-center transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 8px 20px rgba(15,23,42,0.06)',
                  }}
                >
                  <div
                    className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
                    style={{ background: gradient }}
                  >
                    {member.avatar_data ? (
                      <Image src={member.avatar_data} alt={member.username} width={48} height={48} className="h-full w-full rounded-full object-cover" unoptimized />
                    ) : (
                      getInitials(member.username)
                    )}
                  </div>

                  <h3 className="mb-0.5 truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                    {member.username}
                  </h3>
                  <p className="mb-2 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {member.email}
                  </p>

                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-center gap-1">
                      <Building2 size={11} style={{ color: roleBadge.color }} />
                      <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                        {member.department || 'No dept'}
                      </span>
                    </div>
                    <span
                      className="inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold"
                      style={{ background: roleBadge.bg, color: roleBadge.color }}
                    >
                      {member.role}
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        Task completion
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: completionColor }}>
                        {completion}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--slate-100)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${completion}%`, background: completionColor }}
                      />
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-3 gap-2">
                    <StatPill label="Done" value={member.taskStats.completed} color="#10B981" bg="rgba(16,185,129,0.1)" />
                    <StatPill label="Open" value={member.taskStats.pending} color="#2B7FFF" bg="rgba(43,127,255,0.1)" />
                    <StatPill label="Overdue" value={member.taskStats.overdue} color="#EF4444" bg="rgba(239,68,68,0.1)" />
                  </div>

                  <div className="flex items-center justify-center gap-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span>
                      {member.last_login
                        ? `Last seen ${new Date(member.last_login).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`
                        : 'No activity yet'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatPill({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-lg px-1.5 py-2 text-center" style={{ background: bg }}>
      <p className="text-xs font-bold" style={{ color }}>{value}</p>
      <p className="mt-1 text-[8px] font-semibold" style={{ color }}>{label}</p>
    </div>
  )
}
