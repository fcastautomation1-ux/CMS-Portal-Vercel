'use client'

import { useState, useTransition } from 'react'
import type { Todo, HistoryEntry, MultiAssignmentEntry } from '@/types'
import { cn } from '@/lib/cn'
import { formatPakistanDate, formatPakistanTime } from '@/lib/pakistan-time'
import { taskDescriptionToPlainText } from '@/lib/task-description'
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

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  return `${formatPakistanDate(iso)} ${formatPakistanTime(iso)} PKT`
}

function fmtShort(iso: string | null): string {
  if (!iso) return '-'
  return formatPakistanDate(iso, { month: 'short', day: 'numeric' })
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return `${formatPakistanTime(iso)} PKT`
}

function fmtMaDue(iso: string | null | undefined): string {
  if (!iso) return 'No date'
  return formatPakistanDate(iso, { month: 'short', day: 'numeric' })
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

const STATUS_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  backlog: { label: 'Pending', cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  todo: { label: 'Pending', cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  done: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
}

const PRIORITY_CFG: Record<string, { label: string; longLabel: string; cls: string; stripe: string }> = {
  urgent: { label: 'Urgent', longLabel: 'Urgent', cls: 'bg-red-50 text-red-600 border-red-200', stripe: 'bg-red-500' },
  high: { label: 'High', longLabel: 'High Priority', cls: 'bg-orange-50 text-orange-600 border-orange-200', stripe: 'bg-orange-400' },
  medium: { label: 'Medium', longLabel: 'Medium Priority', cls: 'bg-blue-50 text-blue-600 border-blue-200', stripe: 'bg-blue-400' },
  low: { label: 'Low', longLabel: 'Low Priority', cls: 'bg-slate-100 text-slate-500 border-slate-200', stripe: 'bg-slate-300' },
}

const MA_STATUS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-purple-50 text-purple-700 border-purple-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
}

const MA_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Submitted',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold', cls)}>
      {label}
    </span>
  )
}

function StatusDot({ status, ackNeeded }: { status: string; ackNeeded?: boolean }) {
  if (ackNeeded) {
    const cfg = { label: 'Waiting Ack', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' }
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', cfg.cls)}>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} />
        {cfg.label}
      </span>
    )
  }
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.backlog
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', cfg.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  )
}

type BtnColor = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'indigo' | 'teal'

const BTN_CLS: Record<BtnColor, string> = {
  green: 'bg-green-600 hover:bg-green-700 text-white',
  blue: 'bg-blue-600 hover:bg-blue-700 text-white',
  amber: 'bg-amber-500 hover:bg-amber-600 text-white',
  red: 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
  violet: 'bg-violet-600 hover:bg-violet-700 text-white',
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  teal: 'bg-teal-600 hover:bg-teal-700 text-white',
}

