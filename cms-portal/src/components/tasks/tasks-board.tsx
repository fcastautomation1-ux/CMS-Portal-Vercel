'use client'

import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition, useCallback, useMemo, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  Trash2,
  Archive,
  Loader2,
  Inbox,
  ArrowDownUp,
  SlidersHorizontal,
  Upload,
  ListTodo,
  CircleCheckBig,
  Hourglass,
  AlertTriangle,
  MessageCircle,
  Eye,
  Edit3,
  Copy,
  Calendar,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { splitTaskMeta } from '@/lib/task-metadata'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'
import type { Todo, TaskStatus, MultiAssignmentEntry, MultiAssignmentSubEntry } from '@/types'
import { TaskCard } from './task-card'
import {
  getTodos,
  deleteTodoAction,
  archiveTodoAction,
  getMyOverdueApprovalsAction,
  getPackagesForTaskForm,
  getUsersForAssignment,
  getDepartmentsForTaskForm,
  duplicateTodoAction,
} from '@/app/dashboard/tasks/actions'

const CreateTaskModal = dynamic(
  () => import('./create-task-modal').then((mod) => mod.CreateTaskModal),
  { ssr: false }
)

type ViewMode = 'list' | 'kanban' | 'calendar'
type QuickFilter = 'my_all' | 'created_by_me' | 'assigned_to_me' | 'my_pending' | 'assigned_by_me' | 'my_approval' | 'other_approval'

type StatusFilter =
  | 'all' | 'pending' | 'completed' | 'overdue' | 'queue'

function parseQuickFilter(value: string | null): QuickFilter | null {
  if (
    value === 'my_all' ||
    value === 'created_by_me' ||
    value === 'assigned_to_me' ||
    value === 'my_pending' ||
    value === 'assigned_by_me' ||
    value === 'my_approval' ||
    value === 'other_approval'
  ) {
    return value
  }
  return null
}

function parseStatusFilter(value: string | null): StatusFilter | null {
  if (
    value === 'all' ||
    value === 'pending' ||
    value === 'completed' ||
    value === 'overdue' ||
    value === 'queue'
  ) {
    return value
  }
  return null
}

const KANBAN_COLUMNS: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'backlog', label: 'Backlog', dot: 'bg-slate-400' },
  { key: 'todo', label: 'To Do', dot: 'bg-yellow-400' },
  { key: 'in_progress', label: 'In Progress', dot: 'bg-blue-500' },
  { key: 'done', label: 'Done', dot: 'bg-green-500' },
]
const TASKS_PER_PAGE = 20

interface TasksBoardProps {
  currentUsername: string
  currentUserRole?: string
  currentUserDept?: string | null
  currentUserTeamMembers?: string[]
  initialTasks: Todo[]
  initialScope?: QuickFilter
  initialStatus?: StatusFilter
}

