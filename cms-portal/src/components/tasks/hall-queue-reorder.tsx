'use client'

import { useState, useCallback } from 'react'
import {
  GripVertical, User, Clock, CheckCircle2,
  AlertOctagon, PauseCircle, RefreshCw, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react'
import type { Todo } from '@/types'
import { formatWorkMinutes, getRealTimeRemainingMinutes } from '@/lib/hall-scheduler'
import type { HallOfficeHours } from '@/lib/pakistan-time'
import { reorderHallUserQueueAction } from '@/app/dashboard/tasks/actions'

interface TeamMemberQueue {
  username: string
  avatar_data: string | null
  tasks: Todo[]
}

interface HallQueueReorderProps {
  clusterId: string
  teamQueues: TeamMemberQueue[]
  hallHours: HallOfficeHours
  onRefresh: () => void
}

const STATE_ICONS: Record<string, React.ReactNode> = {
  active:     <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />,
  paused:     <PauseCircle className="h-3.5 w-3.5 text-yellow-500" />,
  blocked:    <AlertOctagon className="h-3.5 w-3.5 text-red-500" />,
  user_queue: <span className="h-2 w-2 rounded-full bg-gray-400 inline-block" />,
  completed:  <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />,
}

// ─── Drag-and-drop queue for a single user ────────────────────────────────────

function UserQueue({
  member,
  clusterId,
  hallHours,
  onRefresh,
}: {
  member: TeamMemberQueue
  clusterId: string
  hallHours: HallOfficeHours
  onRefresh: () => void
}) {
  const [tasks, setTasks]     = useState<Todo[]>(member.tasks)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const activeTasks = tasks.filter((t) => t.scheduler_state === 'active')
  const reorderableTasks = tasks.filter((t) => t.scheduler_state !== 'active')

  // ── Drag handlers ────────────────────────────────────────────

  function handleDragStart(id: string) {
    setDraggingId(id)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    if (id !== draggingId) setDragOverId(id)
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null); setDragOverId(null); return
    }

    // Only reorder within reorderableTasks
    const updatable = [...reorderableTasks]
    const fromIndex = updatable.findIndex((t) => t.id === draggingId)
    const toIndex   = updatable.findIndex((t) => t.id === targetId)
    if (fromIndex === -1 || toIndex === -1) { setDraggingId(null); setDragOverId(null); return }

    const [moved] = updatable.splice(fromIndex, 1)
    updatable.splice(toIndex, 0, moved)

    // Rebuild full list: active tasks first (rank 1), then reordered
    const newTasks = [...activeTasks, ...updatable]
    setTasks(newTasks)
    setDraggingId(null); setDragOverId(null)
  }

  async function handleSave() {
    setLoading(true); setError(null)
    const ids = tasks.map((t) => t.id)
    const res = await reorderHallUserQueueAction(clusterId, member.username, ids)
    setLoading(false)
    if (res.success) {
      onRefresh()
    } else {
      setError(res.error ?? 'Reorder failed.')
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Member header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          {member.avatar_data ? (
            <img src={member.avatar_data} alt={member.username} className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <User className="h-4 w-4 text-blue-500" />
            </div>
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-white">{member.username}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {/* Task rows */}
      {expanded && (
        <div>
          {tasks.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">No tasks in queue</p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {/* Active task (locked at top) */}
                {activeTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3 bg-green-50/40 dark:bg-green-900/10">
                    <span className="text-gray-300 dark:text-gray-600 cursor-not-allowed">
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <span className="text-xs font-bold text-gray-400 dark:text-gray-500 w-4">1</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {STATE_ICONS.active}
                      <span className="text-sm text-gray-900 dark:text-white truncate">{t.title}</span>
                    </div>
                    <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatWorkMinutes(
                        getRealTimeRemainingMinutes(t.remaining_work_minutes, t.active_started_at, hallHours)
                      )} left
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      active
                    </span>
                  </li>
                ))}

                {/* Reorderable tasks */}
                {reorderableTasks.map((t, index) => {
                  const rank = activeTasks.length + index + 1
                  const isDragging = draggingId === t.id
                  const isDragTarget = dragOverId === t.id
                  return (
                    <li
                      key={t.id}
                      draggable
                      onDragStart={() => handleDragStart(t.id)}
                      onDragOver={(e) => handleDragOver(e, t.id)}
                      onDrop={() => handleDrop(t.id)}
                      onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                      className={`flex items-center gap-3 px-4 py-3 cursor-grab active:cursor-grabbing transition-all ${
                        isDragging   ? 'opacity-40 bg-blue-50 dark:bg-blue-900/10' :
                        isDragTarget ? 'bg-blue-50 dark:bg-blue-900/20 border-t-2 border-blue-400' :
                        'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <GripVertical className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 w-4">{rank}</span>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {STATE_ICONS[t.scheduler_state ?? 'user_queue']}
                        <span className="text-sm text-gray-900 dark:text-white truncate">{t.title}</span>
                      </div>
                      {t.remaining_work_minutes != null && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />
                          {formatWorkMinutes(t.remaining_work_minutes)}
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                        t.scheduler_state === 'blocked' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        t.scheduler_state === 'paused'  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}>
                        {t.scheduler_state ?? 'queue'}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {/* Save button */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                {error && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {error}
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  {loading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Save Order
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function HallQueueReorder({
  clusterId,
  teamQueues,
  hallHours,
  onRefresh,
}: HallQueueReorderProps) {
  const refresh = useCallback(() => onRefresh(), [onRefresh])

  if (teamQueues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <User className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No queued tasks</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Team members&apos; hall task queues will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {teamQueues.map((member) => (
        <UserQueue
          key={member.username}
          member={member}
          clusterId={clusterId}
          hallHours={hallHours}
          onRefresh={refresh}
        />
      ))}
    </div>
  )
}