function ActBtn({ onClick, color, children }: { onClick: () => void; color: BtnColor; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors', BTN_CLS[color])}>
      {children}
    </button>
  )
}

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

  const isCreator = task.username === currentUsername
  const isAssignee = task.assigned_to === currentUsername
  const isCompleted = task.completed
  const isPendingApproval = task.approval_status === 'pending_approval'

  const ma = task.multi_assignment
  const maEnabled = ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0
  const myMaEntry = maEnabled ? ma.assignees.find((a) => a.username.toLowerCase() === currentUsername.toLowerCase()) : undefined

  const ackNeeded = isAssignee && task.task_status === 'backlog' && !isCompleted
  const showStartBtn = isAssignee && task.task_status === 'todo' && !isCompleted
  const showCompleteBtn = !isCompleted && !isPendingApproval && (isAssignee || isCreator) && task.task_status === 'in_progress'
  const showApproveBtn = isCreator && isPendingApproval
  const showClaimBtn = task.queue_status === 'queued' && !task.assigned_to && !isCompleted &&
    (!task.queue_department || !currentUserDept || task.queue_department.toLowerCase() === (currentUserDept ?? '').toLowerCase())
  const showMaStartBtn = !!myMaEntry && myMaEntry.status === 'pending' && !isCompleted
  const showMaSubmitBtn = !!myMaEntry && myMaEntry.status === 'in_progress' && !isCompleted

  const hasActions = ackNeeded || showStartBtn || showCompleteBtn || showApproveBtn || showClaimBtn || showMaStartBtn || showMaSubmitBtn

  const completionTime = isCompleted && task.completed_at && task.created_at ? formatDuration(task.created_at, task.completed_at) : null
  const comments = task.history.filter((h: HistoryEntry) => h.type === 'comment')
  const unread = comments.filter((h: HistoryEntry) => Array.isArray(h.unread_by) && h.unread_by.includes(currentUsername))
  const playPkg = task.package_name && task.package_name !== 'Others' ? task.package_name : null
  const pCfg = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.medium
  const summaryText = task.notes || taskDescriptionToPlainText(task.description)

  const doAction = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    startTransition(async () => {
      const result = await fn()
      if (result.success) onRefresh()
    })
  }

  if (compact) {
    return (
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 transition-all hover:border-blue-300 hover:shadow-sm cursor-pointer',
          isPending && 'pointer-events-none opacity-60',
          isCompleted && 'opacity-60'
        )}
        onClick={() => onViewDetail(task)}
      >
        <div className={cn('mb-3 -mx-3.5 -mt-3.5 h-0.5 rounded-t-xl', pCfg.stripe)} />
        <div className="mb-2 flex items-start justify-between gap-2">
          <StatusDot status={task.task_status} ackNeeded={ackNeeded} />
          <Badge label={pCfg.label} cls={pCfg.cls} />
        </div>
        {task.app_name && <p className="mb-0.5 text-[11px] font-semibold text-slate-500">{task.app_name}</p>}
        <p className={cn('text-sm font-semibold leading-snug', isCompleted ? 'line-through text-slate-400' : 'text-slate-800')}>
          {task.title}
        </p>
        {task.assigned_to && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
              {task.assigned_to.charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-[11px] text-slate-500">{task.assigned_to}</span>
          </div>
        )}
        {task.due_date && (
          <p className={cn('mt-1.5 flex items-center gap-1 text-[11px]', isOverdue(task.due_date) && !isCompleted ? 'font-semibold text-red-500' : 'text-slate-400')}>
            <Calendar size={10} /> {fmtShort(task.due_date)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      'group/row relative flex overflow-hidden rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-[0_12px_28px_rgba(15,23,42,0.06)] transition-all',
      'flex-col md:flex-row',
      isPending && 'pointer-events-none opacity-60',
      isCompleted ? 'bg-slate-50/70' : 'hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.08)]'
    )}>
      <div className={cn('w-1.5 shrink-0 self-stretch', pCfg.stripe)} />

      <div className="flex min-w-0 flex-1 gap-5 px-5 py-5">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusDot status={task.task_status} ackNeeded={ackNeeded} />
            <Badge label={pCfg.longLabel} cls={pCfg.cls} />
            {task.kpi_type && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-600">
                {task.kpi_type}
              </span>
            )}
            {task.app_name && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {task.app_name}
              </span>
            )}
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">#{task.id.slice(0, 4)}</span>
          </div>

          <button
            onClick={() => onViewDetail(task)}
            className={cn(
              'block w-full text-left text-[20px] font-bold leading-tight tracking-[-0.02em]',
              isCompleted ? 'line-through text-slate-400' : 'text-slate-800 hover:text-blue-600'
            )}
          >
            {task.title}
          </button>

          {summaryText && (
            <p className="mt-2.5 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-500">
              {summaryText}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {task.assigned_to && (
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                  {task.assigned_to.charAt(0).toUpperCase()}
                </span>
                {task.assigned_to}
              </span>
            )}
            {task.username && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <User size={11} className="shrink-0" />
                by <span className="font-semibold text-slate-600">{task.username}</span>
              </span>
            )}
            {task.category && (
              <span className="rounded-full bg-[#eef3ff] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a7de8]">
                {task.category}
              </span>
            )}
            {task.approval_status === 'pending_approval' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600">
                Waiting for Approval
              </span>
            )}
          </div>

          {hasActions && (
            <div className="mt-4 flex flex-wrap gap-2">
              {ackNeeded && <ActBtn onClick={() => doAction(() => acknowledgeTaskAction(task.id))} color="amber">Acknowledge</ActBtn>}
              {showStartBtn && <ActBtn onClick={() => doAction(() => startTaskAction(task.id))} color="blue">Start Work</ActBtn>}
              {showClaimBtn && <ActBtn onClick={() => doAction(() => claimQueuedTaskAction(task.id))} color="violet">Pick Task</ActBtn>}
              {showMaStartBtn && <ActBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'in_progress'))} color="indigo">MA: Start</ActBtn>}
              {showMaSubmitBtn && <ActBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'completed'))} color="teal">MA: Submit</ActBtn>}
              {showCompleteBtn && <ActBtn onClick={() => doAction(() => toggleTodoCompleteAction(task.id, true))} color="green">Complete</ActBtn>}
              {showApproveBtn && (
                <>
                  <ActBtn onClick={() => doAction(() => approveTodoAction(task.id))} color="green">Approve</ActBtn>
                  <ActBtn onClick={() => onDecline(task)} color="red">Decline</ActBtn>
                </>
              )}
            </div>
          )}

          {maEnabled && (
            <div className="mt-5 overflow-hidden rounded-[20px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#fdfefe_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/70"
                onClick={() => setShowMa((v) => !v)}
              >
                <div className="min-w-0 flex-1 pr-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Multi Assignment</span>
                    <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-semibold text-cyan-700">
                      {ma.assignees.length} Assignee{ma.assignees.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#2563eb)] transition-all"
                      style={{ width: `${ma.completion_percentage ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs font-medium text-slate-600">
                    {ma.completion_percentage ?? 0}% complete across assigned users
                  </p>
                </div>
                {showMa ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
              </button>
              {showMa && (
                <div className="space-y-2 border-t border-slate-200/80 px-3 pb-3 pt-2">
                  {ma.assignees.map((assignee: MultiAssignmentEntry, i: number) => {
                    const status = assignee.status || 'pending'
                    const assigneeDueDate = assignee.actual_due_date || null
                    const assigneeDueTime = assigneeDueDate ? fmtTime(assigneeDueDate) : ''
                    const assigneeOverdue =
                      !!assigneeDueDate &&
                      !['accepted', 'completed'].includes(status) &&
                      isOverdue(assigneeDueDate)

                    return (
                      <div key={i} className="flex flex-col gap-3 rounded-2xl border border-white bg-white/90 px-4 py-3 shadow-sm md:flex-row md:items-center">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                          {assignee.username.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-800">{assignee.username}</div>
                          <div className="mt-1 text-[11px] text-slate-400">Assigned contributor</div>
                        </div>
                        <div className="min-w-[94px] md:text-right">
                          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Due</div>
                          <div className={cn('text-xs font-semibold', assigneeOverdue ? 'text-red-500' : 'text-slate-700')}>
                            {fmtMaDue(assigneeDueDate)}
                          </div>
                          {assigneeDueTime && (
                            <div className={cn('text-[11px] font-medium', assigneeOverdue ? 'text-red-400' : 'text-slate-400')}>
                              {assigneeDueTime}
                            </div>
                          )}
                        </div>
                        <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border', MA_STATUS[status] ?? MA_STATUS.pending)}>
                          {MA_LABEL[status] ?? status}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          {isCreator && assignee.status === 'completed' && (
                            <>
                              <button onClick={() => doAction(() => acceptMaAssigneeAction(task.id, assignee.username))} className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700">Accept</button>
                              <button onClick={() => onDecline(task)} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100">Reject</button>
                            </>
                          )}
                          <button onClick={() => onViewDetail(task)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100">View</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
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
                {task.assigned_to}
                {task.assignee_department && <span> ({task.assignee_department})</span>}
              </span>
            )}
            {(task.expected_due_date || task.due_date) && (
              <span className={cn('flex items-center gap-1', isOverdue(task.due_date) && !isCompleted ? 'font-semibold text-red-500' : '')}>
                <Calendar size={10} className="shrink-0" />
                Expected: {fmtShort(task.expected_due_date || task.due_date)}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-[132px] shrink-0 flex-row items-stretch justify-between rounded-[20px] border border-slate-200 bg-slate-50/80 p-4 md:min-w-[198px] md:flex-col md:items-stretch md:justify-between">
          <div className="text-left md:text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Expected</div>
            <div className={cn('mt-1 text-base font-bold', isOverdue(task.due_date) && !isCompleted ? 'text-[#e6555f]' : 'text-slate-700')}>
              {task.due_date ? fmtShort(task.due_date) : 'No date'}
            </div>
            {task.due_date && (
              <div className={cn('mt-1 text-xs font-semibold', isOverdue(task.due_date) && !isCompleted ? 'text-[#e6555f]' : 'text-slate-400')}>
                {fmtTime(task.due_date)}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 md:mt-5">
            {task.queue_status === 'queued' && (
              <Badge label={`Queued${task.queue_department ? ` · ${task.queue_department}` : ''}`} cls="bg-sky-50 text-sky-700 border-sky-200" />
            )}
            {maEnabled && (
              <Badge label={`${ma.completion_percentage ?? 0}% · ${ma.assignees.length} Assignees`} cls="bg-cyan-50 text-cyan-700 border-cyan-200" />
            )}
            {task.approval_status === 'declined' && (
              <Badge label="Declined" cls="bg-red-50 text-red-600 border-red-200" />
            )}
            {completionTime && (
              <Badge label={`Time ${completionTime}`} cls="bg-emerald-50 text-emerald-700 border-emerald-200" />
            )}
            {playPkg && (
              <a
                href={`https://play.google.com/store/apps/details?id=${playPkg}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-teal-700"
              >
                <ExternalLink size={10} /> Play Store
              </a>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-row items-center justify-end gap-1.5 border-t border-slate-200/80 px-4 py-3 opacity-90 transition-opacity group-hover/row:opacity-100 md:border-l md:border-t-0 md:px-0 md:py-0 md:pl-4 md:flex-col md:justify-center">
          {unread.length > 0 && (
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <span className="absolute h-4 w-4 animate-ping rounded-full bg-green-400 opacity-40" />
              <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white">{unread.length}</span>
            </span>
          )}
          {comments.length > 0 && unread.length === 0 && (
            <span className="flex items-center gap-0.5 px-1 text-[10px] text-slate-400">
              <MessageCircle size={10} />{comments.length}
            </span>
          )}
          <button onClick={() => onViewDetail(task)} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500" title="View">
            <Eye size={14} />
          </button>
          {isCreator && (
            <button onClick={() => onEdit(task)} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Edit">
              <Edit3 size={13} />
            </button>
          )}
          <button onClick={() => doAction(() => duplicateTodoAction(task.id))} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Duplicate">
            <Copy size={13} />
          </button>
          {isCreator && !isCompleted && (
            <button onClick={() => doAction(() => deleteTodoAction(task.id))} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500" title="Delete">
              <Trash2 size={13} />
            </button>
          )}
          {isCreator && !isCompleted && task.task_status === 'done' && (
            <button onClick={() => doAction(() => archiveTodoAction(task.id))} className="rounded-xl p-2 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Archive">
              ↓
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
