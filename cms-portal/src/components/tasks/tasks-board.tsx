'use client'

import { useState, useTransition, useCallback } from 'react'
import {
  Plus,
  RefreshCw,
  LayoutList,
  LayoutGrid,
  Calendar,
  Search,
  ChevronDown,
  Download,
  CheckSquare,
  Square,
  Trash2,
  Archive,
  Loader2,
  Inbox,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Todo, TodoStats, TaskStatus } from '@/types'
import { TaskCard } from './task-card'
import { CreateTaskModal } from './create-task-modal'
import { TaskDetailModal } from './task-detail-modal'
import {
  getTodos,
  getTodoStats,
  deleteTodoAction,
  archiveTodoAction,
} from '@/app/dashboard/tasks/actions'

type ViewMode = 'list' | 'kanban' | 'calendar'
type QuickFilter =
  | 'all'
  | 'my_tasks'
  | 'assigned_to_me'
  | 'in_progress'
  | 'completed'
  | 'queued'
  | 'overdue'
  | 'my_approval_pending'
  | 'others_approvals'

const KANBAN_COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'backlog', label: 'Backlog', color: 'bg-slate-100 border-slate-200' },
  { key: 'todo', label: 'To Do', color: 'bg-blue-50 border-blue-200' },
  { key: 'in_progress', label: 'In Progress', color: 'bg-amber-50 border-amber-200' },
  { key: 'done', label: 'Done', color: 'bg-green-50 border-green-200' },
]

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: 'All Tasks' },
  { key: 'my_tasks', label: 'My Tasks' },
  { key: 'assigned_to_me', label: 'Assigned To Me' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'queued', label: 'Queued' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'my_approval_pending', label: 'My Approval Pending' },
  { key: 'others_approvals', label: "Others' Approvals" },
]

interface TasksBoardProps {
  currentUsername: string
  initialTasks: Todo[]
  initialStats: TodoStats
}

