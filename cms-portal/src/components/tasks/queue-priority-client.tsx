'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  RefreshCw, Clock, ExternalLink, User, GripVertical,
  CheckCircle2, PauseCircle, AlertOctagon, ChevronDown, ChevronUp,
} from 'lucide-react'
import Image from 'next/image'
import type { QueuePriorityData } from '@/app/dashboard/tasks/actions'
import { formatWorkMinutes, getRealTimeRemainingMinutes } from '@/lib/hall-scheduler'
import { reorderHallUserQueueAction } from '@/app/dashboard/tasks/actions'
import type { Todo } from '@/types'
import type { HallOfficeHours } from '@/lib/pakistan-time'

interface Props {
  data: QueuePriorityData
}

const STATE_STYLE: Record<string, { label: string; badge: string; row: string }> = {
  active:          { label: 'Active',           badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',   row: 'bg-green-50/40 dark:bg-green-900/10' },
  user_queue:      { label: 'Queued',           badge: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',          row: '' },
  paused:          { label: 'Paused',           badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', row: 'bg-yellow-50/20' },
  blocked:         { label: 'Blocked',          badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',           row: 'bg-red-50/20' },
  waiting_review:  { label: 'Waiting Approval', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', row: 'bg-violet-50/20' },
}

const STATE_ICONS: Record<string, React.ReactNode> = {
  active:         <span className="h-2 w-2 rounded-full bg-green-500 inline-block animate-pulse" />,
  paused:         <PauseCircle className="h-3.5 w-3.5 text-yellow-500" />,
  blocked:        <AlertOctagon className="h-3.5 w-3.5 text-red-500" />,
  user_queue:     <span className="h-2 w-2 rounded-full bg-gray-400 inline-block" />,
  completed:      <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />,
  waiting_review: <span className="h-2 w-2 rounded-full bg-violet-400 inline-block" />,
}

function TaskRow({
  task, rank, isDraggable, isDragging, isDragTarget, hallHours, onViewTask,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  task: Todo
  rank: number
  isDraggable: boolean
  isDragging: boolean
  isDragTarget: boolean
  hallHours: HallOfficeHours
  onViewTask: (id: string) => void
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
}) {
  const state = task.scheduler_state ?? 'user_queue'
  const style = STATE_STYLE[state] ?? STATE_STYLE.user_queue
  const remaining = getRealTimeRemainingMinutes(task.remaining_work_minutes, task.active_started_at, hallHours)

  return (
    <li
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-3 px-4 py-2.5 transition-all ${style.row} ${
        isDragging   ? 'opacity-40 bg-blue-50 dark:bg-blue-900/10' :
        isDragTarget ? 'border-t-2 border-blue-400 bg-blue-50 dark:bg-blue-900/20' :
        !isDraggable ? '' : 'cursor-grab active:cursor-grabbing hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      {isDraggable
        ? <GripVertical className="h-4 w-4 text-gray-400 shrink-0" />
        : <span className="h-4 w-4 shrink-0" />
      }
      <span className="text-xs font-bold text-gray-400 w-4 shrink-0">{rank}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {STATE_ICONS[state]}
        <span className="text-sm text-gray-900 dark:text-white truncate">{task.title}</span>
      </div>
      {remaining != null && (
        <span suppressHydrationWarning className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <Clock className="h-3 w-3" />
          {formatWorkMinutes(remaining)}
        </span>
      )}
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${style.badge}`}>
        {style.label}
      </span>
      <button
        type="button"
        onClick={() => onViewTask(task.id)}
        className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shrink-0"
        title="View task details"
      >
        <ExternalLink className="h-3 w-3" />
        View
      </button>
    </li>
  )
}

function DraggableQueue({
  member, clusterId, hallHours, onRefresh, onViewTask, canReorder,
}: {
  member: { username: string; avatar_data: string | null; tasks: Todo[] }
  clusterId: string
  hallHours: HallOfficeHours
  onRefresh: () => void
  onViewTask: (id: string) => void
  canReorder: boolean
}) {
  const [tasks, setTasks] = useState<Todo[]>(member.tasks)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const activeTasks = tasks.filter((t) => t.scheduler_state === 'active')
  const reorderableTasks = tasks.filter((t) => t.scheduler_state !== 'active')

  function handleDragStart(id: string) { setDraggingId(id) }
  function handleDragOver(e: React.DragEvent, id: string) { e.preventDefault(); if (id !== draggingId) setDragOverId(id) }
  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return }
    const updated = [...reorderableTasks]
    const from = updated.findIndex((t) => t.id === draggingId)
    const to = updated.findIndex((t) => t.id === targetId)
    if (from === -1 || to === -1) { setDraggingId(null); setDragOverId(null); return }
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    setTasks([...activeTasks, ...updated])
    setDraggingId(null); setDragOverId(null)
  }

  async function handleSave() {
    setSaving(true); setSaveError(null)
    const res = await reorderHallUserQueueAction(clusterId, member.username, tasks.map((t) => t.id))
    setSaving(false)
    if (res.success) onRefresh()
    else setSaveError(res.error ?? 'Reorder failed.')
  }

  if (tasks.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-gray-400">No tasks in queue</p>
  }

  return (
    <div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {activeTasks.map((t, i) => (
          <TaskRow key={t.id} task={t} rank={i + 1} isDraggable={false} isDragging={false} isDragTarget={false} hallHours={hallHours} onViewTask={onViewTask} />
        ))}
        {reorderableTasks.map((t, i) => {
          const isDragging = draggingId === t.id
          const isDragTarget = dragOverId === t.id
          return (
            <TaskRow
              key={t.id} task={t} rank={activeTasks.length + i + 1}
              isDraggable={canReorder} isDragging={isDragging} isDragTarget={isDragTarget}
              hallHours={hallHours} onViewTask={onViewTask}
              onDragStart={() => handleDragStart(t.id)}
              onDragOver={(e) => handleDragOver(e, t.id)}
              onDrop={() => handleDrop(t.id)}
              onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
            />
          )
        })}
      </ul>
      {canReorder && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
          {saveError && <span className="text-xs text-red-500">{saveError}</span>}
          <button
            type="button" onClick={handleSave} disabled={saving}
            className="ml-auto flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-1.5 text-sm font-semibold text-white transition"
          >
            {saving ? 'Saving\u2026' : 'Save Order'}
          </button>
        </div>
      )}
    </div>
  )
}

function UserCard({
  member, clusterId, hallHours, onRefresh, onViewTask, canReorder,
}: {
  member: { username: string; avatar_data: string | null; tasks: Todo[] }
  clusterId: string
  hallHours: HallOfficeHours
  onRefresh: () => void
  onViewTask: (id: string) => void
  canReorder: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          {member.avatar_data ? (
            <Image src={member.avatar_data} alt={member.username} width={28} height={28} className="h-7 w-7 rounded-full object-cover" unoptimized />
          ) : (
            <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <User className="h-4 w-4 text-blue-500" />
            </div>
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-white">{member.username}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{member.tasks.length} task{member.tasks.length !== 1 ? 's' : ''}</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {expanded && (
        <DraggableQueue
          member={member} clusterId={clusterId} hallHours={hallHours}
          onRefresh={onRefresh} onViewTask={onViewTask} canReorder={canReorder}
        />
      )}
    </div>
  )
}

export function QueuePriorityClient({ data }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selectedUser, setSelectedUser] = useState<string>('me')
  const [search, setSearch] = useState('')

  const handleRefresh = useCallback(() => {
    startTransition(() => router.refresh())
  }, [router])

  const handleViewTask = useCallback((taskId: string) => {
    sessionStorage.setItem('task-detail-back', '/dashboard/tasks/queue-priority')
    router.push(`/dashboard/tasks/${taskId}`)
  }, [router])

  const showAll = data.isManager && selectedUser === 'all'
  const showMine = selectedUser === 'me'
  const specificMember = (!showMine && !showAll)
    ? data.teamQueues.find((q) => q.username === selectedUser) ?? null
    : null

  const filteredTeamQueues = showAll
    ? (search ? data.teamQueues.filter((q) => q.username.toLowerCase().includes(search.toLowerCase())) : data.teamQueues)
    : []

  const myMember = { username: 'My Queue', avatar_data: null, tasks: data.myTasks }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedUser}
          onChange={(e) => { setSelectedUser(e.target.value); setSearch('') }}
          className="h-10 rounded-lg px-3 text-sm outline-none min-w-48"
          style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <option value="me">My Queue</option>
          {data.isManager && data.teamQueues.map((q) => (
            <option key={q.username} value={q.username}>{q.username}</option>
          ))}
          {data.isManager && <option value="all">— All Team Members —</option>}
        </select>

        {showAll && (
          <input
            type="text" placeholder="Filter by username\u2026" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 flex-1 min-w-40 rounded-lg px-3 text-sm outline-none"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
        )}

        <button
          type="button" onClick={handleRefresh}
          className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 px-4 text-sm font-semibold text-slate-600 dark:text-slate-300 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* My queue */}
      {showMine && (
        data.myTasks.length === 0
          ? <div className="rounded-xl border border-gray-200 dark:border-gray-700 py-12 text-center text-sm text-gray-400">Your queue is empty</div>
          : <UserCard member={myMember} clusterId={data.clusterId} hallHours={data.hallHours} onRefresh={handleRefresh} onViewTask={handleViewTask} canReorder={false} />
      )}

      {/* Specific team member */}
      {specificMember && (
        specificMember.tasks.length === 0
          ? <div className="rounded-xl border border-gray-200 dark:border-gray-700 py-12 text-center text-sm text-gray-400">{specificMember.username}&apos;s queue is empty</div>
          : <UserCard member={specificMember} clusterId={data.clusterId} hallHours={data.hallHours} onRefresh={handleRefresh} onViewTask={handleViewTask} canReorder={data.isManager} />
      )}

      {/* All team members */}
      {showAll && (
        filteredTeamQueues.length === 0
          ? <div className="rounded-xl border border-gray-200 dark:border-gray-700 py-12 text-center text-sm text-gray-400">No active team queues</div>
          : <div className="space-y-3">
              {filteredTeamQueues.map((member) => (
                <UserCard key={member.username} member={member} clusterId={data.clusterId} hallHours={data.hallHours} onRefresh={handleRefresh} onViewTask={handleViewTask} canReorder={true} />
              ))}
            </div>
      )}
    </div>
  )
}
