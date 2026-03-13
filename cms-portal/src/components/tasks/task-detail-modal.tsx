'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  X,
  MessageCircle,
  Paperclip,
  Edit3,
  Trash2,
  Archive,
  Loader2,
  UserPlus,
  UserMinus,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock,
  User,
  Tag,
  Calendar,
  Flag,
  Building2,
  AlignLeft,
  Target,
  Link2,
  CheckCheck,
  Send,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { normalizeTaskDescription } from '@/lib/task-description'
import { format, formatDistanceToNow } from 'date-fns'
import type { Todo, TodoDetails, HistoryEntry } from '@/types'
import {
  getTodoDetails,
  addCommentAction,
  toggleTodoCompleteAction,
  startTaskAction,
  approveTodoAction,
  declineTodoAction,
  shareTodoAction,
  unshareTodoAction,
  deleteTodoAction,
  archiveTodoAction,
} from '@/app/dashboard/tasks/actions'

interface TaskDetailModalProps {
  taskId: string
  currentUsername: string
  onClose: () => void
  onEdit: (task: Todo) => void
  onRefresh: () => void
}

// ── status / priority colours ────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  backlog:     { label: 'Backlog',     bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400'  },
  todo:        { label: 'To Do',       bg: 'bg-yellow-50',  text: 'text-yellow-700', dot: 'bg-yellow-400' },
  in_progress: { label: 'In Progress', bg: 'bg-blue-50',    text: 'text-blue-700',   dot: 'bg-blue-500'   },
  done:        { label: 'Done',        bg: 'bg-green-50',   text: 'text-green-700',  dot: 'bg-green-500'  },
}
const PRIORITY_META: Record<string, { label: string; bg: string; text: string; bar: string }> = {
  urgent: { label: 'Urgent', bg: 'bg-red-100',    text: 'text-red-700',    bar: 'bg-red-500'    },
  high:   { label: 'High',   bg: 'bg-orange-100', text: 'text-orange-700', bar: 'bg-orange-500' },
  medium: { label: 'Medium', bg: 'bg-yellow-100', text: 'text-yellow-700', bar: 'bg-yellow-500' },
  low:    { label: 'Low',    bg: 'bg-green-100',  text: 'text-green-700',  bar: 'bg-green-500'  },
}

// ── history event styles ─────────────────────────────────────────────────────
const EVT_META: Record<string, { label: string; iconBg: string; iconText: string; emoji: string }> = {
  created:              { label: 'Task Created',          iconBg: 'bg-blue-100',   iconText: 'text-blue-600',   emoji: '✨' },
  assigned:             { label: 'Assigned',              iconBg: 'bg-purple-100', iconText: 'text-purple-600', emoji: '👤' },
  started:              { label: 'In Progress',           iconBg: 'bg-sky-100',    iconText: 'text-sky-600',    emoji: '🚀' },
  status_change:        { label: 'Status Changed',        iconBg: 'bg-slate-100',  iconText: 'text-slate-600',  emoji: '🔄' },
  completed:            { label: 'Completed',             iconBg: 'bg-green-100',  iconText: 'text-green-600',  emoji: '✅' },
  completion_submitted: { label: 'Submitted for Approval',iconBg: 'bg-amber-100',  iconText: 'text-amber-600',  emoji: '📤' },
  approved:             { label: 'Approved',              iconBg: 'bg-green-100',  iconText: 'text-green-600',  emoji: '👍' },
  declined:             { label: 'Declined',              iconBg: 'bg-red-100',    iconText: 'text-red-600',    emoji: '👎' },
  edit:                 { label: 'Task Edited',           iconBg: 'bg-blue-100',   iconText: 'text-blue-600',   emoji: '✏️' },
  acknowledged:         { label: 'Acknowledged',          iconBg: 'bg-slate-100',  iconText: 'text-slate-600',  emoji: '👀' },
  comment:              { label: 'Comment Added',         iconBg: 'bg-slate-100',  iconText: 'text-slate-600',  emoji: '💬' },
  uncompleted:          { label: 'Reopened',              iconBg: 'bg-orange-100', iconText: 'text-orange-600', emoji: '↩️' },
}