export function TasksBoard({ currentUsername, initialTasks, initialStats }: TasksBoardProps) {
  const [tasks, setTasks] = useState<Todo[]>(initialTasks)
  const [stats, setStats] = useState<TodoStats>(initialStats)
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'due_date' | 'priority' | 'created_at' | 'title'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high' | 'medium' | 'low'>('all')

  // Modal state
  const [showCreate, setShowCreate] = useState(false)
  const [editTask, setEditTask] = useState<Todo | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [, setShareTask] = useState<Todo | null>(null)
  const [, setDeclineTask] = useState<Todo | null>(null)

  // Bulk select
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkMenu, setShowBulkMenu] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [fetchedTasks, fetchedStats] = await Promise.all([
      getTodos().catch(() => [] as Todo[]),
      getTodoStats().catch(() => initialStats),
    ])
    setTasks(fetchedTasks)
    setStats(fetchedStats)
    setLoading(false)
    setSelected(new Set())
  }, [initialStats])

  // ── Filter + sort pipeline ──
  const filteredTasks = (() => {
    let list = [...tasks]

    // Quick filter
    const now = new Date()
    if (quickFilter === 'my_tasks') {
      list = list.filter((t) => t.username === currentUsername)
    } else if (quickFilter === 'assigned_to_me') {
      list = list.filter(
        (t) =>
          t.assigned_to === currentUsername ||
          t.multi_assignment?.assignees?.some((a) => a.username === currentUsername)
      )
    } else if (quickFilter === 'in_progress') {
      list = list.filter((t) => t.task_status === 'in_progress')
    } else if (quickFilter === 'completed') {
      list = list.filter((t) => t.task_status === 'done' || t.completed)
    } else if (quickFilter === 'queued') {
      list = list.filter((t) => t.queue_status === 'queued')
    } else if (quickFilter === 'overdue') {
      list = list.filter((t) => !t.completed && t.due_date && new Date(t.due_date) < now)
    } else if (quickFilter === 'my_approval_pending') {
      list = list.filter(
        (t) => t.username === currentUsername && t.approval_status === 'pending_approval'
      )
    } else if (quickFilter === 'others_approvals') {
      list = list.filter(
        (t) => t.assigned_to === currentUsername && t.approval_status === 'pending_approval'
      )
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.package_name?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.assigned_to?.toLowerCase().includes(q)
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((t) => t.task_status === statusFilter)
    }

    // Priority filter
    if (priorityFilter !== 'all') {
      list = list.filter((t) => t.priority === priorityFilter)
    }

    // Sort
    list.sort((a, b) => {
      let va: string | number = 0
      let vb: string | number = 0
      if (sortBy === 'due_date') {
        va = a.due_date ? new Date(a.due_date).getTime() : 0
        vb = b.due_date ? new Date(b.due_date).getTime() : 0
      } else if (sortBy === 'priority') {
        const order = { urgent: 4, high: 3, medium: 2, low: 1 }
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
  })()

  // Bulk actions
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
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selected.size === filteredTasks.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredTasks.map((t) => t.id)))
    }
  }

  // CSV export
  const exportCSV = () => {
    const headers = ['Title', 'Status', 'Priority', 'Assigned To', 'Due Date', 'Package', 'KPI Type']
    const rows = filteredTasks.map((t) => [
      t.title,
      t.task_status,
      t.priority,
      t.assigned_to ?? '',
      t.due_date ?? '',
      t.package_name ?? '',
      t.kpi_type ?? '',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cardProps = (task: Todo) => ({
    task,
    currentUsername,
    onEdit: (t: Todo) => setEditTask(t),
    onViewDetail: (t: Todo) => setDetailTaskId(t.id),
    onShare: (t: Todo) => setShareTask(t),
    onDecline: (t: Todo) => setDeclineTask(t),
    onRefresh: refresh,
  })

  return (
    <div className="flex h-full">
      {/* ── Sidebar quick filters ── */}
      <aside className="w-52 shrink-0 border-r border-slate-100 py-6 px-3 hidden lg:flex flex-col gap-0.5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-2">
          Quick Filters
        </p>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setQuickFilter(f.key)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-xl text-sm transition-colors',
              quickFilter === f.key
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            {f.label}
          </button>
        ))}

        {/* Stats mini cards */}
        <div className="mt-auto pt-6 space-y-2">
          <StatPill label="Overdue" value={stats.overdue} color="red" />
          <StatPill label="Due Today" value={stats.dueToday} color="amber" />
          <StatPill label="In Progress" value={stats.pending} color="blue" />
          <StatPill label="Completed" value={stats.completed} color="green" />
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Action bar */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          {/* Left — create + refresh */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            <Plus size={15} /> New Task
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bulk select indicator */}
          {selected.size > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowBulkMenu((v) => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold"
              >
                {selected.size} selected <ChevronDown size={14} />
              </button>
              {showBulkMenu && (
                <div className="absolute right-0 top-10 bg-white border border-slate-200 rounded-xl shadow-xl z-20 min-w-40 py-1">
                  <button onClick={bulkArchive} className="w-full px-4 py-2.5 text-sm text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                    <Archive size={14}/> Archive All
                  </button>
                  <button onClick={bulkDelete} className="w-full px-4 py-2.5 text-sm text-left text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <Trash2 size={14}/> Delete All
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Export */}
          <button
            onClick={exportCSV}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
            title="Export CSV"
          >
            <Download size={16} />
          </button>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-1">
            {[
              { mode: 'list' as ViewMode, icon: <LayoutList size={16}/> },
              { mode: 'kanban' as ViewMode, icon: <LayoutGrid size={16}/> },
              { mode: 'calendar' as ViewMode, icon: <Calendar size={16}/> },
            ].map(({ mode, icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  viewMode === mode ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                title={mode}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* Search + filters bar */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          {/* Select all */}
          <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600">
            {selected.size === filteredTasks.length && filteredTasks.length > 0 ? (
              <CheckSquare size={18} className="text-blue-600" />
            ) : (
              <Square size={18} />
            )}
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            />
          </div>

          {/* Sort */}
          <select
            value={`${sortBy}_${sortDir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split('_') as [typeof sortBy, typeof sortDir]
              setSortBy(s as typeof sortBy)
              setSortDir(d as typeof sortDir)
            }}
            className="border border-slate-200 rounded-xl px-2.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          >
            <option value="created_at_desc">Newest</option>
            <option value="created_at_asc">Oldest</option>
            <option value="due_date_asc">Due Soonest</option>
            <option value="due_date_desc">Due Latest</option>
            <option value="priority_desc">Highest Priority</option>
            <option value="title_asc">A–Z</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="border border-slate-200 rounded-xl px-2.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="backlog">Backlog</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
            className="border border-slate-200 rounded-xl px-2.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <span className="text-xs text-slate-400 ml-auto">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Task list / kanban / calendar */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-blue-400" />
            </div>
          )}

          {!loading && filteredTasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Inbox size={36} className="text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">No tasks found</p>
              <p className="text-slate-400 text-sm mt-1">
                {search || quickFilter !== 'all'
                  ? 'Try clearing the filters.'
                  : 'Create your first task to get started.'}
              </p>
            </div>
          )}

          {/* List view */}
          {!loading && viewMode === 'list' && filteredTasks.length > 0 && (
            <div className="px-6 py-4 space-y-2">
              {filteredTasks.map((task) => (
                <div key={task.id} className="flex items-start gap-2">
                  <button onClick={() => toggleSelect(task.id)} className="mt-3.5 text-slate-300 hover:text-blue-500">
                    {selected.has(task.id) ? (
                      <CheckSquare size={16} className="text-blue-600" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <TaskCard {...cardProps(task)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Kanban view */}
          {!loading && viewMode === 'kanban' && (
            <div className="flex gap-4 px-6 py-4 overflow-x-auto min-h-full">
              {KANBAN_COLUMNS.map((col) => {
                const colTasks = filteredTasks.filter((t) => t.task_status === col.key)
                return (
                  <div key={col.key} className="flex-none w-72">
                    <div className={cn('rounded-xl border-2 p-1', col.color)}>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm font-bold text-slate-700">{col.label}</span>
                        <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded-full font-medium">
                          {colTasks.length}
                        </span>
                      </div>
                      <div className="space-y-2 p-1 mt-1">
                        {colTasks.map((task) => (
                          <TaskCard key={task.id} {...cardProps(task)} compact />
                        ))}
                        {colTasks.length === 0 && (
                          <div className="text-center py-6 text-xs text-slate-400">No tasks</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Calendar view — minimal stub (full calendar is complex) */}
          {!loading && viewMode === 'calendar' && (
            <CalendarView tasks={filteredTasks} onTaskClick={(t) => setDetailTaskId(t.id)} />
          )}
        </div>
      </main>

      {/* ── Modals ── */}
      {(showCreate || editTask) && (
        <CreateTaskModal
          editTask={editTask}
          onClose={() => { setShowCreate(false); setEditTask(null) }}
          onSaved={refresh}
        />
      )}
      {detailTaskId && (
        <TaskDetailModal
          taskId={detailTaskId}
          currentUsername={currentUsername}
          onClose={() => setDetailTaskId(null)}
          onEdit={(t) => { setDetailTaskId(null); setEditTask(t) }}
          onRefresh={refresh}
        />
      )}
    </div>
  )
}

// ── Stat pill ──
function StatPill({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: 'red' | 'amber' | 'blue' | 'green'
}) {
  const colors = {
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
  }
  return (
    <div className={cn('flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium', colors[color])}>
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

// ── Calendar View — month grid ──
function CalendarView({
  tasks,
  onTaskClick,
}: {
  tasks: Todo[]
  onTaskClick: (task: Todo) => void
}) {
  const today = new Date()
  const [calYear, setCalYear] = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth()) // 0-indexed

  const firstDay = new Date(calYear, calMonth, 1)
  const lastDay = new Date(calYear, calMonth + 1, 0)
  const startDow = firstDay.getDay()
  const daysInMonth = lastDay.getDate()

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

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

  return (
    <div className="px-6 py-4 max-w-4xl">
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => {
            if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1) }
            else setCalMonth((m) => m - 1)
          }}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
        >
          ‹
        </button>
        <span className="font-bold text-slate-800 text-base">{monthLabel}</span>
        <button
          onClick={() => {
            if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1) }
            else setCalMonth((m) => m + 1)
          }}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
        >
          ›
        </button>
        <button
          onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()) }}
          className="ml-2 text-xs text-blue-600 hover:underline"
        >
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-slate-50 text-center text-xs font-semibold text-slate-500 py-2">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const isToday =
            day !== null &&
            day === today.getDate() &&
            calMonth === today.getMonth() &&
            calYear === today.getFullYear()
          const dayTasks = day ? tasksByDay[day] ?? [] : []
          return (
            <div
              key={i}
              className={cn(
                'bg-white min-h-20 p-1.5',
                !day && 'bg-slate-50',
                isToday && 'bg-blue-50 ring-1 ring-inset ring-blue-300'
              )}
            >
              {day && (
                <>
                  <span className={cn('text-xs font-medium', isToday ? 'text-blue-600' : 'text-slate-600')}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayTasks.slice(0, 3).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onTaskClick(t)}
                        className={cn(
                          'w-full text-left px-1.5 py-0.5 rounded text-xs truncate font-medium',
                          t.completed ? 'bg-green-100 text-green-700 line-through' :
                          t.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                          t.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                          'bg-blue-100 text-blue-700'
                        )}
                        title={t.title}
                      >
                        {t.title}
                      </button>
                    ))}
                    {dayTasks.length > 3 && (
                      <span className="text-xs text-slate-400 px-1">+{dayTasks.length - 3} more</span>
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
