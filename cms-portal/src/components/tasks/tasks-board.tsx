'use client'

import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition, useCallback, useMemo, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
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
  PlayCircle,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { buildRealtimeEqFilter, subscribeToPostgresChanges } from '@/lib/realtime'
import { splitTaskMeta } from '@/lib/task-metadata'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'
import type { Todo, TaskStatus, MultiAssignmentEntry, MultiAssignmentSubEntry } from '@/types'
import { TaskCard } from './task-card'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TaskSkeleton, KanbanSkeleton } from './task-skeleton'
import {
  getTodos,
  deleteTodoAction,
  archiveTodoAction,
  getMyOverdueApprovalsAction,
  getPackagesForTaskForm,
  getUsersForAssignment,
  getDepartmentsForTaskForm,
  duplicateTodoAction,
  getSingleTaskLiveUpdateAction,
  updateTaskStatusAction,
} from '@/app/dashboard/tasks/actions'

const CreateTaskModal = dynamic(
  () => import('./create-task-modal').then((mod) => mod.CreateTaskModal),
  { ssr: false }
)

type ViewMode = 'list' | 'kanban' | 'calendar'
type QuickFilter = 'my_all' | 'created_by_me' | 'assigned_to_me' | 'my_pending' | 'assigned_by_me' | 'my_approval' | 'other_approval'

type StatusFilter =
  | 'all' | 'pending' | 'in_progress' | 'completed' | 'overdue' | 'queue'

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
    value === 'in_progress' ||
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
const PER_PAGE_OPTIONS = [5, 10, 15, 20, 25]

interface TasksBoardProps {
  currentUsername: string
  currentUserRole?: string
  currentUserDept?: string | null
  currentUserTeamMembers?: string[]
  currentUserTeamMemberDeptKeys?: string[]
  enableQueueAssign?: boolean
  canAddTask?: boolean
  initialTasks: Todo[]
  initialScope?: QuickFilter
  initialStatus?: StatusFilter
}

