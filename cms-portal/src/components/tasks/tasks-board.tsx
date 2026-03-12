'use client'

import { useState, useTransition, useCallback, useMemo } from 'react'
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
  Users,
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
  | 'all' | 'my_tasks' | 'assigned_to_me' | 'in_progress' | 'completed'
  | 'queued' | 'overdue' | 'my_approval_pending' | 'others_approvals'

const KANBAN_COLUMNS: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'backlog',     label: 'Backlog',      dot: 'bg-slate-400' },
  { key: 'todo',        label: 'To Do',        dot: 'bg-yellow-400' },
  { key: 'in_progress', label: 'In Progress',  dot: 'bg-blue-500'  },
  { key: 'done',        label: 'Done',         dot: 'bg-green-500' },
]

interface TasksBoardProps {
  currentUsername: string
  currentUserDept?: string | null
  initialTasks: Todo[]
  initialStats: TodoStats
}

export function TasksBoard({ currentUsername, currentUserDept, initialTasks, initialStats }: TasksBoardProps) {
  const [tasks, setTasks]   = useState<Todo[]>(initialTasks)
  const [stats, setStats]   = useState<TodoStats>(initialStats)
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  const [viewMode, setViewMode]         = useState<ViewMode>('list')
  const [quickFilter, setQuickFilter]   = useState<QuickFilter>('all')
  const [search, setSearch]             = useState('')
  const [sortBy, setSortBy]             = useState<'due_date'|'priority'|'created_at'|'title'>('created_at')
  const [sortDir, setSortDir]           = useState<'asc'|'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<TaskStatus|'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all'|'urgent'|'high'|'medium'|'low'>('all')
  const [deptFilter, setDeptFilter]     = useState('')

  const [showCreate, setShowCreate]   = useState(false)
  const [editTask, setEditTask]       = useState<Todo | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [, setShareTask]   = useState<Todo | null>(null)
  const [, setDeclineTask] = useState<Todo | null>(null)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [showBulkMenu, setShowBulkMenu] = useState(false)

  // Extended computed stats
  const extStats = useMemo(() => ({
    assignedToMe: tasks.filter((t) =>
      t.assigned_to === currentUsername ||
      t.multi_assignment?.assignees?.some((a) => a.username === currentUsername)
    ).length,
    inProgress: tasks.filter((t) => t.task_status === 'in_progress').length,
  }), [tasks, currentUsername])

  // Unique departments from tasks
  const departments = useMemo(() => {
    const depts = new Set<string>()
    tasks.forEach((t) => {
      if (t.creator_department) depts.add(t.creator_department)
      if (t.assignee_department) depts.add(t.assignee_department)
      if (t.queue_department) depts.add(t.queue_department)
    })
    return Array.from(depts).sort()
  }, [tasks])

  const refresh = useCallback(async () => {
    setLoading(true)
    const [ft, fs] = await Promise.all([
      getTodos().catch(() => [] as Todo[]),
      getTodoStats().catch(() => initialStats),
    ])
    setTasks(ft); setStats(fs)
    setLoading(false); setSelected(new Set())
  }, [initialStats])

  const filteredTasks = useMemo(() => {
    const now = new Date()
    let list = [...tasks]

    if (quickFilter === 'my_tasks') {
      list = list.filter((t) => t.username === currentUsername)
    } else if (quickFilter === 'assigned_to_me') {
      list = list.filter((t) => t.assigned_to === currentUsername || t.multi_assignment?.assignees?.some((a) => a.username === currentUsername))
    } else if (quickFilter === 'in_progress') {
      list = list.filter((t) => t.task_status === 'in_progress')
    } else if (quickFilter === 'completed') {
      list = list.filter((t) => t.task_status === 'done' || t.completed)
    } else if (quickFilter === 'queued') {
      list = list.filter((t) => t.queue_status === 'queued')
    } else if (quickFilter === 'overdue') {
      list = list.filter((t) => !t.completed && t.due_date && new Date(t.due_date) < now)
    } else if (quickFilter === 'my_approval_pending') {
      list = list.filter((t) => t.username === currentUsername && t.approval_status === 'pending_approval')
    } else if (quickFilter === 'others_approvals') {
      list = list.filter((t) => t.assigned_to === currentUsername && t.approval_status === 'pending_approval')
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(q) || t.package_name?.toLowerCase().includes(q) || t.app_name?.toLowerCase().includes(q) || t.assigned_to?.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') list = list.filter((t) => t.task_status === statusFilter)
    if (priorityFilter !== 'all') list = list.filter((t) => t.priority === priorityFilter)
    if (deptFilter) list = list.filter((t) => t.creator_department === deptFilter || t.assignee_department === deptFilter || t.queue_department === deptFilter)

    list.sort((a, b) => {
      let va: string | number = 0, vb: string | number = 0
      if (sortBy === 'due_date') { va = a.due_date ? new Date(a.due_date).getTime() : 0; vb = b.due_date ? new Date(b.due_date).getTime() : 0 }
      else if (sortBy === 'priority') { const o = { urgent: 4, high: 3, medium: 2, low: 1 } as Record<string,number>; va = o[a.priority]??0; vb = o[b.priority]??0 }
      else if (sortBy === 'title') { va = a.title.toLowerCase(); vb = b.title.toLowerCase() }
      else { va = new Date(a.created_at).getTime(); vb = new Date(b.created_at).getTime() }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [tasks, quickFilter, search, statusFilter, priorityFilter, deptFilter, sortBy, sortDir, currentUsername])

  const bulkDelete  = () => { startTransition(async () => { await Promise.all([...selected].map((id) => deleteTodoAction(id))); setShowBulkMenu(false); refresh() }) }
  const bulkArchive = () => { startTransition(async () => { await Promise.all([...selected].map((id) => archiveTodoAction(id))); setShowBulkMenu(false); refresh() }) }
  const toggleSelect = (id: string) => { setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const toggleSelectAll = () => { selected.size === filteredTasks.length ? setSelected(new Set()) : setSelected(new Set(filteredTasks.map((t) => t.id))) }

  const exportCSV = () => {
    const rows = filteredTasks.map((t) => [t.title, t.task_status, t.priority, t.assigned_to ?? '', t.due_date ?? '', t.package_name ?? '', t.kpi_type ?? ''])
    const csv = [['Title','Status','Priority','Assigned To','Due Date','Package','KPI Type'], ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `tasks-${new Date().toISOString().slice(0,10)}.csv` })
    a.click()
  }

  const cardProps = (task: Todo) => ({
    task, currentUsername, currentUserDept,
    onEdit: (t: Todo) => setEditTask(t),
    onViewDetail: (t: Todo) => setDetailTaskId(t.id),
    onShare: (t: Todo) => setShareTask(t),
    onDecline: (t: Todo) => setDeclineTask(t),
    onRefresh: refresh,
  })

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 px-4 pt-4 pb-3">
        {[
          { label: 'Total Tasks',     value: stats.total,             icon: '🗂',  colors: ['#312e81','#4f46e5'] },
          { label: 'Assigned To Me',  value: extStats.assignedToMe,   icon: '👤',  colors: ['#0f172a','#1e40af'] },
          { label: 'Completed',       value: stats.completed,         icon: '✅',  colors: ['#14532d','#16a34a'] },
          { label: 'Pending',         value: stats.pending,           icon: '⏳',  colors: ['#78350f','#d97706'] },
          { label: 'In Progress',     value: extStats.inProgress,     icon: '⚡',  colors: ['#365314','#65a30d'] },
          { label: 'Overdue',         value: stats.overdue,           icon: '🔴',  colors: ['#7f1d1d','#dc2626'] },
          { label: 'Due Today',       value: stats.dueToday,          icon: '📅',  colors: ['#4c1d95','#7c3aed'] },
        ].map(({ label, value, icon, colors }) => (
          <div
            key={label}
            className="relative rounded-2xl p-4 overflow-hidden flex items-center gap-3 shadow-sm cursor-pointer hover:scale-[1.02] transition-transform"
            style={{ background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)` }}
          >
            <span className="text-2xl leading-none shrink-0">{icon}</span>
            <div className="min-w-0">
              <p className="text-2xl font-extrabold text-white leading-none">{value}</p>
              <p className="text-[11px] text-white/75 font-medium mt-0.5 leading-snug">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter selects row ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        {/* Quick-filter as dropdown */}
        <select
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value as QuickFilter)}
          className="border border-slate-200 rounded-lg pl-2.5 pr-6 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-400"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <option value="all">All Tasks · {stats.total}</option>
          <option value="my_tasks">My Tasks</option>
          <option value="assigned_to_me">Assigned To Me · {extStats.assignedToMe}</option>
          <option value="in_progress">In Progress · {extStats.inProgress}</option>
          <option value="completed">Completed · {stats.completed}</option>
          <option value="queued">Queued</option>
          <option value="overdue">Overdue · {stats.overdue}</option>
          <option value="my_approval_pending">My Approval Pending</option>
          <option value="others_approvals">Others' Approvals</option>
        </select>

        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="border border-slate-200 rounded-lg pl-2.5 pr-6 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-y border-slate-100" style={{ background: 'var(--color-surface-secondary, #f8fafc)' }}>
        {/* Add Task */}
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors shadow-sm"
        >
          <Plus size={14} /> Add Task
        </button>

        {/* Toolbar btn group */}
        <button onClick={refresh} disabled={loading} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          onClick={() => setQuickFilter('queued')}>
          <Users size={14} /> Dept Queue
        </button>

        {/* Select All */}
        <button onClick={toggleSelectAll} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
          {selected.size > 0 && selected.size === filteredTasks.length
            ? <CheckSquare size={14} className="text-blue-600" />
            : <Square size={14} />}
          {selected.size > 0 ? `${selected.size} selected` : 'Select All'}
        </button>

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="relative">
            <button onClick={() => setShowBulkMenu((v) => !v)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold">
              Bulk Actions <ChevronDown size={13} />
            </button>
            {showBulkMenu && (
              <div className="absolute left-0 top-9 border rounded-xl shadow-xl z-20 min-w-36 py-1" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} onMouseLeave={() => setShowBulkMenu(false)}>
                <button onClick={bulkArchive} className="w-full px-4 py-2 text-sm text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Archive size={13}/>Archive All</button>
                <button onClick={bulkDelete}  className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={13}/>Delete All</button>
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          {([['list','List',<LayoutList size={13}/>],['kanban','Kanban',<LayoutGrid size={13}/>],['calendar','Calendar',<Calendar size={13}/>]] as [ViewMode,string,React.ReactNode][]).map(([mode, label, icon]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn('flex items-center gap-1 px-3 py-1.5 text-xs font-semibold transition-colors border-r last:border-r-0 border-slate-200', viewMode === mode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Export */}
        <button onClick={exportCSV} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors">
          <Download size={14} /> Export
        </button>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 w-44"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
        </div>

        {/* Status + Priority filter */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
          <option value="all">All Status</option>
          <option value="backlog">Backlog</option>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>

        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
          <option value="all">All Priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select value={`${sortBy}_${sortDir}`} onChange={(e) => { const [s,d] = e.target.value.split('_'); setSortBy(s as typeof sortBy); setSortDir(d as typeof sortDir) }}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
          <option value="created_at_desc">Newest</option>
          <option value="created_at_asc">Oldest</option>
          <option value="due_date_asc">Due Soonest</option>
          <option value="priority_desc">Highest Priority</option>
          <option value="title_asc">A–Z</option>
        </select>

        <span className="text-xs text-slate-400">{filteredTasks.length} tasks</span>
      </div>

      {/* ── Task list area ── */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-blue-400" />
          </div>
        )}

        {!loading && filteredTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Inbox size={40} className="text-slate-200 mb-3" />
            <p className="text-slate-500 font-semibold">No tasks found</p>
            <p className="text-slate-400 text-sm mt-1">
              {search || quickFilter !== 'all' ? 'Try clearing filters.' : 'Create your first task to get started.'}
            </p>
          </div>
        )}

        {/* List view */}
        {!loading && viewMode === 'list' && filteredTasks.length > 0 && (
          <div>
            {/* Table header */}
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
              <button onClick={toggleSelectAll} className="text-slate-400 hover:text-blue-600 shrink-0">
                {selected.size > 0 && selected.size === filteredTasks.length ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
              </button>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Task</span>
            </div>
            {filteredTasks.map((task) => (
              <div key={task.id} className="flex items-start gap-2 px-2 group/row">
                <button
                  onClick={() => toggleSelect(task.id)}
                  className="mt-3.5 shrink-0 text-slate-300 hover:text-blue-500 opacity-0 group-hover/row:opacity-100 transition-opacity"
                >
                  {selected.has(task.id) ? <CheckSquare size={15} className="text-blue-600 opacity-100" /> : <Square size={15} />}
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
          <div className="flex gap-3 px-4 py-4 overflow-x-auto min-h-full">
            {KANBAN_COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.task_status === col.key)
              return (
                <div key={col.key} className="flex-none w-72">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2.5 h-2.5 rounded-full', col.dot)} />
                      <span className="text-sm font-bold text-slate-700">{col.label}</span>
                    </div>
                    <span className="text-xs text-slate-400 px-2 py-0.5 rounded-full border border-slate-200 font-medium" style={{ background: 'var(--color-surface)' }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="space-y-2 rounded-2xl border border-slate-100 p-2 min-h-32" style={{ background: 'var(--color-surface)' }}>
                    {colTasks.map((task) => (
                      <TaskCard key={task.id} {...cardProps(task)} compact />
                    ))}
                    {colTasks.length === 0 && (
                      <div className="text-center py-8 text-xs text-slate-300">No tasks</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Calendar view */}
        {!loading && viewMode === 'calendar' && (
          <CalendarView tasks={filteredTasks} onTaskClick={(t) => setDetailTaskId(t.id)} />
        )}
      </div>

      {/* ── Modals ── */}
      {(showCreate || editTask) && (
        <CreateTaskModal editTask={editTask} onClose={() => { setShowCreate(false); setEditTask(null) }} onSaved={refresh} />
      )}
      {detailTaskId && (
        <TaskDetailModal taskId={detailTaskId} currentUsername={currentUsername} onClose={() => setDetailTaskId(null)} onEdit={(t) => { setDetailTaskId(null); setEditTask(t) }} onRefresh={refresh} />
      )}
    </div>
  )
}

// ── Calendar View ─────────────────────────────────────────────────────────────
function CalendarView({ tasks, onTaskClick }: { tasks: Todo[]; onTaskClick: (task: Todo) => void }) {
  const today = new Date()
  const [calYear, setCalYear]   = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())

  const firstDay = new Date(calYear, calMonth, 1)
  const lastDay  = new Date(calYear, calMonth + 1, 0)
  const startDow = firstDay.getDay()
  const daysInMonth = lastDay.getDate()
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const tasksByDay: Record<number, Todo[]> = {}
  tasks.forEach((t) => {
    if (!t.due_date) return
    const d = new Date(t.due_date)
    if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
      const day = d.getDate(); if (!tasksByDay[day]) tasksByDay[day] = []; tasksByDay[day].push(t)
    }
  })

  const monthLabel = firstDay.toLocaleString('default', { month: 'long', year: 'numeric' })

  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1) } else setCalMonth((m) => m - 1) }
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1) } else setCalMonth((m) => m + 1) }

  return (
    <div className="px-4 py-4 max-w-5xl">
      <div className="flex items-center gap-4 mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 text-lg font-bold">‹</button>
        <span className="font-bold text-slate-800">{monthLabel}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 text-lg font-bold">›</button>
        <button onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()) }} className="ml-2 text-xs text-blue-600 hover:underline">Today</button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="bg-slate-50 text-center text-xs font-semibold text-slate-500 py-2">{d}</div>
        ))}
        {cells.map((day, i) => {
          const isToday = day !== null && day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
          const dayTasks = day ? tasksByDay[day] ?? [] : []
          return (
            <div key={i} className={cn('bg-white min-h-20 p-1.5', !day && 'bg-slate-50', isToday && 'bg-blue-50')}>
              {day && (
                <>
                  <span className={cn('inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold mb-1', isToday ? 'bg-blue-600 text-white' : 'text-slate-600')}>
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((t) => (
                      <button key={t.id} onClick={() => onTaskClick(t)}
                        className={cn('w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate font-medium', t.priority === 'urgent' ? 'bg-red-100 text-red-700' : t.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700')}>
                        {t.app_name || t.title}
                      </button>
                    ))}
                    {dayTasks.length > 3 && (
                      <span className="text-[10px] text-slate-400 pl-1">+{dayTasks.length - 3} more</span>
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
