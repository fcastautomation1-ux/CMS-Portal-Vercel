'use client'

import { useState, useTransition } from 'react'
import type { Todo, HistoryEntry, MultiAssignmentEntry } from '@/types'
import { cn } from '@/lib/cn'
import { Eye, Edit3, Trash2, Copy, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

// ── Pill badge ───────────────────────────────────────────────────────────────

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', className)}>
      {label}
    </span>
  )
}

function StatusBadge({ status, ackNeeded }: { status: string; ackNeeded?: boolean }) {
  if (ackNeeded) return <Pill label="Waiting Ack" className="bg-orange-100 text-orange-700 border border-orange-200" />
  const map: Record<string, string> = {
    backlog:     'bg-slate-100 text-slate-600 border border-slate-200',
    todo:        'bg-yellow-100 text-yellow-700 border border-yellow-200',
    in_progress: 'bg-green-100 text-green-800 border border-green-200',
    done:        'bg-emerald-100 text-emerald-700 border border-emerald-200',
  }
  const labels: Record<string, string> = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
  return <Pill label={labels[status] ?? status} className={map[status] ?? map.todo} />
}

function PriorityPill({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    urgent: 'bg-red-100 text-red-700 border border-red-200',
    high:   'bg-orange-100 text-orange-700 border border-orange-200',
    medium: 'bg-blue-100 text-blue-700 border border-blue-200',
    low:    'bg-slate-100 text-slate-500 border border-slate-200',
  }
  const labels: Record<string, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' }
  return <Pill label={labels[priority] ?? priority} className={map[priority] ?? map.medium} />
}

function MaStatusPill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    pending:     'bg-yellow-100 text-yellow-700',
    in_progress: 'bg-blue-100 text-blue-700',
    completed:   'bg-purple-100 text-purple-700',
    accepted:    'bg-green-100 text-green-700',
    rejected:    'bg-red-100 text-red-700',
  }
  const labels: Record<string, string> = {
    pending: 'Pending', in_progress: 'In Progress', completed: 'Submitted',
    accepted: 'Accepted', rejected: 'Rejected',
  }
  const s = status || 'pending'
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold', map[s] ?? map.pending)}>{labels[s] ?? s}</span>
}