export function TasksBoard({ currentUsername, currentUserRole, currentUserDept, currentUserTeamMembers, currentUserTeamMemberDeptKeys, enableQueueAssign = false, canAddTask = true, initialTasks, initialScope = 'assigned_to_me', initialStatus = 'all' }: TasksBoardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const isAdmin = currentUserRole === 'Admin' || currentUserRole === 'Super Manager'
  const quickFilter = parseQuickFilter(searchParams.get('scope')) ?? initialScope
  const statusFilter = parseStatusFilter(searchParams.get('status')) ?? initialStatus

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
  const parentRef = useRef<HTMLDivElement>(null)
  const [activeTask, setActiveTask] = useState<Todo | null>(null)


  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      router.push(`/dashboard/tasks/${id}`)
    }
    const create = searchParams.get('create') === 'true'
    if (create) {
      setShowCreate(true)
    }
  }, [searchParams, router])

  // Clear checkbox selection when scope or status changes (no key-remount anymore)
  useEffect(() => {
    setSelected(new Set())
  }, [quickFilter, statusFilter])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const task = filteredTasks.find((t) => t.id === active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return

    const activeId = active.id.toString()
    const overId = over.id.toString()

    const draggedTask = filteredTasks.find((t) => t.id === activeId)
    if (!draggedTask) return

    // If dropped over a column header or an empty area designated with the column key
    let targetStatus: TaskStatus | null = null
    if (KANBAN_COLUMNS.some((col) => col.key === overId)) {
      targetStatus = overId as TaskStatus
    } else {
      const overTask = filteredTasks.find((t) => t.id === overId)
      if (overTask) targetStatus = overTask.task_status
    }

    if (targetStatus && targetStatus !== draggedTask.task_status) {
      // Optimistic update
      queryClient.setQueryData(['todos', currentUsername], (old: Todo[] | undefined) => {
        if (!old) return old
        return old.map((t) => (t.id === activeId ? { ...t, task_status: targetStatus! } : t))
      })

      try {
        await updateTaskStatusAction(activeId, targetStatus)
      } catch (error) {
        console.error('Failed to update status:', error)
        void refresh()
      }
    }
  }

  const [showBulkMenu, setShowBulkMenu] = useState(false)
  const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false)
  const [pendingScopeSwitch, setPendingScopeSwitch] = useState<string | null>(null)
  const [paginationState, setPaginationState] = useState({ signature: '', page: 1 })
  const [perPage, setPerPage] = useState(5)

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(currentUsername),
    queryFn: async () => {
      const existing = queryClient.getQueryData<Todo[]>(queryKeys.tasks(currentUsername))
      try {
        const fresh = await getTodos()
        // Guard: if server returned empty but we already have data in cache,
        // keep existing data to prevent the "0 tasks" flash.  The server-side
        // revalidation window right after a mutation can momentarily return [].
        if (fresh.length === 0 && existing && existing.length > 0) return existing
        return fresh
      } catch {
        // On network/server error, return existing cache data instead of crashing
        return existing ?? ([] as Todo[])
      }
    },
    initialData: initialTasks,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    // Use initialData from server for first render; mutations call invalidateQueries
    // to refresh on demand — avoid the double-fetch that 'always' causes.
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData, // keep existing data while fetching
  })

  const overdueApprovalsQuery = useQuery({
    queryKey: ['task-overdue-approvals', currentUsername],
    queryFn: () => getMyOverdueApprovalsAction().catch(() => [] as Array<{ id: string; title: string; approval_sla_due_at: string | null }>),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
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

  const { data: rawTasks = [], isLoading: queryLoading } = tasksQuery
  const loading = queryLoading || addTaskPending
  const tasks = rawTasks as Todo[]
  const overdueApprovals = overdueApprovalsQuery.data ?? []
  const effectiveUser = currentUsername

  const isTaskAssignedToUser = useCallback((task: Todo, username: string) => {
    const userLower = username.toLowerCase()
    if ((task.assigned_to || '').toLowerCase() === userLower) return true
    const assignees = task.multi_assignment?.assignees ?? []
    if (assignees.some((a: MultiAssignmentEntry) =>
      (a.username || '').toLowerCase() === userLower ||
      (Array.isArray(a.delegated_to) && a.delegated_to.some((s: MultiAssignmentSubEntry) => (s.username || '').toLowerCase() === userLower))
    )) return true
    // Also visible if user was part of the assignment chain (e.g. they routed the task to a dept queue)
    const chain = task.assignment_chain ?? []
    return chain.some((e) =>
      (e.user || '').toLowerCase() === userLower ||
      (e.next_user || '').toLowerCase() === userLower
    )
  }, [])

  const isTaskAssignedByOthersToUser = useCallback((task: Todo, username: string) => {
    const userLower = username.toLowerCase()
    if ((task.username || '').toLowerCase() === userLower) return false
    return isTaskAssignedToUser(task, username)
  }, [isTaskAssignedToUser])

  // For multi-assignment tasks, use the individual user's status (accepted/completed)
  // instead of the task-level completed flag (only true when ALL assignees finish).
  const isTaskCompletedForUser = useCallback((task: Todo, username: string): boolean => {
    const userLow = username.toLowerCase()
    if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
      const entry = task.multi_assignment.assignees.find(
        (a: MultiAssignmentEntry) => (a.username || '').toLowerCase() === userLow,
      )
      if (entry) return entry.status === 'completed' || entry.status === 'accepted'
      for (const a of task.multi_assignment.assignees) {
        if (Array.isArray(a.delegated_to)) {
          const sub = (a.delegated_to as MultiAssignmentSubEntry[]).find(
            (s) => (s.username || '').toLowerCase() === userLow,
          )
          if (sub) return sub.status === 'completed' || sub.status === 'accepted'
        }
      }
    }

    const isGloballyDone = task.completed || task.task_status === 'done'
    const isMySubmission = (task.completed_by || '').toLowerCase() === userLow
    const isCurrentlyAssignedToMe = (task.assigned_to || '').toLowerCase() === userLow
    const chain = task.assignment_chain ?? []
    const hasForwardedSubmission = chain.some((entry) => {
      const actor = (entry.user || '').toLowerCase()
      const role = String(entry.role || '').toLowerCase()
      const action = String(entry.action || '').toLowerCase()
      return actor === userLow && (
        role === 'submitted_for_approval' ||
        action === 'submit' ||
        action === 'complete' ||
        action === 'complete_final'
      )
    })

    if (isGloballyDone) return true

    // If I submitted it and it's not assigned back to me, it's done for me (awaiting someone else/approval).
    if (isMySubmission && !isCurrentlyAssignedToMe) return true

    // If I submitted it and it's now pending approval (even if still assigned to me), consider it done from my view.
    if (isMySubmission && task.approval_status === 'pending_approval') return true

    // Intermediate approvers should also keep seeing their own submitted step.
    if (hasForwardedSubmission && (task.approval_status === 'pending_approval' || !isCurrentlyAssignedToMe)) return true

    return false
  }, [])

  const rowTouchesCurrentUser = useCallback((row: Record<string, unknown> | null | undefined) => {
    if (!row) return false
    const current = currentUsername.toLowerCase()
    if (String(row.username || '').toLowerCase() === current) return true
    if (String(row.assigned_to || '').toLowerCase() === current) return true
    if (String(row.pending_approver || '').toLowerCase() === current) return true
    if (String(row.completed_by || '').toLowerCase() === current) return true
    // Check multi-assignment assignees (realtime payload delivers JSONB as parsed object)
    try {
      const ma = row.multi_assignment as Record<string, unknown> | null | undefined
      if (ma?.enabled) {
        const assignees = Array.isArray(ma.assignees) ? ma.assignees as Record<string, unknown>[] : []
        if (assignees.some((a) => String(a.username || '').toLowerCase() === current)) return true
      }
    } catch { /* ignore parse errors */ }
    return false
  }, [currentUsername])

  // \u2500\u2500 Active KPI (computed from filter state \u2014 syncs all filters) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const activeKpi = useMemo(() => {
    if (statusFilter === 'all') return 'total'
    if (statusFilter === 'completed') return 'completed'
    if (statusFilter === 'pending') return 'pending'
    if (statusFilter === 'overdue') return 'overdue'
    if (statusFilter === 'queue') return 'queue'
    return ''
  }, [statusFilter])

  const applyKpiFilter = useCallback((key: string) => {
    setSearch('')
    let nextStatus: StatusFilter = 'all'

    if (key === 'completed') {
      nextStatus = 'completed'
    } else if (key === 'in_progress') {
      nextStatus = 'in_progress'
    } else if (key === 'pending') {
      nextStatus = 'pending'
    } else if (key === 'overdue') {
      nextStatus = 'overdue'
    } else if (key === 'queue') {
      nextStatus = 'queue'
    }

    router.replace(`/dashboard/tasks?scope=${quickFilter}&status=${nextStatus}`, { scroll: false })
  }, [quickFilter, router])

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(currentUsername) })
    await queryClient.invalidateQueries({ queryKey: ['task-overdue-approvals', currentUsername] })
  }, [queryClient, currentUsername])

  useEffect(() => {
    const scheduleRefresh = () => {
      // Avoid excessive refreshes by debouncing and checking visibility
      if (document.hidden) return
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        void refresh()
      }, 1000) // Increase debounce to 1s to prevent "shaking" on multiple updates
    }

    // For non-admin users, subscribe only to rows directly involving this user.
    // Subscribing to the whole todos table means every task update by any user
    // triggers a server action call (getSingleTaskLiveUpdateAction) for every
    // open session — at 50 concurrent users this becomes hundreds of server
    // calls per minute for a typical mutation burst.
    // Admins still subscribe broadly because they see all tasks.
    // Build department queue subscriptions so dept members see newly-queued tasks in real-time
    const deptQueueConfigs: Array<{ table: 'todos'; filter: string }> = !isAdmin && currentUserDept
      ? splitDepartmentsCsv(currentUserDept).map((dept) => ({
          table: 'todos' as const,
          filter: buildRealtimeEqFilter('queue_department', dept.trim()),
        }))
      : []

    const todosConfigs = isAdmin
      ? [{ table: 'todos' as const }]
      : [
          { table: 'todos' as const, filter: buildRealtimeEqFilter('username', currentUsername) },
          { table: 'todos' as const, filter: buildRealtimeEqFilter('assigned_to', currentUsername) },
          { table: 'todos' as const, filter: buildRealtimeEqFilter('pending_approver', currentUsername) },
          { table: 'todos' as const, filter: buildRealtimeEqFilter('completed_by', currentUsername) },
          ...deptQueueConfigs,
        ]

    const unsubscribe = subscribeToPostgresChanges(
      `tasks-board:${currentUsername}`,
      [
        ...todosConfigs,
        { table: 'todo_shares', filter: buildRealtimeEqFilter('shared_with', currentUsername) },
        // Notifications channel: when a task_assigned notification arrives it means
        // someone added this user to a multi-assignment (which has no dedicated realtime
        // channel since Supabase can't filter by JSONB array content). Scheduling a
        // refresh ensures multi-assigned tasks appear without manual reload.
        { table: 'notifications', filter: buildRealtimeEqFilter('user_id', currentUsername) },
      ],
      (payload) => {
        if (payload.table === 'todo_shares') {
          scheduleRefresh()
          return
        }

        if (payload.table === 'notifications') {
          // A new task_assigned notification means this user was just added to a task
          // (e.g. multi-assignment) that may not be in their cache yet. Refresh so it appears.
          const notifType = String((payload.new as Record<string, unknown>)?.type || '')
          if (payload.eventType === 'INSERT' && (notifType === 'task_assigned' || notifType === 'multi_assigned')) {
            scheduleRefresh()
          }
          return
        }

        if (payload.table === 'todos') {
          if (payload.eventType === 'DELETE') {
            queryClient.setQueryData<Todo[]>(queryKeys.tasks(currentUsername), (old) => {
              if (!old) return old
              return old.filter(t => t.id !== payload.old.id)
            })
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const taskId = payload.new?.id
            if (taskId) {
              const existingTasks = queryClient.getQueryData<Todo[]>(queryKeys.tasks(currentUsername))
              const inCache = existingTasks?.some(t => t.id === taskId)

              // For UPDATEs: only fetch if the task is already in our local cache.
              // For INSERTs: only fetch if it's owned by or assigned to us (payload.new is
              // available for non-admin filtered channels containing full-row data, and for
              // admin broad channels the cache check is the right guard).
              const touchesNew = rowTouchesCurrentUser(payload.new as Record<string, unknown> | null | undefined)
              const touchesOld = rowTouchesCurrentUser(payload.old as Record<string, unknown> | null | undefined)

              // A reopened task often becomes relevant to the target user on UPDATE.
              // If we only fetch rows already in cache, that user sees "0 tasks"
              // until a manual refresh even though the DB row is correct.
              if (payload.eventType === 'UPDATE' && touchesOld && !touchesNew) {
                scheduleRefresh()
                return
              }

              const shouldFetch = inCache || touchesNew

              if (shouldFetch) {
                getSingleTaskLiveUpdateAction(String(taskId)).then((updatedTask) => {
                  if (!updatedTask) return
                  queryClient.setQueryData<Todo[]>(queryKeys.tasks(currentUsername), (old) => {
                    if (!old) return [updatedTask]
                    const index = old.findIndex(t => t.id === taskId)
                    if (index > -1) {
                      const next = [...old]
                      next[index] = updatedTask
                      return next
                    }
                    
                    // Sort newly inserted tasks exactly like the server
                    return [updatedTask, ...old].sort((a, b) => {
                      const pa = a.position || 0
                      const pb = b.position || 0
                      if (pa !== pb) return pa - pb
                      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    })
                  })
                }).catch(() => scheduleRefresh())
              }
            } else {
              scheduleRefresh()
            }
          }
        }
      }
    )

    // Silent fallback polling every 5 mins to save Vercel serverless costs
    // Real-time patching via WebSockets makes frequent polling obsolete.
    const pollingInterval = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 300_000)

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      window.clearInterval(pollingInterval)
      unsubscribe()
    }
  }, [currentUsername, isAdmin, refresh, rowTouchesCurrentUser])

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

  const matchesQueueVisibility = useCallback((task: Todo) => {
    if (task.queue_status !== 'queued') return false
    if (!task.queue_department) return false

    // Only Admins and Super Managers see ALL queued tasks system-wide
    if (currentUserRole === 'Admin' || currentUserRole === 'Super Manager') return true

    // Task creator/router always sees their own queued tasks regardless of dept
    if ((task.username || '').toLowerCase() === currentUsername.toLowerCase()) return true

    // All other roles (Manager, Supervisor, User) see only tasks for their own department
    const userDepts = splitDepartmentsCsv(currentUserDept || '')
    if (userDepts.length === 0) return false
    const taskDepts = splitDepartmentsCsv(task.queue_department)
    return taskDepts.some((td) => userDepts.some((ud) => canonicalDepartmentKey(ud) === canonicalDepartmentKey(td)))
  }, [currentUserDept, currentUsername, currentUserRole])

  const matchesPersonalScope = useCallback((task: Todo, scope: QuickFilter, username: string) => {
    const userLower = username.toLowerCase()
    if (task.archived) return false

    if (scope === 'created_by_me') return task.username.toLowerCase() === userLower
    // "Assigned to me" includes ALL tasks where this user was assigned (including completed).
    // Completed tasks still appear in the Completed KPI and in the list when status=completed.
    // Previously excluding completed tasks caused the Completed Task KPI to show 0 after
    // a cross-hall approval chain completed (task globally done, completed_by overwritten).
    if (scope === 'assigned_to_me') return isTaskAssignedByOthersToUser(task, username) || isQueuedTaskForDepartmentUser(task, username)
    return (
      task.username.toLowerCase() === userLower ||
      (task.completed_by || '').toLowerCase() === userLower ||
      (task.cluster_routed_by || '').toLowerCase() === userLower ||
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
    const completed = scopedTasksForKpis.filter((task) => isTaskCompletedForUser(task, effectiveUser)).length
    const overdue = scopedTasksForKpis.filter(
      (task) => !isTaskCompletedForUser(task, effectiveUser) && !!task.due_date && new Date(task.due_date) < now,
    ).length
    const userLowerKpi = effectiveUser.toLowerCase()
    const in_progress = scopedTasksForKpis.filter((task) => {
      if (isTaskCompletedForUser(task, effectiveUser)) return false
      // Exclude hall-scheduled tasks that are assigned to someone else
      const hs = task.scheduler_state
      if (hs && ['active', 'user_queue', 'paused', 'blocked'].includes(hs) && (task.assigned_to || '').toLowerCase() !== userLowerKpi) return false
      return task.task_status === 'in_progress'
    }).length
    const pending = scopedTasksForKpis.filter((task) => {
      if (isTaskCompletedForUser(task, effectiveUser)) return false
      if (task.task_status === 'in_progress') return false // already in in_progress
      if (task.queue_status === 'queued') return false // queued tasks belong in Queue KPI, not Pending
      // Exclude hall-scheduled tasks in active states assigned to someone else
      const hs = task.scheduler_state
      if (hs && ['active', 'user_queue', 'paused', 'blocked', 'waiting_review'].includes(hs) && (task.assigned_to || '').toLowerCase() !== userLowerKpi) return false
      // Exclude tasks currently assigned to another user
      if (task.assigned_to && (task.assigned_to || '').toLowerCase() !== userLowerKpi) return false
      if (task.due_date && new Date(task.due_date) < now) return false
      return true
    }).length

    // Queue KPI = count of tasks that would appear in the queue view (matches queue filter display)
    const queue = tasks.filter((task) => !task.archived && matchesQueueVisibility(task)).length

    return {
      total: scopedTasksForKpis.length,
      completed,
      in_progress,
      pending,
      overdue,
      queue,
    }
  }, [scopedTasksForKpis, tasks, matchesQueueVisibility, isTaskCompletedForUser, effectiveUser])

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
    const isQueueStatusActive = statusFilter === 'queue'

    const getMyMaEntry = (t: Todo) => {
      if (!t.multi_assignment?.enabled || !Array.isArray(t.multi_assignment.assignees)) return null
      return t.multi_assignment.assignees.find((entry) => (entry.username || '').toLowerCase() === userLower) ?? null
    }

    const getEffectiveHallState = (t: Todo): string | null => {
      const myMaEntry = getMyMaEntry(t)
      if (myMaEntry) {
        return myMaEntry.hall_scheduler_state
          ?? (myMaEntry.ma_approval_status === 'pending_approval' ? 'waiting_review' : null)
          ?? (myMaEntry.status === 'in_progress' ? 'active' : null)
          ?? ((myMaEntry.status === 'completed' || myMaEntry.status === 'accepted') ? 'completed' : null)
          ?? 'user_queue'
      }

      if ((t.assigned_to || '').toLowerCase() !== userLower) return null
      return ((t as unknown as Record<string, unknown>).scheduler_state as string | null) ?? null
    }

    const getEffectiveHallRank = (t: Todo): number => {
      const myMaEntry = getMyMaEntry(t)
      if (myMaEntry?.hall_queue_rank != null) return myMaEntry.hall_queue_rank
      return (((t as unknown as Record<string, unknown>).queue_rank as number | null) ?? Infinity)
    }

    const hallQueuedCandidates = list.filter((t) => {
      if (t.completed) return false
      const state = getEffectiveHallState(t)
      return state === 'user_queue' || state === 'paused'
    })

    const nextQueuedRank = hallQueuedCandidates.reduce((min, t) => Math.min(min, getEffectiveHallRank(t)), Infinity)
    const nextQueuedCreatedAt = hallQueuedCandidates.reduce(
      (min, t) => (!min || (t.created_at || '') < min ? t.created_at || '' : min),
      '',
    )

    if (isQueueStatusActive) {
      list = list.filter((t) => !t.archived && matchesQueueVisibility(t))
    } else if (quickFilter === 'created_by_me') {
      list = list.filter((t) => !t.archived && t.username.toLowerCase() === userLower)
    } else if (quickFilter === 'assigned_to_me') {
      list = list.filter((t) => !t.archived && (isTaskAssignedByOthersToUser(t, effectiveUser) || isQueuedTaskForDepartmentUser(t, effectiveUser)))
    } else if (quickFilter === 'my_pending') {
      list = list.filter((t) => {
        if (isTaskCompletedForUser(t, effectiveUser) || t.archived) return false
        if (isTaskAssignedToUser(t, effectiveUser)) return true
        if (t.username.toLowerCase() === userLower && (!t.assigned_to || (t.assigned_to || '').toLowerCase() === userLower)) return true
        return isQueuedTaskForDepartmentUser(t, effectiveUser)
      })
    } else if (quickFilter === 'my_all') {
      list = list.filter((t) => {
        if (t.archived) return false
        if (isTaskAssignedToUser(t, effectiveUser)) return true
        if ((t.completed_by || '').toLowerCase() === userLower) return true
        if (t.username.toLowerCase() === userLower) return true
        if ((t.cluster_routed_by || '').toLowerCase() === userLower) return true
        if ((t.assignment_chain || []).some((entry) =>
          (entry.user || '').toLowerCase() === userLower ||
          (entry.next_user || '').toLowerCase() === userLower
        )) return true
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
        if (statusFilter === 'pending') return !isTaskCompletedForUser(t, effectiveUser) && !(t.due_date && new Date(t.due_date) < now) && !t.archived && t.task_status !== 'in_progress' && t.queue_status !== 'queued'
        if (statusFilter === 'in_progress') return !isTaskCompletedForUser(t, effectiveUser) && t.task_status === 'in_progress' && !t.archived
        if (statusFilter === 'completed') return isTaskCompletedForUser(t, effectiveUser)
        if (statusFilter === 'overdue') return !isTaskCompletedForUser(t, effectiveUser) && !!t.due_date && new Date(t.due_date) < now
        if (statusFilter === 'queue') return !t.archived && matchesQueueVisibility(t)
        return true
      })
    }

    list.sort((a, b) => {
      const aCompleted = a.completed ? 1 : 0
      const bCompleted = b.completed ? 1 : 0
      if (aCompleted !== bCompleted) return aCompleted - bCompleted

      // Main list priority rule:
      // 1. My active hall task
      // 2. My next queued/paused hall task
      // 3. Everything else
      const hallStateA = getEffectiveHallState(a)
      const hallStateB = getEffectiveHallState(b)
      const rankA = getEffectiveHallRank(a)
      const rankB = getEffectiveHallRank(b)
      const isNextQueuedA = (hallStateA === 'user_queue' || hallStateA === 'paused') && (
        rankA === nextQueuedRank || (rankA === Infinity && nextQueuedRank === Infinity && !!a.created_at && a.created_at <= nextQueuedCreatedAt)
      )
      const isNextQueuedB = (hallStateB === 'user_queue' || hallStateB === 'paused') && (
        rankB === nextQueuedRank || (rankB === Infinity && nextQueuedRank === Infinity && !!b.created_at && b.created_at <= nextQueuedCreatedAt)
      )
      const hallPriority = (state: string | null, isNextQueued: boolean): number => {
        if (state === 'active') return 0
        if (isNextQueued) return 1
        return 2
      }
      const hpA = hallPriority(hallStateA, isNextQueuedA)
      const hpB = hallPriority(hallStateB, isNextQueuedB)
      if (hpA !== hpB) return hpA - hpB

      // Within the hall queue tier, keep lower queue_rank higher.
      if (hallStateA && hallStateB && ['user_queue', 'paused'].includes(hallStateA) && ['user_queue', 'paused'].includes(hallStateB)) {
        if (rankA !== rankB) return rankA < rankB ? -1 : 1
      }

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
  }, [tasks, effectiveUser, quickFilter, search, statusFilter, sortBy, sortDir, isQueuedTaskForDepartmentUser, isTaskAssignedByOthersToUser, isTaskAssignedToUser, matchesQueueVisibility])

  const paginationSignature = `${quickFilter}|${statusFilter}|${search}|${sortBy}|${sortDir}|${perPage}`
  const currentPage = paginationState.signature === paginationSignature ? paginationState.page : 1
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / perPage))
  const visiblePage = Math.min(currentPage, totalPages)
  const paginatedTasks = useMemo(() => {
    const start = (visiblePage - 1) * perPage
    return filteredTasks.slice(start, start + perPage)
  }, [filteredTasks, visiblePage, perPage])

  const virtualizer = useVirtualizer({
    count: paginatedTasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  })

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

  // Precompute hall queue state once per render — O(n) instead of O(n*n) per card
  const hallQueueState = useMemo(() => {
    const usernameLow = currentUsername.toLowerCase()

    // Helper: check if a multi-assignment task has the given hall_scheduler_state(s) for the current user
    const getMaUserState = (t: Todo): string | null => {
      if (!t.multi_assignment?.enabled) return null
      const entry = t.multi_assignment.assignees.find(
        (a) => (a.username || '').toLowerCase() === usernameLow
      )
      if (!entry) return null
      if (entry.hall_scheduler_state) return entry.hall_scheduler_state
      // Legacy fallback for older MA rows created before hall per-user state existed
      if (entry.ma_approval_status === 'pending_approval') return 'waiting_review'
      if (entry.status === 'in_progress') return 'active'
      if (entry.status === 'completed' || entry.status === 'accepted') return 'completed'
      return 'user_queue'
    }

    const userQueueTasks = tasks.filter((t) => {
      if (t.completed) return false
      // Single-assignment: check top-level scheduler_state + assigned_to
      const topState = (t as unknown as Record<string, unknown>).scheduler_state as string | null
      if ((t.assigned_to || '').toLowerCase() === usernameLow && topState && ['user_queue', 'paused'].includes(topState)) {
        return true
      }
      // Multi-assignment: check per-user hall_scheduler_state inside multi_assignment
      const maState = getMaUserState(t)
      if (maState && ['user_queue', 'paused'].includes(maState)) return true
      return false
    })
    const minQueueRank = userQueueTasks.reduce(
      (min, t) => {
        // For multi-assignment, use per-user hall_queue_rank
        const maEntry = t.multi_assignment?.enabled
          ? t.multi_assignment.assignees.find((a) => (a.username || '').toLowerCase() === usernameLow)
          : null
        const rank = maEntry?.hall_queue_rank ?? ((t as unknown as Record<string, unknown>).queue_rank as number | null) ?? Infinity
        return Math.min(min, rank)
      },
      Infinity
    )
    const minCreatedAt = userQueueTasks.reduce(
      (min, t) => (!min || (t.created_at || '') < min ? t.created_at || '' : min),
      ''
    )
    const hasActiveHallTask = tasks.some((t) => {
      if (t.completed) return false
      // Single-assignment active
      if ((t.assigned_to || '').toLowerCase() === usernameLow &&
          (t as unknown as Record<string, unknown>).scheduler_state === 'active') return true
      // Multi-assignment active
      const maState = getMaUserState(t)
      if (maState === 'active') return true
      return false
    })
    return { userQueueTasks, minQueueRank, minCreatedAt, hasActiveHallTask }
  }, [tasks, currentUsername])

  const cardProps = useCallback((task: Todo) => {
    const { userQueueTasks, minQueueRank, minCreatedAt, hasActiveHallTask } = hallQueueState
    const usernameLow = currentUsername.toLowerCase()
    // Pause is only meaningful when user has other tasks waiting in their queue (user_queue OR paused)
    const hasOtherQueuedTasks = userQueueTasks.some((t) => t.id !== task.id)
    const maEntry = task.multi_assignment?.enabled
      ? task.multi_assignment.assignees.find((a) => (a.username || '').toLowerCase() === usernameLow)
      : null
    const thisRank = maEntry?.hall_queue_rank ?? ((task as unknown as Record<string, unknown>).queue_rank as number | null) ?? Infinity
    // Determine if this task is at the front of the user's hall queue (lowest queue_rank among user_queue + paused tasks)
    const isFirstInQueue = (() => {
      if (thisRank !== Infinity) return thisRank <= minQueueRank
      if (minQueueRank !== Infinity) return false // Other tasks have explicit ranks; null-rank tasks are last
      // All null-ranked: earliest created_at is first in queue
      return !!task.created_at && task.created_at <= minCreatedAt
    })()
    return {
      task,
      currentUsername,
      currentUserRole,
      currentUserDept,
      currentUserTeamMembers,
      currentUserTeamMemberDeptKeys,
      enableQueueAssign,
      hasOtherQueuedTasks,
      isFirstInQueue,
      hasActiveHallTask,
      onEdit: (t: Todo) => setEditTask(t),
      onViewDetail: (t: Todo) => router.push(`/dashboard/tasks/${t.id}`),
      onShare: (t: Todo) => setShareTask(t),
      onRefresh: refresh,
    }
  }, [hallQueueState, currentUsername, currentUserRole, currentUserDept, currentUserTeamMembers, currentUserTeamMemberDeptKeys, enableQueueAssign, refresh, router])

  return (
    <div className="flex h-full flex-col px-3 pb-4 sm:px-4">
      <div className="mb-5 relative z-0">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Total Task', value: scopedKpiStats.total, icon: ListTodo, tone: 'text-[#2B7FFF]', bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', kpiKey: 'total' },
            { label: 'Completed Task', value: scopedKpiStats.completed, icon: CircleCheckBig, tone: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]', kpiKey: 'completed' },
            { label: 'In Progress', value: scopedKpiStats.in_progress, icon: PlayCircle, tone: 'text-[#0891B2]', bg: 'bg-[#ECFEFF]', border: 'border-[#A5F3FC]', kpiKey: 'in_progress' },
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
                    <div className={cn('text-xl font-extrabold leading-none sm:text-[28px]', item.tone)}>{item.value}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">{item.label}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-[#d9e2f0] bg-white shadow-[0_18px_50px_rgba(31,65,132,0.08)]">
        <div className="border-b border-[#e3e9f5] bg-white px-3 py-3 sm:px-5 sm:py-4">
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
                              // clear after short delay so spinner is briefly visible
                              setTimeout(() => setPendingScopeSwitch(null), 100)
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

            <div className="relative min-w-0 flex-1 sm:min-w-[200px] xl:ml-auto xl:max-w-[260px]">
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
              {/* Left controls: Refresh + Select + Bulk */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void refresh()}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>

                <button
                  onClick={toggleSelectAll}
                  className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                >
                  {paginatedTasks.length > 0 && paginatedTasks.every((task) => selected.has(task.id)) ? <CheckSquare size={13} className="text-[#3559d8]" /> : <Square size={13} />}
                  <span className="hidden sm:inline">{selected.size > 0 ? `${selected.size} selected` : 'Select All'}</span>
                  {selected.size > 0 && <span className="sm:hidden">{selected.size}</span>}
                </button>

                {selected.size > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowBulkMenu((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                    >
                      <SlidersHorizontal size={13} />
                      <span className="hidden sm:inline">Bulk Actions</span>
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
              </div>

              {/* Right controls: Sort + count + Add + Export */}
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden font-bold uppercase tracking-[0.16em] text-[#8fa0bf] sm:inline">Sort By:</span>
                <div className="relative">
                  <select
                    value={`${sortBy}_${sortDir}`}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                      const [s, d] = e.target.value.split('_')
                      setSortBy(s as typeof sortBy)
                      setSortDir(d as typeof sortDir)
                    }}
                    className="appearance-none rounded-xl border border-[#d9e2f0] bg-white py-1.5 pl-2 pr-6 text-xs font-semibold text-slate-600 outline-none"
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

                <span className="hidden min-w-fit text-[11px] font-medium text-slate-400 sm:inline">{filteredTasks.length} tasks</span>

                {canAddTask && (
                <button
                  onClick={() => {
                    setAddTaskPending(true)
                    router.push('/dashboard/tasks/new')
                  }}
                  disabled={addTaskPending}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2f66f5] px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(47,102,245,0.28)] transition hover:bg-[#2558dd] disabled:opacity-80 sm:gap-2 sm:px-4 sm:text-sm"
                >
                  {addTaskPending
                    ? <svg className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                    : <Plus size={13} />}
                  <span className="hidden sm:inline">{addTaskPending ? 'Opening...' : 'Add Task'}</span>
                  <span className="sm:hidden">Add</span>
                </button>
                )}

                <button
                  onClick={exportCSV}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[#d9e2f0] bg-white text-slate-500 transition hover:border-[#c4d3ef] hover:text-slate-700 sm:h-10 sm:w-10"
                  title="Export tasks"
                >
                  <Upload size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div ref={parentRef} className="flex-1 overflow-y-auto bg-[#f5f7fc] px-4 py-4 sm:px-5">
          {loading && (
            viewMode === 'kanban' ? <KanbanSkeleton /> : <TaskSkeleton count={10} />
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

          {!loading && filteredTasks.length > 0 && (
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
                  Showing {filteredTasks.length === 0 ? 0 : (visiblePage - 1) * perPage + 1}–{Math.min(visiblePage * perPage, filteredTasks.length)} of {filteredTasks.length}
                </span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPaginationState({ signature: paginationSignature, page: Math.max(1, visiblePage - 1) })}
                    disabled={visiblePage === 1}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    Page {visiblePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPaginationState({ signature: paginationSignature, page: Math.min(totalPages, visiblePage + 1) })}
                    disabled={visiblePage === totalPages}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}

          {!loading && viewMode === 'list' && paginatedTasks.length > 0 && (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const task = paginatedTasks[virtualItem.index]
                if (!task) return null
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    className="pb-3"
                  >
                    <div className="group/row flex items-start gap-2">
                      <button
                        onClick={() => toggleSelect(task.id)}
                        className="mt-5 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-[#3559d8] group-hover/row:opacity-100"
                      >
                        {selected.has(task.id) ? (
                          <CheckSquare size={15} className="text-blue-600 opacity-100" />
                        ) : (
                          <Square size={15} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <TaskCard {...cardProps(task)} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!loading && viewMode === 'kanban' && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
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
                      <SortableContext
                        id={col.key}
                        items={colTasks.map((t) => t.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="min-h-[150px] space-y-2 rounded-xl border border-slate-200 bg-white/50 p-2">
                          {colTasks.map((task) => (
                            <SortableTask key={task.id} task={task} cardProps={cardProps(task)} />
                          ))}
                          {colTasks.length === 0 && (
                            <div className="py-12 text-center text-xs text-slate-300">No tasks</div>
                          )}
                        </div>
                      </SortableContext>
                    </div>
                  )
                })}
              </div>

              <DragOverlay dropAnimation={{
                sideEffects: defaultDropAnimationSideEffects({
                  styles: {
                    active: {
                      opacity: '0.4',
                    },
                  },
                }),
              }}>
                {activeTask ? (
                  <div className="w-72 rotate-3 scale-105 shadow-2xl opacity-90 cursor-grabbing">
                    <TaskCard {...cardProps(activeTask)} compact />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {!loading && viewMode === 'calendar' && (
            <CalendarView tasks={paginatedTasks} onTaskClick={(t) => {
              sessionStorage.setItem('task-detail-back', `/dashboard/tasks?scope=${quickFilter}&status=${statusFilter}`)
              router.push(`/dashboard/tasks/${t.id}`)
            }} />
          )}

          {!loading && totalPages > 1 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfe5f1] bg-white px-4 py-3">
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
                  Showing {(visiblePage - 1) * perPage + 1}–{Math.min(visiblePage * perPage, filteredTasks.length)} of {filteredTasks.length}
                </span>
              </div>
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
      <div className="overflow-x-auto">
      <div className="min-w-[700px] grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
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
    </div>
  )
}

function SortableTask({ task, cardProps }: { task: Todo; cardProps: any }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing outline-none">
      <TaskCard {...cardProps} compact />
    </div>
  )
}