// ── next step label logic ────────────────────────────────────────────────────
function nextStepLabel(task: TodoDetails): string | null {
  if (task.completed) return null
  if (task.approval_status === 'pending_approval') return 'Waiting for creator approval'
  if (task.task_status === 'in_progress') return 'Pending action from assigned agent'
  if (task.task_status === 'backlog' || task.task_status === 'todo') return 'Waiting to be started'
  return null
}

function fmtTs(ts: string) {
  try { return format(new Date(ts), 'MMM d, yyyy \'at\' hh:mm aa') } catch { return ts }
}

export function TaskDetailModal({
  taskId,
  currentUsername,
  onClose,
  onEdit,
  onRefresh,
}: TaskDetailModalProps) {
  const [details, setDetails] = useState<TodoDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'files' | 'share'>('info')
  const [comment, setComment] = useState('')
  const [shareUsername, setShareUsername] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [showDeclineInput, setShowDeclineInput] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false
    getTodoDetails(taskId).then((res) => {
      if (!cancelled) { setDetails(res); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [taskId])

  const doAction = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setActionError('')
    startTransition(async () => {
      const res = await fn()
      if (res.success) {
        const updated = await getTodoDetails(taskId)
        setDetails(updated)
        onRefresh()
      } else {
        setActionError(res.error ?? 'Action failed')
      }
    })
  }

  if (loading) return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-blue-400" />
      </div>
    </ModalShell>
  )

  if (!details) return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-center h-64 text-slate-400">Task not found.</div>
    </ModalShell>
  )

  const t = details
  const isCreator = t.username === currentUsername
  const isAssignee = t.assigned_to === currentUsername
  const isPendingApproval = t.approval_status === 'pending_approval'
  const isCompleted = t.completed
  const sm = STATUS_META[t.task_status] ?? STATUS_META.backlog
  const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.medium

  const comments     = t.history.filter((h: HistoryEntry) => h.type === 'comment')
  const historyEvts  = t.history.filter((h: HistoryEntry) => h.type !== 'comment')
  const nextStep     = nextStepLabel(t)

  const TABS = [
    { id: 'info',    label: 'Details' },
    { id: 'history', label: `Activity${historyEvts.length ? ` (${historyEvts.length})` : ''}` },
    { id: 'files',   label: `Files${t.attachments.length ? ` (${t.attachments.length})` : ''}` },
    { id: 'share',   label: `Shared${t.shares.length ? ` (${t.shares.length})` : ''}` },
  ] as const

  return (
    <ModalShell onClose={onClose}>
      {/* ── Colour accent bar ── */}
      <div className={cn('h-1.5 w-full rounded-t-2xl', sm.dot)} />

      {/* ── Header ── */}
      <div className="px-6 pt-4 pb-0">
        <div className="flex items-start gap-3">
          {/* Priority icon square */}
          <div className={cn('shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold mt-0.5', pm.bg)}>
            {t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : t.priority === 'medium' ? '🟡' : '🟢'}
          </div>

          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold', sm.bg, sm.text)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', sm.dot)} />
                {sm.label}
              </span>
              <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold', pm.bg, pm.text)}>
                {pm.label}
              </span>
              {isPendingApproval && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                  Pending Approval
                </span>
              )}
              {isCompleted && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                  ✓ Completed
                </span>
              )}
            </div>

            {/* Title */}
            <h2 className={cn('text-lg font-bold leading-snug', isCompleted ? 'line-through text-slate-400' : 'text-slate-900')}>
              {t.title}
            </h2>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
              <span className="flex items-center gap-1"><User size={11} /> {t.username}</span>
              <span className="text-slate-300">·</span>
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {format(new Date(t.created_at), 'MMM d, yyyy')}
              </span>
              {t.due_date && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className={cn('flex items-center gap-1', !isCompleted && new Date(t.due_date) < new Date() ? 'text-red-500 font-semibold' : '')}>
                    <Calendar size={11} /> Due {format(new Date(t.due_date), 'MMM d, yyyy')}
                  </span>
                </>
              )}
              {t.app_name && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="flex items-center gap-1 text-blue-600 font-medium"><Tag size={11} /> {t.app_name}</span>
                </>
              )}
            </div>
          </div>

          {/* Top-right actions */}
          <div className="flex items-center gap-1 shrink-0 ml-1">
            {isCreator && !isCompleted && (
              <button onClick={() => onEdit(t)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors" title="Edit">
                <Edit3 size={16} />
              </button>
            )}
            {isCreator && !isCompleted && (
              <button onClick={() => doAction(() => archiveTodoAction(t.id))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors" title="Archive">
                <Archive size={16} />
              </button>
            )}
            {isCreator && !isCompleted && (
              <button onClick={async () => { await doAction(() => deleteTodoAction(t.id)); onClose() }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors" title="Delete">
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors ml-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Primary action buttons */}
        {actionError && (
          <div className="mt-3 px-3 py-2 bg-red-50 rounded-xl text-sm text-red-600 border border-red-200">{actionError}</div>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {isAssignee && t.task_status === 'backlog' && (
            <PrimaryBtn icon={<PlayCircle size={14}/>} label="Start Work" color="blue" onClick={() => doAction(() => startTaskAction(t.id))} loading={isPending} />
          )}
          {!isCompleted && !isPendingApproval && (isAssignee || isCreator) && t.task_status !== 'backlog' && (
            <PrimaryBtn icon={<CheckCircle2 size={14}/>} label={isCreator ? 'Mark Complete' : 'Submit for Approval'} color="green" onClick={() => doAction(() => toggleTodoCompleteAction(t.id, true))} loading={isPending} />
          )}
          {isCreator && isPendingApproval && (
            <>
              <PrimaryBtn icon={<CheckCheck size={14}/>} label="Approve Completion" color="green" onClick={() => doAction(() => approveTodoAction(t.id))} loading={isPending} />
              <PrimaryBtn icon={<XCircle size={14}/>} label="Decline" color="red" onClick={() => setShowDeclineInput(true)} loading={isPending} />
            </>
          )}
        </div>

        {showDeclineInput && (
          <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
            <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason for declining..." rows={2}
              className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-red-300 resize-none" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setShowDeclineInput(false); doAction(() => declineTodoAction(t.id, declineReason)) }}
                className="px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors">Confirm Decline</button>
              <button onClick={() => setShowDeclineInput(false)}
                className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-slate-100">
          {TABS.map(({ id, label }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
                activeTab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ────── INFO TAB ────── */}
        {activeTab === 'info' && (
          <div className="space-y-5">
            {/* Two-column meta grid */}
            <div className="grid grid-cols-2 gap-3">
              <MetaCard icon={<User size={13} className="text-purple-500" />} label="Assigned To" value={t.assigned_to ?? '—'} sub={t.assignee_department} />
              <MetaCard icon={<Building2 size={13} className="text-blue-500" />} label="Department" value={t.creator_department ?? t.category ?? '—'} />
              {t.due_date && <MetaCard icon={<Calendar size={13} className="text-orange-500" />} label="Due Date"
                value={format(new Date(t.due_date), 'MMM d, yyyy')} accent={!isCompleted && new Date(t.due_date) < new Date() ? 'red' : undefined} />}
              {t.kpi_type && <MetaCard icon={<Target size={13} className="text-pink-500" />} label="KPI Type" value={t.kpi_type} />}
              {t.package_name && <MetaCard icon={<Link2 size={13} className="text-cyan-500" />} label="Package" value={t.package_name} />}
              {t.queue_status === 'queued' && t.queue_department && (
                <MetaCard icon={<Flag size={13} className="text-green-500" />} label="Queue" value={t.queue_department} accent="green" />
              )}
            </div>

            {/* Description */}
            {t.description && (
              <Section icon={<AlignLeft size={14} />} label="Description">
                <div
                  className={cn(
                    'text-sm leading-relaxed text-slate-700',
                    '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
                    '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
                    '[&_li]:my-1',
                    '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
                    '[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
                    '[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold'
                  )}
                  dangerouslySetInnerHTML={{ __html: normalizeTaskDescription(t.description) }}
                />
              </Section>
            )}

            {/* Our Goal */}
            {t.our_goal && (
              <Section icon={<Target size={14} />} label="Our Goal">
                <div className="text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: t.our_goal }} />
              </Section>
            )}

            {/* Notes */}
            {t.notes && (
              <Section icon={<AlignLeft size={14} />} label="Notes">
                <p className="text-sm text-slate-500 italic leading-relaxed">{t.notes}</p>
              </Section>
            )}

            {/* Multi-assignment */}
            {t.multi_assignment?.enabled && t.multi_assignment.assignees.length > 0 && (
              <Section icon={<User size={14} />} label="Multi-Assignment">
                <div className="space-y-2">
                  {t.multi_assignment.assignees.map((a) => {
                    const pct = t.multi_assignment!.completion_percentage ?? 0
                    const done = a.status === 'completed' || a.status === 'accepted'
                    return (
                      <div key={a.username} className="flex items-center gap-3 p-2.5 bg-cyan-50 rounded-xl border border-cyan-100">
                        <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0',
                          done ? 'bg-green-500' : a.status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-300')}>
                          {a.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{a.username}</p>
                          <p className="text-xs text-slate-500 capitalize">{a.status ?? 'pending'}</p>
                        </div>
                        <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all', done ? 'bg-green-500' : 'bg-blue-500')} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 w-8 text-right">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* ── Comments ── */}
            <Section icon={<MessageCircle size={14} />} label={`Comments${comments.length ? ` (${comments.length})` : ''}`}>
              <div className="space-y-3 mb-4">
                {comments.length === 0 && <p className="text-sm text-slate-400 italic">No comments yet.</p>}
                {comments.map((c, i) => {
                  const isMe = c.user === currentUsername
                  return (
                    <div key={i} className={cn('flex gap-2.5', isMe ? 'flex-row-reverse' : '')}>
                      <div className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5',
                        isMe ? 'bg-blue-500' : 'bg-slate-400')}>
                        {c.user.charAt(0).toUpperCase()}
                      </div>
                      <div className={cn('max-w-[75%]', isMe ? 'items-end' : 'items-start')}>
                        <div className={cn('px-3.5 py-2.5 rounded-2xl text-sm text-slate-800 shadow-sm',
                          isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-100 rounded-tl-sm')}>
                          {c.details}
                        </div>
                        <div className={cn('text-[10px] text-slate-400 mt-1 px-1', isMe ? 'text-right' : '')}>
                          {c.user} · {formatDistanceToNow(new Date(c.timestamp), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Comment input */}
              <div className="flex gap-2 items-end">
                <div className="flex-1 relative">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a comment..."
                    rows={1}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && comment.trim()) {
                        e.preventDefault()
                        doAction(() => addCommentAction(t.id, comment.trim()))
                        setComment('')
                      }
                    }}
                  />
                </div>
                <button
                  onClick={() => { if (comment.trim()) { doAction(() => addCommentAction(t.id, comment.trim())); setComment('') } }}
                  disabled={!comment.trim() || isPending}
                  className="shrink-0 w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  <Send size={14} className="translate-x-0.5" />
                </button>
              </div>
            </Section>
          </div>
        )}

        {/* ────── HISTORY / ACTIVITY TAB ────── */}
        {activeTab === 'history' && (
          <div>
            {historyEvts.length === 0 && !nextStep && (
              <div className="text-center py-12">
                <Clock size={28} className="mx-auto text-slate-200 mb-2" />
                <p className="text-sm text-slate-400">No activity yet.</p>
              </div>
            )}

            <div className="relative">
              {/* Vertical connector line */}
              <div className="absolute left-[17px] top-0 bottom-0 w-px bg-slate-200" />

              {historyEvts.map((h, i) => {
                const meta = EVT_META[h.type] ?? { label: h.type, iconBg: 'bg-slate-100', iconText: 'text-slate-500', emoji: '•' }
                const isLast = i === historyEvts.length - 1 && !nextStep
                return (
                  <div key={i} className={cn('relative flex gap-4', isLast ? 'pb-0' : 'pb-5')}>
                    {/* Circle */}
                    <div className={cn('relative z-10 shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base shadow-sm border-2 border-white', meta.iconBg)}>
                      <span role="img" aria-label={meta.label}>{meta.emoji}</span>
                    </div>

                    {/* Content card */}
                    <div className="flex-1 min-w-0 bg-white border border-slate-100 rounded-xl px-4 py-3 shadow-sm hover:border-slate-200 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{h.title ?? meta.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            <span className="font-medium text-slate-600">{h.user}</span>
                            {' · '}
                            {fmtTs(h.timestamp)}
                          </p>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 mt-0.5">
                          {formatDistanceToNow(new Date(h.timestamp), { addSuffix: true })}
                        </span>
                      </div>
                      {h.details && (
                        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed border-t border-slate-50 pt-1.5">
                          {h.details}
                        </p>
                      )}
                      {h.from && h.to && (
                        <div className="flex items-center gap-2 mt-1.5 text-xs">
                          <span className="px-2 py-0.5 bg-slate-100 rounded-md text-slate-500 line-through">{h.from}</span>
                          <span className="text-slate-400">→</span>
                          <span className="px-2 py-0.5 bg-blue-50 rounded-md text-blue-600 font-medium">{h.to}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Pending next step */}
              {nextStep && (
                <div className="relative flex gap-4 pb-0">
                  <div className="relative z-10 shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-2 border-dashed border-slate-300 bg-white">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-3">
                    <p className="text-sm font-semibold text-slate-400">{
                      t.task_status === 'in_progress' ? 'In Progress' :
                      isPendingApproval ? 'Awaiting Approval' : 'Pending'
                    }</p>
                    <p className="text-xs text-slate-400 mt-0.5">{nextStep}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ────── FILES TAB ────── */}
        {activeTab === 'files' && (
          <div>
            {t.attachments.length === 0 ? (
              <div className="text-center py-12">
                <Paperclip size={28} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-400">No attachments</p>
              </div>
            ) : (
              <div className="space-y-2">
                {t.attachments.map((a) => {
                  const ext = a.file_name.split('.').pop()?.toUpperCase() ?? 'FILE'
                  return (
                    <div key={a.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:border-blue-200 hover:bg-blue-50/30 transition-colors group">
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700">
                        {ext}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.file_name}</p>
                        <p className="text-xs text-slate-400">
                          {a.uploaded_by} · {format(new Date(a.created_at), 'MMM d, yyyy')}
                          {a.file_size ? ` · ${(a.file_size / 1024).toFixed(0)} KB` : ''}
                        </p>
                      </div>
                      <a href={a.file_url} target="_blank" rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs rounded-lg text-blue-600 hover:bg-blue-100 font-semibold transition-colors opacity-0 group-hover:opacity-100">
                        Download
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ────── SHARE TAB ────── */}
        {activeTab === 'share' && (
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Share with User</label>
              <div className="flex gap-2">
                <input type="text" value={shareUsername} onChange={(e) => setShareUsername(e.target.value)}
                  placeholder="Enter username..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                <button onClick={() => { if (shareUsername.trim()) { doAction(() => shareTodoAction(t.id, shareUsername.trim())); setShareUsername('') } }}
                  disabled={!shareUsername.trim() || isPending}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                  <UserPlus size={14} /> Share
                </button>
              </div>
            </div>

            {t.shares.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Shared With</p>
                <div className="space-y-2">
                  {t.shares.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold text-white">
                          {s.shared_with.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{s.shared_with}</p>
                          <p className="text-[10px] text-slate-400">{s.can_edit ? 'Can edit' : 'View only'}</p>
                        </div>
                      </div>
                      {isCreator && (
                        <button onClick={() => doAction(() => unshareTodoAction(t.id, s.shared_with))}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Remove">
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">Not shared with anyone yet.</p>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
        style={{ background: 'white', border: '1px solid rgba(0,0,0,0.08)' }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function MetaCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string;
  sub?: string | null; accent?: 'red' | 'green'
}) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1">
        {icon} {label}
      </div>
      <p className={cn('text-sm font-semibold',
        accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-green-600' : 'text-slate-800')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({
  icon, label, children,
}: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
        {icon} {label}
      </div>
      {children}
    </div>
  )
}

function PrimaryBtn({
  icon, label, color, onClick, loading,
}: {
  icon: React.ReactNode; label: string; color: 'blue' | 'green' | 'red';
  onClick: () => void; loading?: boolean
}) {
  const cls = {
    blue:  'bg-blue-600 hover:bg-blue-700 text-white',
    green: 'bg-green-600 hover:bg-green-700 text-white',
    red:   'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
  }
  return (
    <button onClick={onClick} disabled={loading}
      className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 shadow-sm', cls[color])}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
