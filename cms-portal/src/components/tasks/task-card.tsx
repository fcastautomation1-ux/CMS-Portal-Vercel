'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import type { Todo, HistoryEntry, MultiAssignmentEntry, MultiAssignmentSubEntry } from '@/types'
import { cn } from '@/lib/cn'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatPakistanDate, formatPakistanTime } from '@/lib/pakistan-time'
import { splitTaskMeta } from '@/lib/task-metadata'
import { taskDescriptionToPlainText } from '@/lib/task-description'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'
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
  assignQueuedTaskToTeamMemberAction,
  getUsersForAssignment,
  reassignTaskAction,
  updateMaAssigneeStatusAction,
  acceptMaAssigneeAction,
  rejectMaAssigneeAction,
  reopenMaAssigneeAction,
  delegateMaAssigneeAction,
  updateMaSubAssigneeStatusAction,
  acceptMaSubAssigneeAction,
  rejectMaSubAssigneeAction,
  removeMaDelegationAction,
} from '@/app/dashboard/tasks/actions'

interface TaskCardProps {
  task: Todo
  currentUsername: string
  currentUserDept?: string | null
  currentUserTeamMembers?: string[]
  onEdit: (task: Todo) => void
  onViewDetail: (task: Todo) => void
  onShare: (task: Todo) => void
  onDecline: (task: Todo) => void
  onRefresh: () => void
  compact?: boolean
}

