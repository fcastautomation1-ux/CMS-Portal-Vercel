'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, useCallback, useMemo, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  CheckSquare,
  Square,
  Trash2,
  Archive,
  Loader2,
  Inbox,
  Users,
  ArrowDownUp,
  SlidersHorizontal,
  Upload,
  ListTodo,
  CircleCheckBig,
  Hourglass,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { splitTaskMeta } from '@/lib/task-metadata'
import { computeTodoStatsFromTodos } from '@/lib/todo-stats'
import type { Todo, TaskStatus, MultiAssignmentEntry, MultiAssignmentSubEntry } from '@/types'
import { TaskCard } from './task-card'
import { CreateTaskModal } from './create-task-modal'
import {
  getTodos,
  deleteTodoAction,
  archiveTodoAction,
} from '@/app/dashboard/tasks/actions'

type ViewMode = 'list' | 'kanban' | 'calendar'
type QuickFilter = 'all' | 'my_all' | 'my_pending' | 'assigned_by_me' | 'my_approval' | 'other_approval'

type SmartList =
  | 'all' | 'today' | 'upcoming' | 'overdue' | 'thisweek' | 'thismonth'

type StatusFilter =
  | 'all' | 'pending' | 'queue' | 'inprogress' | 'completed' | 'overdue' | 'archived'

type DateFilter =
  | 'all' | 'today' | 'yesterday' | 'last7days' | 'last30days'
  | 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'thisyear'

type MessageFilter = 'all' | 'unread' | 'read'

const KANBAN_COLUMNS: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'backlog', label: 'Backlog', dot: 'bg-slate-400' },
  { key: 'todo', label: 'To Do', dot: 'bg-yellow-400' },
  { key: 'in_progress', label: 'In Progress', dot: 'bg-blue-500' },
  { key: 'done', label: 'Done', dot: 'bg-green-500' },
]

interface TasksBoardProps {
  currentUsername: string
  currentUserRole?: string
  currentUserDept?: string | null
  currentUserTeamMembers?: string[]
  initialTasks: Todo[]
  initialScope?: QuickFilter
}