type BtnColor = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'indigo' | 'teal'
const BTN: Record<BtnColor, string> = {
  green:  'bg-green-600 hover:bg-green-700 text-white',
  blue:   'bg-blue-600 hover:bg-blue-700 text-white',
  amber:  'bg-amber-500 hover:bg-amber-600 text-white',
  red:    'bg-red-100 hover:bg-red-200 text-red-700 border border-red-200',
  violet: 'bg-violet-600 hover:bg-violet-700 text-white',
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  teal:   'bg-teal-600 hover:bg-teal-700 text-white',
}
function ActionBtn({ onClick, color, children }: { onClick: () => void; color: BtnColor; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors', BTN[color])}>
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
  const [showMa, setShowMa] = useState(true)

  const isCreator = task.username === currentUsername
  const isAssignee = task.assigned_to === currentUsername
  const isCompleted = task.completed
  const isPendingApproval = task.approval_status === 'pending_approval'

  const ma = task.multi_assignment
  const maEnabled = ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0
  const myMaEntry = maEnabled ? ma!.assignees.find((a) => (a.username || '').toLowerCase() === currentUsername.toLowerCase()) : undefined

  const ackNeeded = isAssignee && task.task_status === 'backlog' && !isCompleted
  const showStartBtn = isAssignee && task.task_status === 'todo' && !isCompleted
  const showCompleteBtn = !isCompleted && !isPendingApproval && (isAssignee || isCreator) && task.task_status === 'in_progress'
  const showApproveBtn = isCreator && isPendingApproval
  const showClaimBtn = task.queue_status === 'queued' && !task.assigned_to && !isCompleted &&
    (!task.queue_department || !currentUserDept || (task.queue_department || '').toLowerCase() === (currentUserDept || '').toLowerCase())
  const showMaStartBtn = !!myMaEntry && myMaEntry.status === 'pending' && !isCompleted
  const showMaSubmitBtn = !!myMaEntry && myMaEntry.status === 'in_progress' && !isCompleted

  const completionTime = isCompleted && task.completed_at && task.created_at ? formatDuration(task.created_at, task.completed_at) : null
  const comments = task.history.filter((h: HistoryEntry) => h.type === 'comment')
  const unread = comments.filter((h: HistoryEntry) => Array.isArray(h.unread_by) && h.unread_by.includes(currentUsername))
  const playPkg = task.package_name && task.package_name !== 'Others' ? task.package_name : null

  const doAction = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    startTransition(async () => { const r = await fn(); if (r.success) onRefresh() })
  }

  // ── Compact: Kanban card ─────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        className={cn('rounded-xl border bg-white p-3 cursor-pointer hover:border-blue-200 hover:shadow-sm transition-all', isPending && 'opacity-60 pointer-events-none', isCompleted && 'opacity-70')}
        onClick={() => onViewDetail(task)}
      >
        <div className={cn('h-0.5 -mt-3 -mx-3 mb-2.5 rounded-t-xl', { 'bg-red-500': task.priority === 'urgent', 'bg-orange-400': task.priority === 'high', 'bg-blue-400': task.priority === 'medium', 'bg-slate-200': task.priority === 'low' })} />
        {task.app_name && <p className="text-xs font-bold text-slate-800 mb-1">📱 {task.app_name}</p>}
        <p className={cn('text-sm font-semibold leading-snug', isCompleted ? 'line-through text-slate-400' : 'text-slate-800')}>{task.title}</p>
        <div className="flex flex-wrap gap-1 mt-2">
          <StatusBadge status={task.task_status} ackNeeded={ackNeeded} />
          <PriorityPill priority={task.priority} />
        </div>
        {task.assigned_to && (
          <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-blue-500 text-white inline-flex items-center justify-center text-[10px] font-bold shrink-0">{(task.assigned_to || '?').charAt(0).toUpperCase()}</span>
            {task.assigned_to}
          </p>
        )}
        {task.due_date && <p className={cn('text-xs mt-1', isOverdue(task.due_date) && !isCompleted ? 'text-red-500 font-semibold' : 'text-slate-400')}>⏰ {fmtShort(task.due_date)}</p>}
      </div>
    )
  }

  // ── Full: List row ───────────────────────────────────────────────────────
  return (
    <div className={cn('border-b border-slate-100 transition-colors', isPending && 'opacity-60 pointer-events-none', isCompleted ? 'bg-slate-50/50' : 'bg-white hover:bg-blue-50/20')}>
      <div className="px-4 py-3">

        {/* Row 1 – App + category + title  |  actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
            {task.app_name && (
              <span className="font-bold text-slate-800 text-sm shrink-0">📱 {task.app_name}</span>
            )}
            {task.category && (
              <span className="text-[11px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded shrink-0">{task.category}</span>
            )}
            <button onClick={() => onViewDetail(task)} className={cn('text-sm text-left', isCompleted ? 'line-through text-slate-400' : 'text-slate-600 hover:text-blue-600')}>
              {task.title}
            </button>
          </div>

          {/* Icons bar */}
          <div className="flex items-center gap-1 shrink-0">
            {unread.length > 0 && (
              <span className="relative w-5 h-5 inline-flex items-center justify-center">
                <span className="animate-ping absolute w-4 h-4 rounded-full bg-green-400 opacity-40" />
                <span className="relative w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">{unread.length}</span>
              </span>
            )}
            {comments.length > 0 && unread.length === 0 && (
              <span className="text-[10px] text-slate-400 mr-1">💬{comments.length}</span>
            )}
            <button onClick={() => onViewDetail(task)} className="p-1 rounded hover:bg-blue-50 text-blue-500" title="View"><Eye size={15} /></button>
            {isCreator && <button onClick={() => onEdit(task)} className="p-1 rounded hover:bg-blue-50 text-blue-500" title="Edit"><Edit3 size={14} /></button>}
            <button onClick={() => doAction(() => duplicateTodoAction(task.id))} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Duplicate"><Copy size={13} /></button>
            {isCreator && !isCompleted && <button onClick={() => doAction(() => deleteTodoAction(task.id))} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500" title="Delete"><Trash2 size={14} /></button>}
          </div>
        </div>

        {/* Row 2 – Status + badges row */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <StatusBadge status={task.task_status} ackNeeded={ackNeeded} />
          {task.queue_status === 'queued' && (
            <Pill label={`Queued${task.queue_department ? ` · ${task.queue_department}` : ''}`} className="bg-sky-100 text-sky-700 border border-sky-200" />
          )}
          {maEnabled && (
            <Pill label={`${ma!.completion_percentage ?? 0}% · ${ma!.assignees.length} Assignee${ma!.assignees.length !== 1 ? 's' : ''}`} className="bg-cyan-100 text-cyan-700 border border-cyan-200" />
          )}
          {task.assigned_to && (
            <Pill label={task.assigned_to + (task.assignee_department ? ` (${task.assignee_department})` : '')} className="bg-slate-100 text-slate-600 border border-slate-200" />
          )}
          <PriorityPill priority={task.priority} />
          {task.archived && <Pill label="Archived" className="bg-slate-100 text-slate-400 border border-slate-200" />}
          {task.approval_status !== 'approved' && task.approval_status === 'pending_approval' && (
            <Pill label="Pending" className="bg-amber-100 text-amber-700 border border-amber-200" />
          )}
          {task.approval_status === 'declined' && (
            <Pill label="Declined" className="bg-red-100 text-red-700 border border-red-200" />
          )}
          {task.kpi_type && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700 border border-violet-200 whitespace-nowrap">
              {task.kpi_type}
            </span>
          )}
          {completionTime && <Pill label={`⏱ ${completionTime}`} className="bg-green-100 text-green-700 border border-green-200" />}
          {playPkg && (
            <a href={`https://play.google.com/store/apps/details?id=${playPkg}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-full transition-colors">
              <ExternalLink size={10} /> Play Store
            </a>
          )}
        </div>

        {/* Row 3 – Notes / description */}
        {(task.notes || task.description) && (
          <p className="text-xs text-slate-500 italic mt-1.5 line-clamp-1">
            {task.notes || task.description}
          </p>
        )}

        {/* Row 4 – Action buttons */}
        {(ackNeeded || showStartBtn || showCompleteBtn || showApproveBtn || showClaimBtn || showMaStartBtn || showMaSubmitBtn) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {ackNeeded && <ActionBtn onClick={() => doAction(() => acknowledgeTaskAction(task.id))} color="amber">✅ Acknowledge</ActionBtn>}
            {showStartBtn && <ActionBtn onClick={() => doAction(() => startTaskAction(task.id))} color="blue">🚀 Start Work</ActionBtn>}
            {showClaimBtn && <ActionBtn onClick={() => doAction(() => claimQueuedTaskAction(task.id))} color="violet">📥 Pick Task</ActionBtn>}
            {showMaStartBtn && <ActionBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'in_progress'))} color="indigo">🚀 MA: Start</ActionBtn>}
            {showMaSubmitBtn && <ActionBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'completed'))} color="teal">📤 MA: Submit</ActionBtn>}
            {showCompleteBtn && <ActionBtn onClick={() => doAction(() => toggleTodoCompleteAction(task.id, true))} color="green">✅ Complete</ActionBtn>}
            {showApproveBtn && (
              <>
                <ActionBtn onClick={() => doAction(() => approveTodoAction(task.id))} color="green">✅ Approve</ActionBtn>
                <ActionBtn onClick={() => onDecline(task)} color="red">❌ Decline</ActionBtn>
              </>
            )}
          </div>
        )}

        {/* Row 5 – Multi-Assignment Progress Panel */}
        {maEnabled && (
          <div className="mt-2.5 rounded-xl overflow-hidden border border-teal-200 bg-teal-50">
            <button
              className="w-full flex items-center justify-between px-3 py-2 cursor-pointer"
              onClick={() => setShowMa((v) => !v)}
            >
              <span className="text-xs font-bold text-cyan-800">Multi-Assignment Progress</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-cyan-700 font-semibold">
                  {ma!.completion_percentage ?? 0}% Complete · {ma!.assignees.length} Assignee{ma!.assignees.length !== 1 ? 's' : ''}
                </span>
                {showMa ? <ChevronUp size={12} className="text-cyan-600" /> : <ChevronDown size={12} className="text-cyan-600" />}
              </div>
            </button>
            {showMa && (
              <div className="border-t border-cyan-100 divide-y divide-cyan-100">
                {ma!.assignees.map((assignee: MultiAssignmentEntry, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-5 h-5 rounded-full bg-cyan-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {(assignee.username || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 flex-1 min-w-0 truncate">
                      {assignee.username}
                      {task.assignee_department && i === 0 && <span className="font-normal text-slate-400 ml-1">({task.assignee_department})</span>}
                    </span>
                    <MaStatusPill status={assignee.status} />
                    {isCreator && assignee.status === 'completed' && (
                      <>
                        <button onClick={() => doAction(() => acceptMaAssigneeAction(task.id, assignee.username))} className="px-2 py-0.5 bg-green-600 text-white text-xs rounded font-semibold hover:bg-green-700 transition-colors">Accept</button>
                        <button onClick={() => onDecline(task)} className="px-2 py-0.5 bg-red-100 text-red-600 border border-red-200 text-xs rounded font-semibold hover:bg-red-200 transition-colors">Reject</button>
                      </>
                    )}
                    <button onClick={() => onViewDetail(task)} className="px-2 py-0.5 bg-white border border-slate-200 text-slate-500 text-xs rounded font-semibold hover:bg-slate-50 transition-colors">View</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Row 6 – Meta info line */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5 mt-2 text-[11px] text-slate-400 leading-relaxed">
          <span>
            📅 Created: {fmtDate(task.created_at)}
            {task.username && <> by <span className="font-medium text-slate-500">{task.username}</span>{task.creator_department && <span> ({task.creator_department})</span>}</>}
          </span>
          {task.assigned_to && (
            <span>
              👤 Assigned to: <span className="font-medium text-slate-500">{task.assigned_to}</span>
              {task.assignee_department && <span> ({task.assignee_department})</span>}
            </span>
          )}
          {(task.expected_due_date || task.due_date) && (
            <span className={cn(isOverdue(task.due_date) && !isCompleted ? 'text-red-500 font-semibold' : '')}>
              ⏰ Expected: {fmtShort(task.expected_due_date || task.due_date)}
            </span>
          )}
          {task.approval_status === 'pending_approval' && (
            <span className="text-amber-600 font-medium">⏳ Waiting for Approval to Complete</span>
          )}
          {isCreator && !isCompleted && task.task_status === 'done' && (
            <button onClick={() => doAction(() => archiveTodoAction(task.id))} className="text-slate-400 hover:text-slate-600 underline underline-offset-1">Archive</button>
          )}
        </div>

      </div>
    </div>
  )
}