type TaskActionDialogState =
  | { type: 'ma-submit' }
  | { type: 'reassign' }
  | { type: 'queue-assign' }
  | { type: 'delegate' }
  | { type: 'sub-submit'; delegatorUsername: string }
  | { type: 'reject-assignee'; assigneeUsername: string }
  | { type: 'reopen-assignee'; assigneeUsername: string }
  | { type: 'reject-sub'; delegatorUsername: string; subUsername: string }
  | { type: 'remove-delegation'; delegatorUsername: string; subUsername: string }
  | null

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
  currentUserTeamMembers = [],
  onEdit,
  onViewDetail,
  onDecline,
  onRefresh,
  compact = false,
}: TaskCardProps) {
  const [isPending, startTransition] = useTransition()
  const [showMa, setShowMa] = useState(true)
  const [taskDialog, setTaskDialog] = useState<TaskActionDialogState>(null)
  const [showCreatorCompleteConfirm, setShowCreatorCompleteConfirm] = useState(false)
  const [showCreatorReopenConfirm, setShowCreatorReopenConfirm] = useState(false)
  const [dialogValue, setDialogValue] = useState('')
  const [dialogExtraValue, setDialogExtraValue] = useState('')
  const [assignableUsers, setAssignableUsers] = useState<Array<{ username: string; role: string; department: string | null; avatar_data: string | null }>>([])

  const isCreator = task.username === currentUsername
  const isAssignee = task.assigned_to === currentUsername
  const isCompleted = task.completed
  const isPendingApproval = task.approval_status === 'pending_approval'
  const pendingApprover = task.pending_approver || task.username

  const ma = task.multi_assignment
  const maEnabled = ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0
  const maDerivedProgress = maEnabled
    ? Math.round(((ma.assignees.filter((entry) => entry.status === 'accepted' || entry.status === 'completed').length) / ma.assignees.length) * 100)
    : 0
  const maProgress = isCompleted ? 100 : (ma?.completion_percentage ?? maDerivedProgress)
  const myMaEntry = maEnabled ? ma.assignees.find((a) => a.username.toLowerCase() === currentUsername.toLowerCase()) : undefined
  const delegatedEntry = maEnabled
    ? ma.assignees.find((entry) => Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase()))
    : undefined
  const myDelegatedEntry = delegatedEntry?.delegated_to?.find((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase())

  const ackNeeded = isAssignee && task.task_status === 'backlog' && !isCompleted
  const showStartBtn = isAssignee && task.task_status === 'todo' && !isCompleted
  const showCompleteBtn = !isCompleted && !isPendingApproval && (isAssignee || isCreator) && task.task_status === 'in_progress'
  const showReopenBtn = isCreator && isCompleted
  const showApproveBtn = isPendingApproval && pendingApprover.toLowerCase() === currentUsername.toLowerCase()
  const queueDeptKey = canonicalDepartmentKey(task.queue_department || '')
  const userDeptKeys = splitDepartmentsCsv(currentUserDept).map((d) => canonicalDepartmentKey(d)).filter(Boolean)
  const showClaimBtn = task.queue_status === 'queued' && !task.assigned_to && !isCompleted &&
    (!queueDeptKey || userDeptKeys.length === 0 || userDeptKeys.includes(queueDeptKey))
  const queueAssignableTeamMembers = currentUserTeamMembers.filter((member) => member && member.toLowerCase() !== currentUsername.toLowerCase())
  const showQueueAssignBtn = showClaimBtn && queueAssignableTeamMembers.length > 0
  const showReassignBtn = !isCompleted && !isPendingApproval && (isAssignee || isCreator) && !!task.assigned_to
  const showMaStartBtn = !!myMaEntry && myMaEntry.status === 'pending' && !isCompleted
  const showMaSubmitBtn = !!myMaEntry && myMaEntry.status === 'in_progress' && !isCompleted
  const showMaDelegateBtn = !!myMaEntry && !isCompleted
  const showDelegatedStartBtn = !!myDelegatedEntry && myDelegatedEntry.status === 'pending' && !isCompleted
  const showDelegatedSubmitBtn = !!myDelegatedEntry && myDelegatedEntry.status === 'in_progress' && !isCompleted

  const hasActions = ackNeeded || showStartBtn || showClaimBtn || showQueueAssignBtn || showReassignBtn || showCompleteBtn || showReopenBtn || showApproveBtn || showMaStartBtn || showMaSubmitBtn || showMaDelegateBtn || showDelegatedStartBtn || showDelegatedSubmitBtn

  const completionTime = isCompleted && task.completed_at && task.created_at ? formatDuration(task.created_at, task.completed_at) : null
  const comments = task.history.filter((h: HistoryEntry) => h.type === 'comment' && !h.is_deleted)
  const unread = comments.filter((h: HistoryEntry) =>
    Array.isArray(h.unread_by) && h.unread_by.some((username) => username.toLowerCase() === currentUsername.toLowerCase())
  )
  const appNames = splitTaskMeta(task.app_name)
  const packageNames = splitTaskMeta(task.package_name)
  const playPkg = packageNames.find((value) => value !== 'Others') ?? null
  const pCfg = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.medium
  const summaryText = task.notes || taskDescriptionToPlainText(task.description)

  useEffect(() => {
    let cancelled = false
    getUsersForAssignment().then((users) => {
      if (!cancelled) setAssignableUsers(users)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const doAction = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    startTransition(async () => {
      const result = await fn()
      if (result.success) onRefresh()
    })
  }

  const openTaskDialog = (dialog: NonNullable<TaskActionDialogState>) => {
    setTaskDialog(dialog)
    setDialogValue('')
    setDialogExtraValue('')
  }

  const closeTaskDialog = () => {
    setTaskDialog(null)
    setDialogValue('')
    setDialogExtraValue('')
  }

  const submitTaskDialog = () => {
    if (!taskDialog) return

    switch (taskDialog.type) {
      case 'ma-submit':
        doAction(() => updateMaAssigneeStatusAction(task.id, 'completed', dialogValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'reassign':
        if (!dialogValue.trim()) return
        doAction(() => reassignTaskAction(task.id, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'queue-assign':
        if (!dialogValue.trim()) return
        doAction(() => assignQueuedTaskToTeamMemberAction(task.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'delegate':
        if (!dialogValue.trim()) return
        doAction(() => delegateMaAssigneeAction(task.id, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'sub-submit':
        doAction(() => updateMaSubAssigneeStatusAction(task.id, taskDialog.delegatorUsername, 'completed', dialogValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'reject-assignee':
        if (!dialogValue.trim()) return
        doAction(() => rejectMaAssigneeAction(task.id, taskDialog.assigneeUsername, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'reopen-assignee':
        if (!dialogValue.trim()) return
        if (!dialogExtraValue.trim()) return
        doAction(() => reopenMaAssigneeAction(task.id, taskDialog.assigneeUsername, dialogValue.trim(), dialogExtraValue.trim()))
        closeTaskDialog()
        return
      case 'reject-sub':
        if (!dialogValue.trim()) return
        doAction(() => rejectMaSubAssigneeAction(task.id, taskDialog.delegatorUsername, taskDialog.subUsername, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'remove-delegation':
        doAction(() => removeMaDelegationAction(task.id, taskDialog.delegatorUsername, taskDialog.subUsername))
        closeTaskDialog()
        return
      default:
        return
    }
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
        {appNames.length > 0 && <p className="mb-0.5 text-[11px] font-semibold text-slate-500">{appNames.join(', ')}</p>}
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
    <>
    <div className={cn(
      'group/row relative flex overflow-hidden rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-[0_12px_28px_rgba(15,23,42,0.06)] transition-all',
      'flex-col md:flex-row',
      isPending && 'pointer-events-none opacity-60',
      isCompleted ? 'bg-slate-50/70' : 'hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.08)]'
    )}>
      <div className={cn('w-1.5 shrink-0 self-stretch', pCfg.stripe)} />

      <div className="flex min-w-0 flex-1 gap-5 px-5 py-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
            {appNames.map((appName) => (
              <span key={appName} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
                {appName}
              </span>
            ))}
            {task.kpi_type && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-600">
                {task.kpi_type}
              </span>
            )}
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">#{task.id.slice(0, 4)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <StatusDot status={task.task_status} ackNeeded={ackNeeded} />
            <Badge label={pCfg.longLabel} cls={pCfg.cls} />
            <button
              onClick={() => onViewDetail(task)}
              className={cn(
                'text-left text-[20px] font-bold leading-tight tracking-[-0.02em]',
                isCompleted ? 'line-through text-slate-400' : 'text-slate-800 hover:text-blue-600'
              )}
            >
              {task.title}
            </button>
          </div>

          {summaryText && (
            <p className="mt-2.5 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-500">
              {summaryText}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {task.username && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <User size={11} className="shrink-0" />
                by <span className="font-semibold text-slate-600">{task.username}</span>
              </span>
            )}
            {task.approval_status === 'pending_approval' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600">
                Waiting for {pendingApprover}
              </span>
            )}
          </div>

          {hasActions && (
            <div className="mt-4 flex flex-wrap gap-2">
              {ackNeeded && <ActBtn onClick={() => doAction(() => acknowledgeTaskAction(task.id))} color="amber">Acknowledge</ActBtn>}
              {showStartBtn && <ActBtn onClick={() => doAction(() => startTaskAction(task.id))} color="blue">Start Work</ActBtn>}
              {showClaimBtn && <ActBtn onClick={() => doAction(() => claimQueuedTaskAction(task.id))} color="violet">Pick Task</ActBtn>}
              {showReassignBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'reassign' })
                  }}
                  color="indigo"
                >
                  Assign To Next
                </ActBtn>
              )}
              {showQueueAssignBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'queue-assign' })
                  }}
                  color="indigo"
                >
                  Assign to Team
                </ActBtn>
              )}
              {showMaStartBtn && <ActBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'in_progress'))} color="indigo">MA: Start</ActBtn>}
              {showMaSubmitBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'ma-submit' })
                  }}
                  color="teal"
                >
                  MA: Submit
                </ActBtn>
              )}
              {showMaDelegateBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'delegate' })
                  }}
                  color="violet"
                >
                  Delegate
                </ActBtn>
              )}
              {showDelegatedStartBtn && <ActBtn onClick={() => doAction(() => updateMaSubAssigneeStatusAction(task.id, delegatedEntry!.username, 'in_progress'))} color="indigo">Sub: Start</ActBtn>}
              {showDelegatedSubmitBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'sub-submit', delegatorUsername: delegatedEntry!.username })
                  }}
                  color="teal"
                >
                  Sub: Submit
                </ActBtn>
              )}
              {showCompleteBtn && (
                <ActBtn
                  onClick={() => {
                    if (isCreator) {
                      setShowCreatorCompleteConfirm(true)
                      return
                    }
                    doAction(() => toggleTodoCompleteAction(task.id, true))
                  }}
                  color="green"
                >
                  Complete
                </ActBtn>
              )}
              {showReopenBtn && (
                <ActBtn
                  onClick={() => {
                    setShowCreatorReopenConfirm(true)
                  }}
                  color="amber"
                >
                  Reopen Task
                </ActBtn>
              )}
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
                        style={{ width: `${maProgress}%` }}
                      />
                    </div>
                  <p className="mt-2 text-xs font-medium text-slate-600">
                    {maProgress}% complete across assigned users
                  </p>
                </div>
                {showMa ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
              </button>
              {showMa && (
                <div className="space-y-2 border-t border-slate-200/80 px-3 pb-3 pt-2">
                  {ma.assignees.map((assignee: MultiAssignmentEntry, i: number) => {
                    const status = isCompleted ? 'accepted' : (assignee.status || 'pending')
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
                              <button
                                onClick={() => {
                                  openTaskDialog({ type: 'reject-assignee', assigneeUsername: assignee.username })
                                }}
                                className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {isCreator && assignee.status === 'accepted' && (
                            <button
                              onClick={() => {
                                openTaskDialog({ type: 'reopen-assignee', assigneeUsername: assignee.username })
                              }}
                              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                            >
                              Reopen
                            </button>
                          )}
                          <button onClick={() => onViewDetail(task)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100">View</button>
                        </div>
                        {Array.isArray(assignee.delegated_to) && assignee.delegated_to.length > 0 && (
                          <div className="w-full rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-3">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                              Delegated To
                            </div>
                            <div className="space-y-2">
                              {assignee.delegated_to.map((sub: MultiAssignmentSubEntry) => {
                                const subStatus = sub.status || 'pending'
                                const isDelegator = assignee.username.toLowerCase() === currentUsername.toLowerCase()
                                const isSubMe = (sub.username || '').toLowerCase() === currentUsername.toLowerCase()
                                return (
                                  <div key={`${assignee.username}-${sub.username}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-white bg-white px-3 py-2">
                                    <span className="text-xs font-semibold text-slate-700">{sub.username}</span>
                                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border', MA_STATUS[subStatus] ?? MA_STATUS.pending)}>
                                      {MA_LABEL[subStatus] ?? subStatus}
                                    </span>
                                    {sub.notes && <span className="text-[11px] text-amber-700">Note: {sub.notes}</span>}
                                    <div className="ml-auto flex flex-wrap gap-2">
                                      {isSubMe && subStatus === 'pending' && (
                                        <button onClick={() => doAction(() => updateMaSubAssigneeStatusAction(task.id, assignee.username, 'in_progress'))} className="rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700">
                                          Start
                                        </button>
                                      )}
                                      {isSubMe && subStatus === 'in_progress' && (
                                        <button
                                          onClick={() => {
                                            openTaskDialog({ type: 'sub-submit', delegatorUsername: assignee.username })
                                          }}
                                          className="rounded-full bg-teal-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-700"
                                        >
                                          Submit
                                        </button>
                                      )}
                                      {isDelegator && subStatus === 'completed' && (
                                        <>
                                          <button onClick={() => doAction(() => acceptMaSubAssigneeAction(task.id, assignee.username, sub.username))} className="rounded-full bg-green-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-green-700">
                                            Accept
                                          </button>
                                          <button
                                            onClick={() => {
                                              openTaskDialog({ type: 'reject-sub', delegatorUsername: assignee.username, subUsername: sub.username })
                                            }}
                                            className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                                          >
                                            Reject
                                          </button>
                                        </>
                                      )}
                                      {isDelegator && (
                                        <button
                                          onClick={() => {
                                            openTaskDialog({ type: 'remove-delegation', delegatorUsername: assignee.username, subUsername: sub.username })
                                          }}
                                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                                        >
                                          Remove
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
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
          {!maEnabled && (
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
          )}

          <div className="flex flex-col items-end gap-2 md:mt-5">
            {task.queue_status === 'queued' && (
              <Badge label={`Queued${task.queue_department ? ` · ${task.queue_department}` : ''}`} cls="bg-sky-50 text-sky-700 border-sky-200" />
            )}
            {maEnabled && (
              <Badge label={`${maProgress}% · ${ma.assignees.length} Assignees`} cls="bg-cyan-50 text-cyan-700 border-cyan-200" />
            )}
            {task.approval_status === 'declined' && (
              <Badge label="Declined" cls="bg-red-50 text-red-600 border-red-200" />
            )}
            {completionTime && (
              <Badge label={`Time ${completionTime}`} cls="bg-emerald-50 text-emerald-700 border-emerald-200" />
            )}
            {showClaimBtn && (
              <button
                onClick={() => doAction(() => claimQueuedTaskAction(task.id))}
                className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700"
              >
                Pick Task
              </button>
            )}
            {showQueueAssignBtn && (
              <button
                onClick={() => {
                  openTaskDialog({ type: 'queue-assign' })
                }}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Assign to Team
              </button>
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
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
              <span className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              {unread.length} new
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
    {taskDialog && (
      <ActionDialog
        title={
          taskDialog.type === 'reassign' ? 'Assign task to next person' :
          taskDialog.type === 'queue-assign' ? 'Assign queued task' :
          taskDialog.type === 'delegate' ? 'Delegate task work' :
          taskDialog.type === 'remove-delegation' ? 'Remove delegation' :
          taskDialog.type === 'reopen-assignee' ? 'Reopen accepted work' :
          taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Send feedback' :
          'Add summary'
        }
        description={
          taskDialog.type === 'reassign' ? 'Move this task to the next assignee without waiting for completion.' :
          taskDialog.type === 'queue-assign' ? 'Assign this department-queue task directly to one of your team members.' :
          taskDialog.type === 'delegate' ? 'Assign this work to another username with optional instructions.' :
          taskDialog.type === 'remove-delegation' ? 'This removes the delegated user from the task workflow.' :
          taskDialog.type === 'reopen-assignee' ? 'Explain why this accepted work should be reopened.' :
          taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Give clear feedback so the work can be corrected.' :
          'Add an optional summary for this submission.'
        }
        primaryLabel={taskDialog.type === 'remove-delegation' ? 'Remove delegation' : taskDialog.type === 'queue-assign' || taskDialog.type === 'reassign' ? 'Assign task' : 'Confirm'}
        onClose={closeTaskDialog}
        onConfirm={submitTaskDialog}
      >
        {taskDialog.type === 'reassign' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Next Assignee</span>
              <select
                value={dialogValue}
                onChange={(e) => setDialogValue(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Select user</option>
                {assignableUsers
                  .filter((user) => user.username !== task.assigned_to && user.username !== currentUsername)
                  .map((user) => (
                    <option key={user.username} value={user.username}>
                      {user.username}{user.department ? ` - ${user.department}` : ''}{user.role ? ` (${user.role})` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <DialogTextarea label="Reason (optional)" value={dialogExtraValue} onChange={setDialogExtraValue} placeholder="Why are you assigning this task to the next person?" />
          </div>
        ) : taskDialog.type === 'queue-assign' ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Team Member</span>
            <select
              value={dialogValue}
              onChange={(e) => setDialogValue(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select team member</option>
              {queueAssignableTeamMembers.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>
          </label>
        ) : taskDialog.type === 'delegate' ? (
          <div className="space-y-3">
            <DialogInput label="Username" value={dialogValue} onChange={setDialogValue} placeholder="Enter username" />
            <DialogTextarea label="Instructions (optional)" value={dialogExtraValue} onChange={setDialogExtraValue} placeholder="Add delegation notes or instructions" />
          </div>
        ) : taskDialog.type === 'remove-delegation' ? (
          <p className="text-sm text-slate-600">Remove delegated access for <span className="font-semibold text-slate-900">{taskDialog.subUsername}</span>?</p>
        ) : taskDialog.type === 'reopen-assignee' ? (
          <div className="space-y-3">
            <DialogTextarea label="Feedback" value={dialogValue} onChange={setDialogValue} placeholder="Explain why this work is reopened" />
            <DialogInput label="New Due Date" value={dialogExtraValue} onChange={setDialogExtraValue} type="datetime-local" min={new Date().toISOString().slice(0, 16)} />
          </div>
        ) : (
          <DialogTextarea
            label={taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit' ? 'Summary (optional)' : 'Feedback'}
            value={dialogValue}
            onChange={setDialogValue}
            placeholder={taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit' ? 'Add work summary or notes' : 'Type feedback here'}
          />
        )}
      </ActionDialog>
    )}
    <ConfirmDialog
      open={showCreatorCompleteConfirm}
      title="Complete this task?"
      description="You created this task. Are you sure you want to complete it? Once confirmed, this task will show as completed for all users."
      confirmLabel={isPending ? 'Completing...' : 'Complete task'}
      onCancel={() => {
        if (isPending) return
        setShowCreatorCompleteConfirm(false)
      }}
      onConfirm={() => {
        doAction(() => toggleTodoCompleteAction(task.id, true))
        setShowCreatorCompleteConfirm(false)
      }}
    />
    <ConfirmDialog
      open={showCreatorReopenConfirm}
      title="Reopen this task?"
      description="Only the task creator can reopen a completed task. This will move the task back to in-progress."
      confirmLabel={isPending ? 'Reopening...' : 'Reopen task'}
      onCancel={() => {
        if (isPending) return
        setShowCreatorReopenConfirm(false)
      }}
      onConfirm={() => {
        doAction(() => toggleTodoCompleteAction(task.id, false))
        setShowCreatorReopenConfirm(false)
      }}
    />
    </>
  )
}

function ActionDialog({
  title,
  description,
  primaryLabel,
  onClose,
  onConfirm,
  children,
}: {
  title: string
  description: string
  primaryLabel: string
  onClose: () => void
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <div className="mb-4">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onConfirm} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function DialogInput({ label, value, onChange, placeholder, type = 'text', min }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; min?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  )
}

function DialogTextarea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  )
}