export function TasksBoard({ currentUsername, currentUserRole = 'User', currentUserDept, currentUserTeamMembers = [], initialTasks, initialScope = 'my_all' }: TasksBoardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()
  const refreshTimerRef = useRef<number | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialScope)
  const [search, setSearch] = useState('')
  const [memberFilter, setMemberFilter] = useState('all')
  const [smartList, setSmartList] = useState<SmartList>('all')
  const [sortBy, setSortBy] = useState<'position' | 'due_date' | 'priority' | 'created_at' | 'title'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high' | 'medium' | 'low'>('all')
  const [deptFilter, setDeptFilter] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [messageFilter, setMessageFilter] = useState<MessageFilter>('all')

  const [showCreate, setShowCreate] = useState(false)
  const [editTask, setEditTask] = useState<Todo | null>(null)
  const [, setShareTask] = useState<Todo | null>(null)
  const [, setDeclineTask] = useState<Todo | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkMenu, setShowBulkMenu] = useState(false)

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(currentUsername),
    queryFn: () => getTodos().catch(() => [] as Todo[]),
    initialData: initialTasks,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const tasks = tasksQuery.data ?? initialTasks
  const stats = useMemo(() => computeTodoStatsFromTodos(tasks), [tasks])

  // Role flags — mirror old portal role checks (must be before any useMemo that depends on them)
  const isAdminOrSM = currentUserRole === 'Admin' || currentUserRole === 'Super Manager'
  const isManagerRole = isAdminOrSM || currentUserRole === 'Manager' || currentUserRole === 'Supervisor'

  const extStats = useMemo(() => ({
    // "Assigned To Me" always scopes to current user
    assignedToMe: tasks.filter((t: Todo) =>
      t.assigned_to === currentUsername ||
      t.multi_assignment?.assignees?.some((a: MultiAssignmentEntry) => a.username === currentUsername)
    ).length,
    // "In Progress": Admin/SM see portal-wide count; others see their own scope
    inProgress: isAdminOrSM
      ? tasks.filter((t: Todo) => t.task_status === 'in_progress').length
      : tasks.filter((t: Todo) =>
          t.task_status === 'in_progress' && (
            t.username === currentUsername ||
            t.assigned_to === currentUsername ||
            t.multi_assignment?.assignees?.some((a: MultiAssignmentEntry) => a.username === currentUsername)
          )
        ).length,
  }), [tasks, currentUsername, isAdminOrSM])

  // ── Active KPI (computed from filter state — syncs all filters) ──────────────
  const activeKpi = useMemo(() => {
    if (quickFilter === 'all' && statusFilter === 'all' && smartList === 'all') return 'total'
    if (quickFilter === 'my_all' && statusFilter === 'all' && smartList === 'all') return 'assigned'
    if (statusFilter === 'completed') return 'completed'
    if (statusFilter === 'pending') return 'pending'
    if (statusFilter === 'inprogress') return 'inprogress'
    if (statusFilter === 'overdue') return 'overdue'
    return ''
  }, [quickFilter, statusFilter, smartList])

  const applyKpiFilter = useCallback((key: string) => {
    // Reset all subsidiary filters
    setSmartList('all')
    setStatusFilter('all')
    setPriorityFilter('all')
    setDateFilter('all')
    setMessageFilter('all')
    setSearch('')
    setDeptFilter('')
    setMemberFilter('all')
    // Admin/SM: KPI status cards show ALL tasks (quickFilter='all')
    // Other roles: scope to their own tasks (quickFilter='my_all')
    const scopeAll = isAdminOrSM
    if (key === 'total') {
      setQuickFilter(isAdminOrSM ? 'all' : 'my_all')
    } else if (key === 'assigned') {
      setQuickFilter('my_all')
    } else if (key === 'completed') {
      setQuickFilter(scopeAll ? 'all' : 'my_all')
      setStatusFilter('completed')
    } else if (key === 'pending') {
      setQuickFilter(scopeAll ? 'all' : 'my_all')
      setStatusFilter('pending')
    } else if (key === 'inprogress') {
      setQuickFilter(scopeAll ? 'all' : 'my_all')
      setStatusFilter('inprogress')
    } else if (key === 'overdue') {
      setQuickFilter(scopeAll ? 'all' : 'my_all')
      setStatusFilter('overdue')
    }
  }, [isAdminOrSM])

  const departments = useMemo(() => {
    const depts = new Set<string>()
    tasks.forEach((t: Todo) => {
      // Split comma-separated dept values (users can belong to multiple depts)
      const addDept = (d: string | null | undefined) => {
        if (!d) return
        d.split(',').map(s => s.trim()).filter(Boolean).forEach(s => depts.add(s))
      }
      addDept(t.creator_department)
      addDept(t.assignee_department)
      addDept(t.queue_department)
    })
    return Array.from(depts).sort()
  }, [tasks])

  // Map: username.lower → raw dept string (may be comma-separated) — used for dept→member cascade
  const memberDeptMap = useMemo(() => {
    const map: Record<string, string> = {}
    tasks.forEach((t: Todo) => {
      if (t.username && t.creator_department && !map[t.username.toLowerCase()]) {
        map[t.username.toLowerCase()] = t.creator_department
      }
      if (t.assigned_to && t.assignee_department && !map[t.assigned_to.toLowerCase()]) {
        map[t.assigned_to.toLowerCase()] = t.assignee_department
      }
    })
    return map
  }, [tasks])

  // Full member pool, role-filtered to match old portal
  const visibleMembers = useMemo(() => {
    const members = new Set<string>()
    if (isAdminOrSM) {
      // Admin / Super Manager: all unique usernames found in tasks
      tasks.forEach((task: Todo) => {
        if (task.username) members.add(task.username)
        if (task.assigned_to) members.add(task.assigned_to)
        task.multi_assignment?.assignees?.forEach((assignee: MultiAssignmentEntry) => {
          if (assignee.username) members.add(assignee.username)
        })
      })
    } else if (isManagerRole) {
      // Manager / Supervisor: explicit team members from session + anyone assigned by this manager
      currentUserTeamMembers.forEach(m => { if (m) members.add(m) })
      tasks.forEach((task: Todo) => {
        if (task.username.toLowerCase() === currentUsername.toLowerCase() && task.assigned_to) {
          members.add(task.assigned_to)
        }
      })
    }
    // Remove self
    members.delete(currentUsername)
    return Array.from(members).sort((a: string, b: string) => a.localeCompare(b))
  }, [tasks, currentUsername, isAdminOrSM, isManagerRole, currentUserTeamMembers])

  // Members filtered by selected dept — used in the dropdown
  const filteredMembers = useMemo(() => {
    if (!deptFilter) return visibleMembers
    return visibleMembers.filter(m => {
      const deptStr = memberDeptMap[m.toLowerCase()] || ''
      if (!deptStr) return false
      return deptStr.split(',').map((d: string) => d.trim()).some(
        (d: string) => d.toLowerCase() === deptFilter.toLowerCase()
      )
    })
  }, [visibleMembers, deptFilter, memberDeptMap])

  const effectiveUser = memberFilter !== 'all' ? memberFilter : currentUsername

  const refresh = useCallback(async () => {
    setLoading(true)
    const ft = await getTodos().catch(() => [] as Todo[])
    queryClient.setQueryData(queryKeys.tasks(currentUsername), ft)
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
        { table: 'todo_attachments' },
      ],
      scheduleRefresh
    )

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      unsubscribe()
    }
  }, [currentUsername, refresh])

  const isQueuedTaskForDepartmentUser = useCallback((task: Todo, username: string) => {
    if (task.queue_status !== 'queued') return false
    // Only truly unassigned/queued tasks (empty or null assigned_to)
    if (task.assigned_to && task.assigned_to.trim() !== '') return false
    const uLower = username.toLowerCase()
    // Use currentUserDept directly for self, memberDeptMap for any other user
    const rawDept: string | null = uLower === currentUsername.toLowerCase()
      ? (currentUserDept ?? null)
      : (memberDeptMap[uLower] ?? null)
    if (!rawDept) return false
    const queueDeptLower = (task.queue_department || '').toLowerCase().trim()
    if (!queueDeptLower) return false
    // Support comma-separated departments (user may belong to multiple)
    return rawDept.split(',').map((d: string) => d.trim().toLowerCase()).some((d: string) => d && d === queueDeptLower)
  }, [currentUserDept, currentUsername, memberDeptMap])

  const getMessageState = useCallback((task: Todo, username: string) => {
    const comments = task.history.filter((h) => h.type === 'comment')
    if (!comments.length) return 'none'
    const hasUnread = comments.some((h) => Array.isArray(h.unread_by) && h.unread_by.includes(username))
    return hasUnread ? 'unread' : 'read'
  }, [])

  const filteredTasks = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const lastWeekStart = new Date(weekStart)
    lastWeekStart.setDate(weekStart.getDate() - 7)
    const lastWeekEnd = new Date(weekStart)
    lastWeekEnd.setDate(weekStart.getDate() - 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    const yearStart = new Date(now.getFullYear(), 0, 1)
    let list = [...tasks]
    const userLower = effectiveUser.toLowerCase()

    if (quickFilter === 'my_pending') {
      list = list.filter((t) => {
        if (t.completed || t.archived) return false
        if ((t.assigned_to || '').toLowerCase() === userLower) return true
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
        if ((t.assigned_to || '').toLowerCase() === userLower) return true
        if ((t.completed_by || '').toLowerCase() === userLower) return true
        if (t.username.toLowerCase() === userLower) return true
        const ma = t.multi_assignment
        if (ma?.enabled && Array.isArray(ma.assignees)) {
          if (ma.assignees.some((a: MultiAssignmentEntry) => (a.username || '').toLowerCase() === userLower)) return true
          if (ma.assignees.some((a: MultiAssignmentEntry) => Array.isArray(a.delegated_to) && a.delegated_to.some((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() === userLower))) return true
        }
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
      list = list.filter((t) => !t.archived && t.approval_status === 'pending_approval' && t.username.toLowerCase() === userLower)
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

    if (smartList !== 'all') {
      list = list.filter((t) => {
        const due = t.due_date ? new Date(t.due_date) : null
        if (!due) return false
        if (smartList === 'today') return due.toDateString() === today.toDateString()
        if (smartList === 'upcoming') return due >= today && !t.completed
        if (smartList === 'overdue') return !t.completed && due < today
        if (smartList === 'thisweek') return due >= weekStart && due <= weekEnd
        if (smartList === 'thismonth') return due >= monthStart && due <= monthEnd
        return true
      })
    }

    if (statusFilter !== 'all') {
      list = list.filter((t) => {
        if (statusFilter === 'queue') {
          // Admin/SM: see ALL queued tasks (unassigned, any dept) — deptFilter narrows further if set
          if (isAdminOrSM) return t.queue_status === 'queued' && (!t.assigned_to || t.assigned_to.trim() === '')
          // Others: only queued tasks for their own department
          return isQueuedTaskForDepartmentUser(t, effectiveUser)
        }
        const queuedForUser = isQueuedTaskForDepartmentUser(t, effectiveUser)
        if (statusFilter === 'pending') return ((!t.completed && t.task_status !== 'in_progress') || queuedForUser) && !t.archived
        if (statusFilter === 'inprogress') return !t.completed && t.task_status === 'in_progress'
        if (statusFilter === 'completed') return t.completed || t.task_status === 'done'
        if (statusFilter === 'overdue') return !t.completed && !!t.due_date && new Date(t.due_date) < now
        if (statusFilter === 'archived') return !!t.archived
        return true
      })
    }
    if (priorityFilter !== 'all') list = list.filter((t) => t.priority === priorityFilter)
    if (deptFilter) {
      // Comma-split matching: a user may belong to multiple depts stored as "Dept A,Dept B"
      const deptLow = deptFilter.toLowerCase()
      const inDept = (d: string | null | undefined) =>
        d ? d.split(',').map((s: string) => s.trim().toLowerCase()).includes(deptLow) : false
      list = list.filter((t) =>
        inDept(t.creator_department) || inDept(t.assignee_department) || inDept(t.queue_department)
      )
    }
    if (memberFilter !== 'all') {
      list = list.filter((t) => {
        const target = memberFilter.toLowerCase()
        if (t.username.toLowerCase() === target) return true
        if ((t.assigned_to || '').toLowerCase() === target) return true
        const ma = t.multi_assignment
        if (ma?.enabled && Array.isArray(ma.assignees)) {
          if (ma.assignees.some((a: MultiAssignmentEntry) => (a.username || '').toLowerCase() === target)) return true
          if (ma.assignees.some((a: MultiAssignmentEntry) => Array.isArray(a.delegated_to) && a.delegated_to.some((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() === target))) return true
        }
        return false
      })
    }
    if (dateFilter !== 'all') {
      list = list.filter((t) => {
        const created = new Date(t.created_at)
        const yesterday = new Date(today)
        yesterday.setDate(today.getDate() - 1)
        const last7 = new Date(today)
        last7.setDate(today.getDate() - 7)
        const last30 = new Date(today)
        last30.setDate(today.getDate() - 30)
        if (dateFilter === 'today') return created.toDateString() === today.toDateString()
        if (dateFilter === 'yesterday') return created.toDateString() === yesterday.toDateString()
        if (dateFilter === 'last7days') return created >= last7
        if (dateFilter === 'last30days') return created >= last30
        if (dateFilter === 'thisweek') return created >= weekStart && created <= weekEnd
        if (dateFilter === 'lastweek') return created >= lastWeekStart && created <= lastWeekEnd
        if (dateFilter === 'thismonth') return created >= monthStart && created <= monthEnd
        if (dateFilter === 'lastmonth') return created >= lastMonthStart && created <= lastMonthEnd
        if (dateFilter === 'thisyear') return created >= yearStart
        return true
      })
    }
    if (messageFilter !== 'all') {
      list = list.filter((t) => getMessageState(t, effectiveUser) === messageFilter)
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
  }, [tasks, effectiveUser, quickFilter, search, smartList, statusFilter, priorityFilter, deptFilter, memberFilter, dateFilter, messageFilter, sortBy, sortDir, isAdminOrSM, isQueuedTaskForDepartmentUser, getMessageState])

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
    if (selected.size === filteredTasks.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredTasks.map((t: Todo) => t.id)))
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
    onEdit: (t: Todo) => setEditTask(t),
    onViewDetail: (t: Todo) => router.push(`/dashboard/tasks/${t.id}`),
    onShare: (t: Todo) => setShareTask(t),
    onDecline: (t: Todo) => setDeclineTask(t),
    onRefresh: refresh,
  })

  return (
    <div className="flex h-full flex-col px-3 pb-4 sm:px-4">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        {[
          { label: 'Total Tasks', value: stats.total, icon: ListTodo, tone: 'text-[#2B7FFF]', bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', kpiKey: 'total' },
          { label: 'Assigned To Me', value: extStats.assignedToMe, icon: Users, tone: 'text-[#7C3AED]', bg: 'bg-[#F5F3FF]', border: 'border-[#DDD6FE]', kpiKey: 'assigned' },
          { label: 'Completed', value: stats.completed, icon: CircleCheckBig, tone: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]', kpiKey: 'completed' },
          { label: 'Pending', value: stats.pending, icon: Hourglass, tone: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', border: 'border-[#FDE68A]', kpiKey: 'pending' },
          { label: 'In Progress', value: extStats.inProgress, icon: RefreshCw, tone: 'text-[#0D9488]', bg: 'bg-[#F0FDFA]', border: 'border-[#99F6E4]', kpiKey: 'inprogress' },
          { label: 'Overdue', value: stats.overdue, icon: AlertTriangle, tone: 'text-[#E11D48]', bg: 'bg-[#FFF1F2]', border: 'border-[#FECDD3]', kpiKey: 'overdue' },
        ].map((item) => {
          const Icon = item.icon
          const isActive = activeKpi === item.kpiKey
          return (
            <div
              key={item.label}
              onClick={() => applyKpiFilter(item.kpiKey)}
              className={cn(
                'cursor-pointer rounded-[18px] border bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.09)]',
                isActive && '-translate-y-1 shadow-[0_14px_30px_rgba(15,23,42,0.12)] ring-2 ring-[#3559d8] ring-offset-1'
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

      <div className="overflow-hidden rounded-[22px] border border-[#d9e2f0] bg-white shadow-[0_18px_50px_rgba(31,65,132,0.08)]">
        <div className="border-b border-[#e3e9f5] bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className={cn(
                'grid gap-2',
                isAdminOrSM
                  ? 'lg:grid-cols-[minmax(150px,190px)_minmax(220px,1fr)_minmax(150px,170px)]'
                  : (isManagerRole && visibleMembers.length > 0)
                    ? 'lg:grid-cols-[minmax(150px,190px)_minmax(150px,170px)]'
                    : 'lg:grid-cols-[minmax(150px,190px)]'
              )}>
                <select
                  value={quickFilter}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                    setQuickFilter(e.target.value as QuickFilter)
                    // Reset status/smartList so quick filter takes full control (mirrors old portal)
                    setStatusFilter('all')
                    setSmartList('all')
                  }}
                  className="w-full rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-sm font-medium text-[#3559d8] outline-none transition focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                >
                  <option value="my_all">My Tasks</option>
                  <option value="all">All Tasks {stats.total}</option>
                </select>

                {isAdminOrSM && (
                  <select
                    value={deptFilter}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                      const val = e.target.value
                      setDeptFilter(val)
                      setMemberFilter('all') // cascade: reset member when dept changes
                      if (val) {
                        // Show ALL tasks for the selected department (all statuses, all members)
                        setQuickFilter('all')
                        setStatusFilter('all')
                        setSmartList('all')
                        setPriorityFilter('all')
                        setDateFilter('all')
                      }
                    }}
                    className="w-full rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-sm text-slate-600 outline-none transition focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                  >
                    <option value="">All Departments</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}

                {isManagerRole && visibleMembers.length > 0 && (
                  <select
                    value={memberFilter}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setMemberFilter(e.target.value)}
                    className="w-full rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-sm text-slate-600 outline-none transition focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                  >
                    <option value="all">All Members</option>
                    {filteredMembers.map((member) => (
                      <option key={member} value={member}>{member}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
              <div className="relative w-full sm:min-w-[240px] xl:w-[260px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={search}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-[#d9e2f0] bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                />
              </div>

              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2f66f5] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(47,102,245,0.28)] transition hover:bg-[#2558dd] sm:min-w-[124px]"
              >
                <Plus size={14} /> Add Task
              </button>

              <button
                onClick={exportCSV}
                className="inline-flex h-10 w-10 items-center justify-center self-end rounded-xl border border-[#d9e2f0] bg-white text-slate-500 transition hover:border-[#c4d3ef] hover:text-slate-700 sm:self-auto"
                title="Export tasks"
              >
                <Upload size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-[#e3e9f5] bg-[#fbfcff] px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="inline-flex w-fit items-center rounded-xl border border-[#d9e2f0] bg-white p-1 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
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

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={smartList}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSmartList(e.target.value as SmartList)}
                  className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] outline-none transition hover:border-[#c4d3ef] focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                >
                  <option value="all">All Tasks</option>
                  <option value="today">Today</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="overdue">Overdue</option>
                  <option value="thisweek">This Week</option>
                  <option value="thismonth">This Month</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as StatusFilter)}
                  className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] outline-none transition hover:border-[#c4d3ef] focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="queue">Queue</option>
                  <option value="inprogress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="overdue">Overdue</option>
                  <option value="archived">Archived</option>
                </select>

                <select
                  value={priorityFilter}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setPriorityFilter(e.target.value as typeof priorityFilter)}
                  className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] outline-none transition hover:border-[#c4d3ef] focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                >
                  <option value="all">All Priority</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select
                  value={dateFilter}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setDateFilter(e.target.value as DateFilter)}
                  className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] outline-none transition hover:border-[#c4d3ef] focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                >
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7days">Last 7 Days</option>
                  <option value="last30days">Last 30 Days</option>
                  <option value="thisweek">This Week</option>
                  <option value="lastweek">Last Week</option>
                  <option value="thismonth">This Month</option>
                  <option value="lastmonth">Last Month</option>
                  <option value="thisyear">This Year</option>
                </select>

                <select
                  value={messageFilter}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setMessageFilter(e.target.value as MessageFilter)}
                  className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] outline-none transition hover:border-[#c4d3ef] focus:border-[#6b7ff2] focus:ring-2 focus:ring-[#dfe6ff]"
                >
                  <option value="all">All Messages</option>
                  <option value="unread">Unread</option>
                  <option value="read">Read</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 xl:justify-end">
              <button
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>

              <button
                onClick={() => {
                  setQuickFilter('all')
                  setSmartList('all')
                  setStatusFilter('queue')
                  setDeptFilter('')
                  setMemberFilter('all')
                  setPriorityFilter('all')
                  setDateFilter('all')
                  setMessageFilter('all')
                  setSearch('')
                }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-xl border px-3 py-2 font-semibold shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]',
                  statusFilter === 'queue' && quickFilter === 'all'
                    ? 'border-[#3559d8] bg-[#edf3ff] text-[#3559d8]'
                    : 'border-[#d9e2f0] bg-white text-slate-600 hover:border-[#c4d3ef]'
                )}
                title={`Show tasks queued for your department${currentUserDept ? ` (${currentUserDept})` : ''}`}
              >
                <Users size={13} />
                Dept Queue
              </button>

              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
              >
                {selected.size > 0 && selected.size === filteredTasks.length ? <CheckSquare size={13} className="text-[#3559d8]" /> : <Square size={13} />}
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

              <div className="ml-auto flex flex-wrap items-center gap-2 lg:ml-0">
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
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-end">
            <span className="text-[11px] font-medium text-slate-400">{filteredTasks.length} tasks</span>
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
                {search || quickFilter !== 'all' ? 'Try clearing filters.' : 'Create your first task to get started.'}
              </p>
            </div>
          )}

          {!loading && viewMode === 'list' && filteredTasks.length > 0 && (
            <div className="space-y-3">
              <div className="sticky top-0 z-10 flex items-center gap-3 rounded-2xl border border-[#dfe5f1] bg-white/90 px-4 py-3 backdrop-blur">
                <button onClick={toggleSelectAll} className="shrink-0 text-slate-400 hover:text-[#3559d8]">
                  {selected.size > 0 && selected.size === filteredTasks.length ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                </button>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#90a0bc]">Task</span>
                <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.16em] text-[#90a0bc]">Expected</span>
              </div>

              {filteredTasks.map((task) => (
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
                const colTasks = filteredTasks.filter((t) => t.task_status === col.key)
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
            <CalendarView tasks={filteredTasks} onTaskClick={(t) => router.push(`/dashboard/tasks/${t.id}`)} />
          )}
        </div>
      </div>

      {(showCreate || editTask) && (
        <CreateTaskModal ownerUsername={currentUsername} editTask={editTask} onClose={() => { setShowCreate(false); setEditTask(null) }} onSaved={refresh} />
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
        <button onClick={prevMonth} className="rounded-lg p-1.5 text-lg font-bold text-slate-500 hover:bg-slate-100">‹</button>
        <span className="font-bold text-slate-800">{monthLabel}</span>
        <button onClick={nextMonth} className="rounded-lg p-1.5 text-lg font-bold text-slate-500 hover:bg-slate-100">›</button>
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
