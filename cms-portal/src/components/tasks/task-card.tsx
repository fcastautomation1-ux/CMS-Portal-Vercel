'use client'

import { useState, useTransition } from 'react'
import type { Todo, HistoryEntry, MultiAssignmentEntry } from '@/types'
import { cn } from '@/lib/cn'
import {
  Eye, Edit3, Trash2, Copy, ExternalLink,
  ChevronDown, ChevronUp, MessageCircle,
  Calendar, User, Clock,
} from 'lucide-react'
import {
  toggleTodoCompleteAction,
  startTaskAction,
  deleteTodoAction,
  archiveTodoAction,
  approveTodoAction,
  acknowledgeTaskAction,
  duplicateTodoAction,
  claimQueuedTaskAction,
  updateMaAssigneeStatusAction,
  acceptMaAssigneeAction,
} from '@/app/dashboard/tasks/actions'

interface TaskCardProps {
  task: Todo
  currentUsername: string
  currentUserDept?: string | null
  onEdit: (task: Todo) => void
  onViewDetail: (task: Todo) => void
  onShare: (task: Todo) => void
  onDecline: (task: Todo) => void
  onRefresh: () => void
  compact?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  const days = Math.floor(ms / 86_400_000)
  const hrs = Math.floor((ms % 86_400_000) / 3_600_000)
  if (days > 0) return `${days}d ${hrs}h`
  if (hrs > 0) return `${hrs}h`
  return `${Math.floor((ms % 3_600_000) / 60_000)}m`
}

function isOverdue(dateStr: string | null): boolean {
  return !!dateStr && new Date(dateStr).getTime() < Date.now()
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  backlog:     { label: 'Backlog',     cls: 'bg-slate-100 text-slate-600 border-slate-200',   dot: 'bg-slate-400'  },
  todo:        { label: 'To Do',       cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-400' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200',       dot: 'bg-blue-500'   },
  done:        { label: 'Done',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
}
const PRIORITY_CFG: Record<string, { label: string; cls: string; stripe: string }> = {
  urgent: { label: 'Urgent', cls: 'bg-red-50 text-red-600 border-red-200',       stripe: 'bg-red-500'    },
  high:   { label: 'High',   cls: 'bg-orange-50 text-orange-600 border-orange-200', stripe: 'bg-orange-400' },
  medium: { label: 'Medium', cls: 'bg-blue-50 text-blue-600 border-blue-200',    stripe: 'bg-blue-400'   },
  low:    { label: 'Low',    cls: 'bg-slate-100 text-slate-500 border-slate-200', stripe: 'bg-slate-300'  },
}
const MA_STATUS: Record<string, string> = {
  pending:     'bg-yellow-50 text-yellow-700 border-yellow-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  completed:   'bg-purple-50 text-purple-700 border-purple-200',
  accepted:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected:    'bg-red-50 text-red-600 border-red-200',
}
const MA_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Submitted',
  accepted: 'Accepted', rejected: 'Rejected',
}

// ── Small reusable bits ───────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap', cls)}>
      {label}
    </span>
  )
}