export function TasksBoard({ currentUsername, currentUserRole, currentUserDept, currentUserTeamMembers, initialTasks, initialScope = 'assigned_to_me', initialStatus = 'all' }: TasksBoardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()
  const refreshTimerRef = useRef<number | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'position' | 'due_date' | 'priority' | 'created_at' | 'title'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [showCreate, setShowCreate] = useState(false)
  const [addTaskPending, setAddTaskPending] = useState(false)
  const [editTask, setEditTask] = useState<Todo | null>(null)
  const [, setShareTask] = useState<Todo | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkMenu, setShowBulkMenu] = useState(false)
  const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false)
  const [pendingScopeSwitch, setPendingScopeSwitch] = useState<string | null>(null)
  const [paginationState, setPaginationState] = useState({ signature: '', page: 1 })

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(currentUsername),
    queryFn: () => getTodos().catch(() => [] as Todo[]),
    initialData: initialTasks,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const overdueApprovalsQuery = useQuery({
    queryKey: ['task-overdue-approvals', currentUsername],
    queryFn: () => getMyOverdueApprovalsAction().catch(() => [] as Array<{ id: string; title: string; approval_sla_due_at: string | null }>),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const taskFormDataQuery = useQuery({
    queryKey: ['task-form-data'],
    queryFn: async () => {
      const [packages, users, departments] = await Promise.all([
        getPackagesForTaskForm(),
        getUsersForAssignment(),
        getDepartmentsForTaskForm(),
      ])
      return {
        packages: packages ?? [],
        users: users ?? [],
        departments: departments ?? [],
      }
    },
    enabled: showCreate || Boolean(editTask),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const tasks = tasksQuery.data ?? initialTasks
  const overdueApprovals = overdueApprovalsQuery.data ?? []
  const effectiveUser = currentUsername
  const quickFilter = parseQuickFilter(searchParams.get('scope')) ?? initialScope
  const statusFilter = parseStatusFilter(searchParams.get('status')) ?? initialStatus

  const isTaskAssignedToUser = useCallback((task: Todo, username: string) => {
    const userLower = username.toLowerCase()
    if ((task.assigned_to || '').toLowerCase() === userLower) return true
    const assignees = task.multi_assignment?.assignees ?? []
    return assignees.some((a: MultiAssignmentEntry) =>
      (a.username || '').toLowerCase() === userLower ||
      (Array.isArray(a.delegated_to) && a.delegated_to.some((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() === userLower))
    )
  }, [])

  const isTaskAssignedByOthersToUser = useCallback((task: Todo, username: string) => {
    const userLower = username.toLowerCase()
    if ((task.username || '').toLowerCase() === userLower) return false
    return isTaskAssignedToUser(task, username)
  }, [isTaskAssignedToUser])

  // \u2500\u2500 Active KPI (computed from filter state \u2014 syncs all filters) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const activeKpi = useMemo(() => {
    if (statusFilter === 'all') return 'total'
    if (statusFilter === 'completed') return 'completed'
    if (statusFilter === 'pending') return 'pending'
    if (statusFilter === 'overdue') return 'overdue'
    return ''
  }, [statusFilter])

  const applyKpiFilter = useCallback((key: string) => {
    setSearch('')
    let nextStatus: StatusFilter = 'all'

    if (key === 'completed') {
      nextStatus = 'completed'
    } else if (key === 'pending') {
      nextStatus = 'pending'
    } else if (key === 'overdue') {
      nextStatus = 'overdue'
    }

    router.replace(`/dashboard/tasks?scope=${quickFilter}&status=${nextStatus}`, { scroll: false })
  }, [quickFilter, router])

  const refresh = useCallback(async () => {
    setLoading(true)
    const [ft, overdue] = await Promise.all([
      getTodos().catch(() => [] as Todo[]),
      getMyOverdueApprovalsAction().catch(() => [] as Array<{ id: string; title: string; approval_sla_due_at: string | null }>),
    ])
    queryClient.setQueryData(queryKeys.tasks(currentUsername), ft)
    queryClient.setQueryData(['task-overdue-approvals', currentUsername], overdue)
    setLoading(false)
    setSelected(new Set())
  }, [currentUsername, queryClient])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        void refresh()
      }, 250)
    }

    const unsubscribe = subscribeToPostgresChanges(
      `tasks-board:${currentUsername}`,
      [
        { table: 'todos' },
        { table: 'todo_shares', filter: `shared_with=eq.${currentUsername}` },
      ],
      scheduleRefresh
    )

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      unsubscribe()
    }
  }, [currentUsername, refresh])

  const isQueuedTaskForDepartmentUser = useCallback((task: Todo, username: string) => {
    if (username.toLowerCase() != currentUsername.toLowerCase()) return false
    if (task.queue_status !== 'queued') return false
    if (task.assigned_to && task.assigned_to.trim() !== '') return false
    const rawDept = currentUserDept ?? null
    if (!rawDept) return false
    const queueDeptKey = canonicalDepartmentKey(task.queue_department || '')
    if (!queueDeptKey) return false
    return splitDepartmentsCsv(rawDept)
      .map((d: string) => canonicalDepartmentKey(d))
      .some((d: string) => !!d && d === queueDeptKey)
  }, [currentUserDept, currentUsername])

  const matchesPersonalScope = useCallback((task: Todo, scope: QuickFilter, username: string) => {
    const userLower = username.toLowerCase()
    if (task.archived) return false
    if (scope === 'created_by_me') return task.username.toLowerCase() === userLower
    if (scope === 'assigned_to_me') return isTaskAssignedByOthersToUser(task, username) || isQueuedTaskForDepartmentUser(task, username)
    return (
      task.username.toLowerCase() === userLower ||
      (task.completed_by || '').toLowerCase() === userLower ||
      isTaskAssignedToUser(task, username) ||
      isQueuedTaskForDepartmentUser(task, username)
    )
  }, [isQueuedTaskForDepartmentUser, isTaskAssignedByOthersToUser, isTaskAssignedToUser])

  const scopedTasksForKpis = useMemo(
    () => tasks.filter((task) => matchesPersonalScope(task, quickFilter, effectiveUser)),
    [tasks, matchesPersonalScope, quickFilter, effectiveUser]
  )

  const scopedKpiStats = useMemo(() => {
    const now = new Date()
    const completed = scopedTasksForKpis.filter((task) => task.completed || task.task_status === 'done').length
    const overdue = scopedTasksForKpis.filter((task) => !task.completed && !!task.due_date && new Date(task.due_date) < now).length
    const pending = scopedTasksForKpis.filter((task) => {
      if (task.completed || task.task_status === 'done') return false
      if (task.due_date && new Date(task.due_date) < now) return false
      return true
    }).length

    // Queue: regular users see dept queue, managers see team member queues
    const queue = tasks.filter((task) => {
      if (task.queue_status !== 'queued') return false
      if (!task.queue_department) return false
      // Regular user: task in their department
      const userDepts = splitDepartmentsCsv(currentUserDept || '')
      const taskDepts = splitDepartmentsCsv(task.queue_department)
      if (userDepts.length > 0 && taskDepts.some((td) => userDepts.some((ud) => canonicalDepartmentKey(ud) === canonicalDepartmentKey(td)))) return true
      // Manager/Supervisor: can also see queues of their team members' departments
      if (currentUserRole === 'Manager' || currentUserRole === 'Supervisor') {
        return true // Managers/supervisors can see all queues in their scope
      }
      return false
    }).length

    return {
      total: scopedTasksForKpis.length,
      completed,
      pending,
      overdue,
      queue,
    }
  }, [scopedTasksForKpis, tasks, currentUserDept, currentUserRole])

  const scopeLabel = useMemo(() => {
    if (quickFilter === 'created_by_me') return 'My Created task'
    if (quickFilter === 'assigned_to_me') return 'Assign to me tasks'
    return 'My Tasks'
  }, [quickFilter])

  const dropdownScopeCounts = useMemo(() => ({
    created_by_me: tasks.filter((t) => matchesPersonalScope(t, 'created_by_me', effectiveUser)).length,
    assigned_to_me: tasks.filter((t) => matchesPersonalScope(t, 'assigned_to_me', effectiveUser)).length,
  }), [tasks, matchesPersonalScope, effectiveUser])

  const filteredTasks = useMemo(() => {
    const now = new Date()
    let list = [...tasks]
    const userLower = effectiveUser.toLowerCase()

    if (quickFilter === 'created_by_me') {
      list = list.filter((t) => !t.archived && t.username.toLowerCase() === userLower)
    } else if (quickFilter === 'assigned_to_me') {
      list = list.filter((t) => !t.archived && (isTaskAssignedByOthersToUser(t, effectiveUser) || isQueuedTaskForDepartmentUser(t, effectiveUser)))
    } else if (quickFilter === 'my_pending') {
      list = list.filter((t) => {
        if (t.completed || t.archived) return false
        if (isTaskAssignedToUser(t, effectiveUser)) return true
        if (t.username.toLowerCase() === userLower && (!t.assigned_to || (t.assigned_to || '').toLowerCase() === userLower)) return true
        const ma = t.multi_assignment
        if (ma?.enabled && Array.isArray(ma.assignees)) {
          const top = ma.assignees.find((a: MultiAssignmentEntry) => (a.username || '').toLowerCase() === userLower)
          if (top && top.status !== 'accepted' && top.status !== 'completed') return true
          for (const assignee of ma.assignees) {
            if (Array.isArray(assignee.delegated_to)) {
              const sub = assignee.delegated_to.find((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() === userLower)
              if (sub && sub.status !== 'accepted' && sub.status !== 'completed') return true
            }
          }
        }
        return isQueuedTaskForDepartmentUser(t, effectiveUser)
      })
    } else if (quickFilter === 'my_all') {
      list = list.filter((t) => {
        if (t.archived) return false
        if (isTaskAssignedToUser(t, effectiveUser)) return true
        if ((t.completed_by || '').toLowerCase() === userLower) return true
        if (t.username.toLowerCase() === userLower) return true
        return isQueuedTaskForDepartmentUser(t, effectiveUser)
      })
    } else if (quickFilter === 'assigned_by_me') {
      list = list.filter((t) => {
        if (t.completed || t.archived) return false
        if (t.username.toLowerCase() !== userLower) return false
        if (t.assigned_to && (t.assigned_to || '').toLowerCase() !== userLower) return true
        const ma = t.multi_assignment
        if (ma?.enabled && Array.isArray(ma.assignees)) {
          return ma.assignees.some((a: MultiAssignmentEntry) =>
            (a.username || '').toLowerCase() !== userLower ||
            (Array.isArray(a.delegated_to) && a.delegated_to.some((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() !== userLower))
          )
        }
        return false
      })
    } else if (quickFilter === 'my_approval') {
      list = list.filter((t) => {
        if (t.archived || t.approval_status !== 'pending_approval') return false
        const pendingApprover = (t.pending_approver || '').toLowerCase()
        if (pendingApprover) return pendingApprover === userLower
        return t.username.toLowerCase() === userLower
      })
    } else if (quickFilter === 'other_approval') {
      list = list.filter((t) => {
        if (t.archived || t.approval_status !== 'pending_approval') return false
        if (t.username.toLowerCase() === userLower) return false
        if ((t.completed_by || '').toLowerCase() === userLower) return true
        if ((t.assigned_to || '').toLowerCase() === userLower) return true
        const ma = t.multi_assignment
        if (ma?.enabled && Array.isArray(ma.assignees)) {
          if (ma.assignees.some((a: MultiAssignmentEntry) => (a.username || '').toLowerCase() === userLower)) return true
          if (ma.assignees.some((a: MultiAssignmentEntry) => Array.isArray(a.delegated_to) && a.delegated_to.some((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() === userLower))) return true
        }
        return false
      })
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        splitTaskMeta(t.package_name).some((value) => value.toLowerCase().includes(q)) ||
        splitTaskMeta(t.app_name).some((value) => value.toLowerCase().includes(q)) ||
        t.assigned_to?.toLowerCase().includes(q) ||
        t.username.toLowerCase().includes(q)
      )
    }

    if (statusFilter !== 'all') {
      list = list.filter((t) => {
        if (statusFilter === 'pending') return !t.completed && t.task_status !== 'done' && !(t.due_date && new Date(t.due_date) < now) && !t.archived
        if (statusFilter === 'completed') return t.completed || t.task_status === 'done'
        if (statusFilter === 'overdue') return !t.completed && !!t.due_date && new Date(t.due_date) < now
        if (statusFilter === 'queue') {
          if (t.queue_status !== 'queued' || !t.queue_department) return false
          // Regular user: task in their department
          const userDepts = splitDepartmentsCsv(currentUserDept || '')
          const taskDepts = splitDepartmentsCsv(t.queue_department)
          if (userDepts.length > 0 && taskDepts.some((td) => userDepts.some((ud) => canonicalDepartmentKey(ud) === canonicalDepartmentKey(td)))) return true
          // Manager/Supervisor: can see and assign all queues
          if (currentUserRole === 'Manager' || currentUserRole === 'Supervisor') return true
          return false
        }
        return true
      })
    }

    list.sort((a, b) => {
      const aCompleted = a.completed ? 1 : 0
      const bCompleted = b.completed ? 1 : 0
      if (aCompleted !== bCompleted) return aCompleted - bCompleted
      let va: string | number = 0
      let vb: string | number = 0
      if (sortBy === 'position') {
        va = a.position || 0
        vb = b.position || 0
      } else if (sortBy === 'due_date') {
        va = a.due_date ? new Date(a.due_date).getTime() : 0
        vb = b.due_date ? new Date(b.due_date).getTime() : 0
      } else if (sortBy === 'priority') {
        const order = { urgent: 4, high: 3, medium: 2, low: 1 } as Record<string, number>
        va = order[a.priority] ?? 0
        vb = order[b.priority] ?? 0
      } else if (sortBy === 'title') {
        va = a.title.toLowerCase()
        vb = b.title.toLowerCase()
      } else {
        va = new Date(a.created_at).getTime()
        vb = new Date(b.created_at).getTime()
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [tasks, effectiveUser, quickFilter, search, statusFilter, sortBy, sortDir, isQueuedTaskForDepartmentUser, isTaskAssignedByOthersToUser, isTaskAssignedToUser, currentUserDept, currentUserRole])

  const paginationSignature = `${quickFilter}|${statusFilter}|${search}|${sortBy}|${sortDir}`
  const currentPage = paginationState.signature === paginationSignature ? paginationState.page : 1
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / TASKS_PER_PAGE))
  const visiblePage = Math.min(currentPage, totalPages)
  const paginatedTasks = useMemo(() => {
    const start = (visiblePage - 1) * TASKS_PER_PAGE
    return filteredTasks.slice(start, start + TASKS_PER_PAGE)
  }, [filteredTasks, visiblePage])

  useEffect(() => {
    // Prefetch likely detail routes to reduce perceived navigation delay.
    paginatedTasks.slice(0, 20).forEach((task) => {
      router.prefetch(`/dashboard/tasks/${task.id}`)
    })
  }, [paginatedTasks, router])

  const bulkDelete = () => {
    startTransition(async () => {
      await Promise.all([...selected].map((id) => deleteTodoAction(id)))
      setShowBulkMenu(false)
      refresh()
    })
  }

  const bulkArchive = () => {
    startTransition(async () => {
      await Promise.all([...selected].map((id) => archiveTodoAction(id)))
      setShowBulkMenu(false)
      refresh()
    })
  }

  const toggleSelect = (id: string) => {
    setSelected((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size > 0 && paginatedTasks.every((task) => selected.has(task.id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(paginatedTasks.map((t: Todo) => t.id)))
    }
  }

  const exportCSV = () => {
    const rows = filteredTasks.map((t: Todo) => [t.title, t.task_status, t.priority, t.assigned_to ?? '', t.due_date ?? '', t.app_name ?? '', t.package_name ?? '', t.kpi_type ?? ''])
    const csv = [['Title', 'Status', 'Priority', 'Assigned To', 'Due Date', 'Apps', 'Packages', 'KPI Type'], ...rows]
      .map((r: string[]) => r.map((c: string) => `"${c}"`).join(','))
      .join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `tasks-${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
  }

  const cardProps = (task: Todo) => ({
    task,
    currentUsername,
    currentUserDept,
    currentUserTeamMembers,
    onEdit: (t: Todo) => setEditTask(t),
    onViewDetail: (t: Todo) => router.push(`/dashboard/tasks/${t.id}`),
    onShare: (t: Todo) => setShareTask(t),
    onRefresh: refresh,
  })

  return (
    <div className="flex h-full flex-col px-3 pb-4 sm:px-4">
      <div className="mb-5 relative z-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Task', value: scopedKpiStats.total, icon: ListTodo, tone: 'text-[#2B7FFF]', bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', kpiKey: 'total' },
          { label: 'Completed Task', value: scopedKpiStats.completed, icon: CircleCheckBig, tone: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]', kpiKey: 'completed' },
          { label: 'Pending', value: scopedKpiStats.pending, icon: Hourglass, tone: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', border: 'border-[#FDE68A]', kpiKey: 'pending' },
          { label: 'Overdue', value: scopedKpiStats.overdue, icon: AlertTriangle, tone: 'text-[#E11D48]', bg: 'bg-[#FFF1F2]', border: 'border-[#FECDD3]', kpiKey: 'overdue' },
          { label: 'Queue', value: scopedKpiStats.queue, icon: Inbox, tone: 'text-[#7C3AED]', bg: 'bg-[#F3E8FF]', border: 'border-[#DDD6FE]', kpiKey: 'queue' },
        ].map((item) => {
          const Icon = item.icon
          const isActive = activeKpi === item.kpiKey
          return (
            <div
              key={item.label}
              onClick={() => applyKpiFilter(item.kpiKey)}
              className={cn(
                'cursor-pointer rounded-[18px] border bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.09)]',
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
            </div>
          )
        })}
        </div>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-[#d9e2f0] bg-white shadow-[0_18px_50px_rgba(31,65,132,0.08)]">
        <div className="border-b border-[#e3e9f5] bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
            <div className="flex min-w-0 items-center">
              <div className="relative">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-[#d9e2f0] bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-[#c4d3ef] hover:bg-slate-50"
                  onClick={() => setScopeDropdownOpen((v) => !v)}
                >
                  {scopeLabel}
                  <ChevronDown size={14} className={cn('text-slate-400 transition-transform', scopeDropdownOpen && 'rotate-180')} />
                </button>
                {scopeDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setScopeDropdownOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1 min-w-[230px] rounded-xl border border-[#d9e2f0] bg-white py-1 shadow-[0_8px_30px_rgba(25,42,89,0.12)]">
                      {([
                        { scope: 'assigned_to_me' as const, label: 'Assign to me tasks', count: dropdownScopeCounts.assigned_to_me },
                        { scope: 'created_by_me' as const, label: 'My Created task', count: dropdownScopeCounts.created_by_me },
                      ]).map((option) => {
                        const isSwitching = pendingScopeSwitch === option.scope
                        return (
                          <button
                            key={option.scope}
                            disabled={!!pendingScopeSwitch}
                            onClick={() => {
                              setPendingScopeSwitch(option.scope)
                              router.replace(`/dashboard/tasks?scope=${option.scope}&status=${statusFilter}`, { scroll: false })
                              setScopeDropdownOpen(false)
                              // clear after short delay so spinner is visible
                              setTimeout(() => setPendingScopeSwitch(null), 800)
                            }}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed',
                              quickFilter === option.scope ? 'bg-blue-50/50 font-bold text-blue-600' : 'text-slate-700'
                            )}
                          >
                            <span>{option.label}</span>
                            {isSwitching ? (
                              <svg className="h-3.5 w-3.5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                            ) : (
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                quickFilter === option.scope ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                              )}>
                                {option.count}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="inline-flex items-center rounded-xl border border-[#d9e2f0] bg-white p-1 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
              {([['list', 'List'], ['kanban', 'Kanban'], ['calendar', 'Calendar']] as [ViewMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                    viewMode === mode
                      ? 'bg-[#edf3ff] text-[#3559d8] shadow-[inset_0_0_0_1px_rgba(83,114,230,0.12)]'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative min-w-[240px] flex-1 xl:ml-auto xl:max-w-[260px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search tasks..."
                value={search}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-[#d9e2f0] bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <button
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>

              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
              >
                {paginatedTasks.length > 0 && paginatedTasks.every((task) => selected.has(task.id)) ? <CheckSquare size={13} className="text-[#3559d8]" /> : <Square size={13} />}
                {selected.size > 0 ? `${selected.size} selected` : 'Select All'}
              </button>

              {selected.size > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowBulkMenu((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                  >
                    <SlidersHorizontal size={13} />
                    Bulk Actions
                    <ChevronDown size={12} />
                  </button>
                  {showBulkMenu && (
                    <div
                      className="absolute left-0 top-11 z-20 min-w-40 rounded-2xl border border-[#d9e2f0] bg-white py-1 shadow-[0_12px_30px_rgba(25,42,89,0.14)]"
                      onMouseLeave={() => setShowBulkMenu(false)}
                    >
                      <button onClick={bulkArchive} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><Archive size={13} /> Archive All</button>
                      <button onClick={bulkDelete} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"><Trash2 size={13} /> Delete All</button>
                    </div>
                  )}
                </div>
              )}

              <span className="font-bold uppercase tracking-[0.16em] text-[#8fa0bf]">Sort By:</span>
              <div className="relative">
                <select
                  value={`${sortBy}_${sortDir}`}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                    const [s, d] = e.target.value.split('_')
                    setSortBy(s as typeof sortBy)
                    setSortDir(d as typeof sortDir)
                  }}
                  className="appearance-none rounded-xl border border-transparent bg-transparent py-1.5 pl-2 pr-6 text-xs font-semibold text-slate-600 outline-none"
                >
                  <option value="position_asc">Custom Order</option>
                  <option value="created_at_desc">Recently Created</option>
                  <option value="created_at_asc">Oldest</option>
                  <option value="due_date_asc">Due Soonest</option>
                  <option value="priority_desc">Highest Priority</option>
                  <option value="title_asc">A-Z</option>
                </select>
                <ArrowDownUp size={12} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>

              <span className="min-w-fit text-[11px] font-medium text-slate-400">{filteredTasks.length} tasks</span>

              <button
                onClick={() => {
                  setAddTaskPending(true)
                  setShowCreate(true)
                  // spinner clears once modal is open (next tick)
                  setTimeout(() => setAddTaskPending(false), 600)
                }}
                disabled={addTaskPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2f66f5] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(47,102,245,0.28)] transition hover:bg-[#2558dd] disabled:opacity-80 sm:min-w-[124px]"
              >
                {addTaskPending
                  ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                  : <Plus size={14} />}
                {addTaskPending ? 'Opening...' : 'Add Task'}
              </button>

              <button
                onClick={exportCSV}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#d9e2f0] bg-white text-slate-500 transition hover:border-[#c4d3ef] hover:text-slate-700"
                title="Export tasks"
              >
                <Upload size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#f5f7fc] px-4 py-4 sm:px-5">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-blue-400" />
            </div>
          )}

          {!loading && filteredTasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Inbox size={40} className="mb-3 text-slate-200" />
              <p className="font-semibold text-slate-500">No tasks found</p>
              <p className="mt-1 text-sm text-slate-400">
                {search || quickFilter !== 'my_all' ? 'Try clearing filters.' : 'Create your first task to get started.'}
              </p>
            </div>
          )}

          {!loading && viewMode === 'list' && paginatedTasks.length > 0 && (
            <div className="space-y-3">
              {paginatedTasks.map((task) => (
                <div key={task.id} className="group/row flex items-start gap-2">
                  <button
                    onClick={() => toggleSelect(task.id)}
                    className="mt-5 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-[#3559d8] group-hover/row:opacity-100"
                  >
                    {selected.has(task.id) ? <CheckSquare size={15} className="text-blue-600 opacity-100" /> : <Square size={15} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <TaskCard {...cardProps(task)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && viewMode === 'kanban' && (
            <div className="flex min-h-full gap-3 overflow-x-auto py-1">
              {KANBAN_COLUMNS.map((col) => {
                const colTasks = paginatedTasks.filter((t) => t.task_status === col.key)
                return (
                  <div key={col.key} className="w-72 flex-none">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 rounded-full', col.dot)} />
                        <span className="text-sm font-bold text-slate-700">{col.label}</span>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
                        {colTasks.length}
                      </span>
                    </div>
                    <div className="min-h-32 space-y-2 rounded-xl border border-slate-200 bg-white p-2">
                      {colTasks.map((task) => (
                        <TaskCard key={task.id} {...cardProps(task)} compact />
                      ))}
                      {colTasks.length === 0 && (
                        <div className="py-8 text-center text-xs text-slate-300">No tasks</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!loading && viewMode === 'calendar' && (
            <CalendarView tasks={paginatedTasks} onTaskClick={(t) => router.push(`/dashboard/tasks/${t.id}`)} />
          )}

          {!loading && filteredTasks.length > TASKS_PER_PAGE && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfe5f1] bg-white px-4 py-3">
              <p className="text-sm text-slate-500">
                Showing {(visiblePage - 1) * TASKS_PER_PAGE + 1}-{Math.min(visiblePage * TASKS_PER_PAGE, filteredTasks.length)} of {filteredTasks.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPaginationState({ signature: paginationSignature, page: Math.max(1, visiblePage - 1) })}
                  disabled={visiblePage === 1}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                  Page {visiblePage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPaginationState({ signature: paginationSignature, page: Math.min(totalPages, visiblePage + 1) })}
                  disabled={visiblePage === totalPages}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(showCreate || editTask) && (
        <CreateTaskModal
          ownerUsername={currentUsername}
          editTask={editTask}
          initialPackages={taskFormDataQuery.data?.packages}
          initialUsers={taskFormDataQuery.data?.users}
          initialDepartments={taskFormDataQuery.data?.departments}
          onClose={() => { setShowCreate(false); setEditTask(null) }}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

function CalendarView({ tasks, onTaskClick }: { tasks: Todo[]; onTaskClick: (task: Todo) => void }) {
  const today = new Date()
  const [calYear, setCalYear] = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())

  const firstDay = new Date(calYear, calMonth, 1)
  const lastDay = new Date(calYear, calMonth + 1, 0)
  const startDow = firstDay.getDay()
  const daysInMonth = lastDay.getDate()
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const tasksByDay: Record<number, Todo[]> = {}
  tasks.forEach((t) => {
    if (!t.due_date) return
    const d = new Date(t.due_date)
    if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
      const day = d.getDate()
      if (!tasksByDay[day]) tasksByDay[day] = []
      tasksByDay[day].push(t)
    }
  })

  const monthLabel = firstDay.toLocaleString('default', { month: 'long', year: 'numeric' })

  const prevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11)
      setCalYear((y) => y - 1)
    } else {
      setCalMonth((m) => m - 1)
    }
  }

  const nextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0)
      setCalYear((y) => y + 1)
    } else {
      setCalMonth((m) => m + 1)
    }
  }

  return (
    <div className="max-w-5xl px-1 py-4">
      <div className="mb-4 flex items-center gap-4">
        <button onClick={prevMonth} className="rounded-lg p-1.5 text-lg font-bold text-slate-500 hover:bg-slate-100">\u2039</button>
        <span className="font-bold text-slate-800">{monthLabel}</span>
        <button onClick={nextMonth} className="rounded-lg p-1.5 text-lg font-bold text-slate-500 hover:bg-slate-100">\u203a</button>
        <button onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()) }} className="ml-2 text-xs text-blue-600 hover:underline">Today</button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-slate-50 py-2 text-center text-xs font-semibold text-slate-500">{d}</div>
        ))}
        {cells.map((day, i) => {
          const isToday = day !== null && day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
          const dayTasks = day ? tasksByDay[day] ?? [] : []
          return (
            <div key={i} className={cn('min-h-20 bg-white p-1.5', !day && 'bg-slate-50', isToday && 'bg-blue-50')}>
              {day && (
                <>
                  <span className={cn('mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', isToday ? 'bg-blue-600 text-white' : 'text-slate-600')}>
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onTaskClick(t)}
                        className={cn('w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium', t.priority === 'urgent' ? 'bg-red-100 text-red-700' : t.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700')}
                      >
                        {t.app_name || t.title}
                      </button>
                    ))}
                    {dayTasks.length > 3 && (
                      <span className="pl-1 text-[10px] text-slate-400">+{dayTasks.length - 3} more</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
