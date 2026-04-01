'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Play, Pause, AlertOctagon, CheckCircle, Clock,
  ChevronDown, ChevronUp, RotateCcw, AlertTriangle,
} from 'lucide-react'
import type { Todo, ClusterSettings } from '@/types'
import type { HallOfficeHours } from '@/lib/pakistan-time'
import {
  getRealTimeRemainingMinutes,
  formatWorkMinutes,
  formatRemainingWithUrgency,
} from '@/lib/hall-scheduler'
import {
  formatPakistanDateTime,
  formatPakistanDate,
} from '@/lib/pakistan-time'
import {
  activateHallTaskAction,
  pauseHallTaskAction,
  blockHallTaskAction,
  unblockHallTaskAction,
  completeHallTaskAction,
} from '@/app/dashboard/tasks/actions'

interface HallTaskSchedulerProps {
  tasks: Todo[]
  hallSettings: ClusterSettings
  hallHours: HallOfficeHours
  currentUsername: string
  onRefresh: () => void
}

const STATE_LABELS: Record<string, string> = {
  active:       'Active',
  paused:       'Paused',
  blocked:      'Blocked',
  user_queue:   'Queued',
  waiting_review: 'In Review',
  completed:    'Completed',
}

const STATE_COLORS: Record<string, string> = {
  active:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  paused:       'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  blocked:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  user_queue:   'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  waiting_review: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

// ─── Inline action dialogs ────────────────────────────────────────────────────

function PauseDialog({
  task,
  requireReason,
  onConfirm,
  onCancel,
}: {
  task: Todo
  requireReason: boolean
  onConfirm: (reason?: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="mt-3 p-3 rounded-xl border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 space-y-3">
      <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Pause &quot;{task.title}&quot;?</p>
      {requireReason && (
        <textarea
          rows={2}
          placeholder="Reason for pausing (required)…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-gray-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      )}
      {!requireReason && (
        <textarea
          rows={2}
          placeholder="Reason (optional)…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-white dark:bg-gray-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      )}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => onConfirm(reason.trim() || undefined)}
          disabled={requireReason && !reason.trim()}
          className="flex-1 py-1.5 text-sm rounded-lg bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          Pause
        </button>
      </div>
    </div>
  )
}

function BlockDialog({
  task,
  onConfirm,
  onCancel,
}: {
  task: Todo
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="mt-3 p-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 space-y-3">
      <p className="text-sm font-medium text-red-800 dark:text-red-200">Mark &quot;{task.title}&quot; as blocked?</p>
      <p className="text-xs text-red-600 dark:text-red-400">Countdown stops. You must provide a reason.</p>
      <textarea
        rows={2}
        placeholder="What is blocking this task? (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
      />
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => reason.trim() && onConfirm(reason.trim())}
          disabled={!reason.trim()}
          className="flex-1 py-1.5 text-sm rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          Mark Blocked
        </button>
      </div>
    </div>
  )
}

// ─── Single task card ─────────────────────────────────────────────────────────

function HallTaskCard({
  task,
  hallSettings,
  hallHours,
  onRefresh,
  isUserSelf,
}: {
  task: Todo
  hallSettings: ClusterSettings
  hallHours: HallOfficeHours
  onRefresh: () => void
  isUserSelf: boolean
}) {
  const schedulerState = task.scheduler_state as string | null

  // Real-time remaining minutes (updates every 60s)
  const [remaining, setRemaining] = useState(() =>
    getRealTimeRemainingMinutes(task.remaining_work_minutes, task.active_started_at, hallHours)
  )
  useEffect(() => {
    if (schedulerState !== 'active') return
    const interval = setInterval(() => {
      setRemaining(getRealTimeRemainingMinutes(task.remaining_work_minutes, task.active_started_at, hallHours))
    }, 60_000)
    return () => clearInterval(interval)
  }, [schedulerState, task.remaining_work_minutes, task.active_started_at, hallHours])

  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [showPauseDialog, setShowPauseDialog] = useState(false)
  const [showBlockDialog, setShowBlockDialog] = useState(false)
  const [expanded, setExpanded]       = useState(schedulerState === 'active')

  const urgency = formatRemainingWithUrgency(remaining)
  const effectiveDue = task.effective_due_at
  const requestedDue = task.requested_due_at ?? task.due_date

  async function runAction(fn: () => Promise<{ success: boolean; error?: string }>) {
    setLoading(true); setError(null)
    const res = await fn()
    setLoading(false)
    if (res.success) { onRefresh() } else { setError(res.error ?? 'Action failed.') }
  }

  return (
    <div className={`rounded-xl border transition-all ${
      schedulerState === 'active'
        ? 'border-green-300 dark:border-green-700 bg-white dark:bg-gray-900 shadow-sm'
        : schedulerState === 'blocked'
        ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/10'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
    }`}>
      {/* Card header */}
      <button
        className="w-full flex items-start justify-between gap-3 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[schedulerState ?? 'user_queue'] ?? STATE_COLORS.user_queue}`}>
              {STATE_LABELS[schedulerState ?? 'user_queue'] ?? schedulerState}
            </span>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium}`}>
              {task.priority}
            </span>
            {task.queue_rank != null && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                #{task.queue_rank}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2">
            {task.title}
          </p>
        </div>

        {/* Remaining time badge (active tasks) */}
        {schedulerState === 'active' && task.estimated_work_minutes != null && (
          <div className="shrink-0 text-right">
            <p className={`text-sm font-bold ${urgency.colorClass}`}>{urgency.text}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              of {formatWorkMinutes(task.estimated_work_minutes)}
            </p>
          </div>
        )}

        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          {/* Date info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {requestedDue && (
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Sender deadline</span>
                <span className="text-gray-700 dark:text-gray-300">{formatPakistanDate(requestedDue)}</span>
              </div>
            )}
            {effectiveDue && (
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Effective due</span>
                <span className="text-gray-700 dark:text-gray-300">{formatPakistanDateTime(effectiveDue)}</span>
              </div>
            )}
            {task.estimated_work_minutes != null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Estimated</span>
                <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatWorkMinutes(task.estimated_work_minutes)}
                </span>
              </div>
            )}
            {schedulerState !== 'active' && task.remaining_work_minutes != null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Remaining</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {formatWorkMinutes(task.remaining_work_minutes)}
                </span>
              </div>
            )}
            {task.total_active_minutes != null && task.total_active_minutes > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Worked so far</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {formatWorkMinutes(task.total_active_minutes)}
                </span>
              </div>
            )}
          </div>

          {/* Blocked reason */}
          {schedulerState === 'blocked' && task.blocked_reason && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-red-700 dark:text-red-300">Blocked</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{task.blocked_reason}</p>
              </div>
            </div>
          )}

          {/* Pause reason */}
          {schedulerState === 'paused' && task.pause_reason && (
            <div className="px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-xs text-yellow-700 dark:text-yellow-300">
                <strong>Pause note:</strong> {task.pause_reason}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Inline dialogs */}
          {showPauseDialog && (
            <PauseDialog
              task={task}
              requireReason={hallSettings.require_pause_reason}
              onConfirm={(reason) => {
                setShowPauseDialog(false)
                runAction(() => pauseHallTaskAction(task.id, reason))
              }}
              onCancel={() => setShowPauseDialog(false)}
            />
          )}
          {showBlockDialog && (
            <BlockDialog
              task={task}
              onConfirm={(reason) => {
                setShowBlockDialog(false)
                runAction(() => blockHallTaskAction(task.id, reason))
              }}
              onCancel={() => setShowBlockDialog(false)}
            />
          )}

          {/* Action buttons — only for the task's assignee */}
          {isUserSelf && !showPauseDialog && !showBlockDialog && (
            <div className="flex gap-2 pt-1 flex-wrap">
              {/* Queued → Activate (manual, when auto_start is OFF) */}
              {(schedulerState === 'user_queue' || schedulerState === 'paused') && !hallSettings.auto_start_next_task && (
                <button
                  onClick={() => runAction(() => activateHallTaskAction(task.id))}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  <Play className="h-3.5 w-3.5" />
                  {schedulerState === 'paused' ? 'Resume' : 'Start'}
                </button>
              )}

              {/* Active → Pause */}
              {schedulerState === 'active' && (
                <button
                  onClick={() => setShowPauseDialog(true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </button>
              )}

              {/* Active/Queued/Paused → Block */}
              {['active', 'user_queue', 'paused'].includes(schedulerState ?? '') && (
                <button
                  onClick={() => setShowBlockDialog(true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  <AlertOctagon className="h-3.5 w-3.5" />
                  Block
                </button>
              )}

              {/* Blocked → Unblock */}
              {schedulerState === 'blocked' && (
                <button
                  onClick={() => runAction(() => unblockHallTaskAction(task.id))}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-800 dark:bg-gray-200 dark:hover:bg-white dark:text-gray-900 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Unblock
                </button>
              )}

              {/* Active/Queued/Paused → Complete */}
              {['active', 'user_queue', 'paused'].includes(schedulerState ?? '') && (
                <button
                  onClick={() => runAction(() => completeHallTaskAction(task.id))}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Complete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function HallTaskScheduler({
  tasks,
  hallSettings,
  hallHours,
  currentUsername,
  onRefresh,
}: HallTaskSchedulerProps) {
  const activeTasks  = tasks.filter((t) => t.scheduler_state === 'active')
  const queuedTasks  = tasks.filter((t) => (t.scheduler_state === 'user_queue' || t.scheduler_state === 'paused'))
  const blockedTasks = tasks.filter((t) => t.scheduler_state === 'blocked')

  const refresh = useCallback(() => onRefresh(), [onRefresh])

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No hall tasks</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Tasks assigned to you in this hall will appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Active */}
      {activeTasks.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400 mb-2">
            Active Task
          </h4>
          <div className="space-y-2">
            {activeTasks.map((t) => (
              <HallTaskCard
                key={t.id}
                task={t}
                hallSettings={hallSettings}
                hallHours={hallHours}
                onRefresh={refresh}
                isUserSelf={t.assigned_to === currentUsername}
              />
            ))}
          </div>
        </section>
      )}

      {/* Queued / Paused */}
      {queuedTasks.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
            Queue ({queuedTasks.length})
          </h4>
          <div className="space-y-2">
            {queuedTasks.map((t) => (
              <HallTaskCard
                key={t.id}
                task={t}
                hallSettings={hallSettings}
                hallHours={hallHours}
                onRefresh={refresh}
                isUserSelf={t.assigned_to === currentUsername}
              />
            ))}
          </div>
        </section>
      )}

      {/* Blocked */}
      {blockedTasks.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 mb-2">
            Blocked ({blockedTasks.length})
          </h4>
          <div className="space-y-2">
            {blockedTasks.map((t) => (
              <HallTaskCard
                key={t.id}
                task={t}
                hallSettings={hallSettings}
                hallHours={hallHours}
                onRefresh={refresh}
                isUserSelf={t.assigned_to === currentUsername}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