function StatusDot({ status, ackNeeded }: { status: string; ackNeeded?: boolean }) {
  if (ackNeeded) {
    const cfg = { label: 'Waiting Ack', cls: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-400' }
    return (
      <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border', cfg.cls)}>
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
        {cfg.label}
      </span>
    )
  }
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.backlog
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border', cfg.cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  )
}

type BtnColor = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'indigo' | 'teal'
const BTN_CLS: Record<BtnColor, string> = {
  green:  'bg-green-600 hover:bg-green-700 text-white',
  blue:   'bg-blue-600 hover:bg-blue-700 text-white',
  amber:  'bg-amber-500 hover:bg-amber-600 text-white',
  red:    'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
  violet: 'bg-violet-600 hover:bg-violet-700 text-white',
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  teal:   'bg-teal-600 hover:bg-teal-700 text-white',
}
function ActBtn({ onClick, color, children }: { onClick: () => void; color: BtnColor; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors', BTN_CLS[color])}>
      {children}
    </button>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TaskCard({
  task,
  currentUsername,
  currentUserDept,
  onEdit,
  onViewDetail,
  onDecline,
  onRefresh,
  compact = false,
}: TaskCardProps) {
  const [isPending, startTransition] = useTransition()
  const [showMa, setShowMa] = useState(false)

  const isCreator      = task.username === currentUsername
  const isAssignee     = task.assigned_to === currentUsername
  const isCompleted    = task.completed
  const isPendingApproval = task.approval_status === 'pending_approval'

  const ma        = task.multi_assignment
  const maEnabled = ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0
  const myMaEntry = maEnabled ? ma!.assignees.find((a) => a.username.toLowerCase() === currentUsername.toLowerCase()) : undefined

  const ackNeeded      = isAssignee && task.task_status === 'backlog' && !isCompleted
  const showStartBtn   = isAssignee && task.task_status === 'todo' && !isCompleted
  const showCompleteBtn = !isCompleted && !isPendingApproval && (isAssignee || isCreator) && task.task_status === 'in_progress'
  const showApproveBtn = isCreator && isPendingApproval
  const showClaimBtn   = task.queue_status === 'queued' && !task.assigned_to && !isCompleted &&
    (!task.queue_department || !currentUserDept || task.queue_department.toLowerCase() === (currentUserDept ?? '').toLowerCase())
  const showMaStartBtn  = !!myMaEntry && myMaEntry.status === 'pending' && !isCompleted
  const showMaSubmitBtn = !!myMaEntry && myMaEntry.status === 'in_progress' && !isCompleted

  const hasActions = ackNeeded || showStartBtn || showCompleteBtn || showApproveBtn || showClaimBtn || showMaStartBtn || showMaSubmitBtn

  const completionTime = isCompleted && task.completed_at && task.created_at ? formatDuration(task.created_at, task.completed_at) : null
  const comments = task.history.filter((h: HistoryEntry) => h.type === 'comment')
  const unread   = comments.filter((h: HistoryEntry) => Array.isArray(h.unread_by) && h.unread_by.includes(currentUsername))
  const playPkg  = task.package_name && task.package_name !== 'Others' ? task.package_name : null
  const pCfg     = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.medium

  const doAction = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    startTransition(async () => { const r = await fn(); if (r.success) onRefresh() })
  }

  // ── Compact: Kanban card ──────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        className={cn(
          'rounded-xl border border-slate-200 bg-white p-3.5 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all overflow-hidden',
          isPending && 'opacity-60 pointer-events-none',
          isCompleted && 'opacity-60'
        )}
        onClick={() => onViewDetail(task)}
      >
        {/* priority top stripe */}
        <div className={cn('h-0.5 -mt-3.5 -mx-3.5 mb-3 rounded-t-xl', pCfg.stripe)} />
        <div className="flex items-start justify-between gap-2 mb-2">
          <StatusDot status={task.task_status} ackNeeded={ackNeeded} />
          <Badge label={pCfg.label} cls={pCfg.cls} />
        </div>
        {task.app_name && <p className="text-[11px] font-semibold text-slate-500 mb-0.5">📱 {task.app_name}</p>}
        <p className={cn('text-sm font-semibold leading-snug', isCompleted ? 'line-through text-slate-400' : 'text-slate-800')}>
          {task.title}
        </p>
        {task.assigned_to && (
          <div className="flex items-center gap-1.5 mt-2.5">
            <span className="w-5 h-5 rounded-full bg-blue-500 text-white inline-flex items-center justify-center text-[10px] font-bold shrink-0">
              {task.assigned_to.charAt(0).toUpperCase()}
            </span>
            <span className="text-[11px] text-slate-500 truncate">{task.assigned_to}</span>
          </div>
        )}
        {task.due_date && (
          <p className={cn('text-[11px] mt-1.5 flex items-center gap-1', isOverdue(task.due_date) && !isCompleted ? 'text-red-500 font-semibold' : 'text-slate-400')}>
            <Calendar size={10} /> {fmtShort(task.due_date)}
          </p>
        )}
      </div>
    )
  }

  // ── Full: List row ────────────────────────────────────────────────────────
  return (
    <div className={cn(
      'group/row relative flex border-b border-slate-100 transition-colors',
      isPending && 'opacity-60 pointer-events-none',
      isCompleted ? 'bg-slate-50/60' : 'bg-white hover:bg-slate-50/70'
    )}>

      {/* Left priority stripe */}
      <div className={cn('w-0.75 shrink-0 self-stretch rounded-l', pCfg.stripe)} />

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0 flex gap-4 px-4 py-3">

        {/* ── Left column: title + notes + action buttons ── */}
        <div className="flex-1 min-w-0">

          {/* App name + category + kpi */}
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {task.app_name && (
              <span className="text-xs font-bold text-slate-700">📱 {task.app_name}</span>
            )}
            {task.category && (
              <span className="text-[10px] bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded font-medium leading-none">
                {task.category}
              </span>
            )}
            {task.kpi_type && (
              <span className="text-[10px] bg-violet-50 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded font-medium leading-none">
                {task.kpi_type}
              </span>
            )}
          </div>

          {/* Title */}
          <button
            onClick={() => onViewDetail(task)}
            className={cn(
              'text-sm font-semibold text-left leading-snug block w-full',
              isCompleted ? 'line-through text-slate-400' : 'text-slate-800 hover:text-blue-600'
            )}
          >
            {task.title}
          </button>

          {/* Notes */}
          {(task.notes || task.description) && (
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1 italic">
              {task.notes || task.description}
            </p>
          )}

          {/* Action buttons */}
          {hasActions && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {ackNeeded && <ActBtn onClick={() => doAction(() => acknowledgeTaskAction(task.id))} color="amber">✅ Acknowledge</ActBtn>}
              {showStartBtn && <ActBtn onClick={() => doAction(() => startTaskAction(task.id))} color="blue">🚀 Start Work</ActBtn>}
              {showClaimBtn && <ActBtn onClick={() => doAction(() => claimQueuedTaskAction(task.id))} color="violet">📥 Pick Task</ActBtn>}
              {showMaStartBtn && <ActBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'in_progress'))} color="indigo">🚀 MA: Start</ActBtn>}
              {showMaSubmitBtn && <ActBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'completed'))} color="teal">📤 MA: Submit</ActBtn>}
              {showCompleteBtn && <ActBtn onClick={() => doAction(() => toggleTodoCompleteAction(task.id, true))} color="green">✅ Complete</ActBtn>}
              {showApproveBtn && (
                <>
                  <ActBtn onClick={() => doAction(() => approveTodoAction(task.id))} color="green">✅ Approve</ActBtn>
                  <ActBtn onClick={() => onDecline(task)} color="red">❌ Decline</ActBtn>
                </>
              )}
            </div>
          )}

          {/* Multi-assignment expand panel */}
          {maEnabled && (
            <div className="mt-2.5 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                onClick={() => setShowMa((v) => !v)}
              >
                <span className="text-xs font-semibold text-slate-600">
                  Multi-Assignment · {ma!.completion_percentage ?? 0}% · {ma!.assignees.length} assignee{ma!.assignees.length !== 1 ? 's' : ''}
                </span>
                {showMa ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
              </button>
              {showMa && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {ma!.assignees.map((assignee: MultiAssignmentEntry, i: number) => {
                    const s = assignee.status || 'pending'
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2">
                        <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {assignee.username.charAt(0).toUpperCase()}
                        </span>
                        <span className="text-xs font-medium text-slate-700 flex-1 min-w-0 truncate">{assignee.username}</span>
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border', MA_STATUS[s] ?? MA_STATUS.pending)}>
                          {MA_LABEL[s] ?? s}
                        </span>
                        {isCreator && assignee.status === 'completed' && (
                          <>
                            <button onClick={() => doAction(() => acceptMaAssigneeAction(task.id, assignee.username))} className="px-2 py-0.5 bg-green-600 text-white text-xs rounded font-semibold hover:bg-green-700 transition-colors">Accept</button>
                            <button onClick={() => onDecline(task)} className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 text-xs rounded font-semibold hover:bg-red-100 transition-colors">Reject</button>
                          </>
                        )}
                        <button onClick={() => onViewDetail(task)} className="px-2 py-0.5 bg-slate-50 border border-slate-200 text-slate-500 text-xs rounded font-semibold hover:bg-slate-100 transition-colors">View</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Meta footer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Clock size={10} className="shrink-0" />
              {fmtDate(task.created_at)}
              {task.username && (
                <> by <span className="font-medium text-slate-500">{task.username}</span>{task.creator_department && <span> ({task.creator_department})</span>}</>
              )}
            </span>
            {task.assigned_to && (
              <span className="flex items-center gap-1">
                <User size={10} className="shrink-0" />
                Assigned to: <span className="font-medium text-slate-500">{task.assigned_to}</span>
                {task.assignee_department && <span> ({task.assignee_department})</span>}
              </span>
            )}
            {(task.expected_due_date || task.due_date) && (
              <span className={cn('flex items-center gap-1', isOverdue(task.due_date) && !isCompleted ? 'text-red-500 font-semibold' : '')}>
                <Calendar size={10} className="shrink-0" />
                Expected: {fmtShort(task.expected_due_date || task.due_date)}
              </span>
            )}
            {task.approval_status === 'pending_approval' && (
              <span className="text-amber-500 font-semibold flex items-center gap-1">⏳ Waiting for Approval</span>
            )}
          </div>
        </div>

        {/* ── Right column: badges ── */}
        <div className="shrink-0 flex flex-col items-end gap-1.5 min-w-35">
          <StatusDot status={task.task_status} ackNeeded={ackNeeded} />
          <Badge label={pCfg.label} cls={pCfg.cls} />

          {task.assigned_to && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border bg-slate-50 text-slate-600 border-slate-200 whitespace-nowrap max-w-40 truncate">
              <User size={10} className="shrink-0" />
              {task.assigned_to}{task.assignee_department ? ` (${task.assignee_department})` : ''}
            </span>
          )}

          {task.queue_status === 'queued' && (
            <Badge label={`Queued${task.queue_department ? ` · ${task.queue_department}` : ''}`} cls="bg-sky-50 text-sky-700 border-sky-200" />
          )}
          {maEnabled && (
            <Badge label={`${ma!.completion_percentage ?? 0}% · ${ma!.assignees.length} Assignees`} cls="bg-cyan-50 text-cyan-700 border-cyan-200" />
          )}
          {task.approval_status === 'declined' && (
            <Badge label="Declined" cls="bg-red-50 text-red-600 border-red-200" />
          )}
          {completionTime && (
            <Badge label={`⏱ ${completionTime}`} cls="bg-emerald-50 text-emerald-700 border-emerald-200" />
          )}
          {playPkg && (
            <a
              href={`https://play.google.com/store/apps/details?id=${playPkg}`}
              target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold rounded-lg transition-colors"
            >
              <ExternalLink size={10} /> Play Store
            </a>
          )}
        </div>

        {/* ── Icon column: action icons ── */}
        <div className="shrink-0 flex flex-col items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          {unread.length > 0 && (
            <span className="relative w-6 h-6 inline-flex items-center justify-center">
              <span className="animate-ping absolute w-4 h-4 rounded-full bg-green-400 opacity-40" />
              <span className="relative w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">{unread.length}</span>
            </span>
          )}
          {comments.length > 0 && unread.length === 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-400 px-1">
              <MessageCircle size={10} />{comments.length}
            </span>
          )}
          <button onClick={() => onViewDetail(task)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition-colors" title="View">
            <Eye size={14} />
          </button>
          {isCreator && (
            <button onClick={() => onEdit(task)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="Edit">
              <Edit3 size={13} />
            </button>
          )}
          <button onClick={() => doAction(() => duplicateTodoAction(task.id))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="Duplicate">
            <Copy size={13} />
          </button>
          {isCreator && !isCompleted && (
            <button onClick={() => doAction(() => deleteTodoAction(task.id))} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
              <Trash2 size={13} />
            </button>
          )}
          {isCreator && !isCompleted && task.task_status === 'done' && (
            <button onClick={() => doAction(() => archiveTodoAction(task.id))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-[10px] font-medium" title="Archive">
              ⬇
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
