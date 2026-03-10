'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  X,
  Clock,
  MessageCircle,
  Paperclip,
  Share2,
  Edit3,
  Trash2,
  Archive,
  ChevronDown,
  Loader2,
  UserPlus,
  UserMinus,
  CheckCircle2,
  XCircle,
  PlayCircle,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDistanceToNow } from 'date-fns'
import type { Todo, TodoDetails, HistoryEntry } from '@/types'
import {
  PriorityBadge,
  TaskStatusBadge,
  ApprovalBadge,
  UserAvatar,
  DueDateChip,
} from './task-badges'
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

export function TaskDetailModal({
  taskId,
  currentUsername,
  onClose,
  onEdit,
  onRefresh,
}: TaskDetailModalProps) {
  const [details, setDetails] = useState<TodoDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'attachments' | 'share'>('info')
  const [comment, setComment] = useState('')
  const [shareUsername, setShareUsername] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [showDeclineInput, setShowDeclineInput] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState('')

  const loadDetails = async () => {
    setLoading(true)
    const res = await getTodoDetails(taskId)
    setDetails(res)
    setLoading(false)
  }

  useEffect(() => { loadDetails() }, [taskId])

  const doAction = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setActionError('')
    startTransition(async () => {
      const res = await fn()
      if (res.success) {
        loadDetails()
        onRefresh()
      } else {
        setActionError(res.error ?? 'Action failed')
      }
    })
  }

  if (loading) {
    return (
      <ModalShell onClose={onClose}>
        <div className="flex items-center justify-center h-64">
          <Loader2 size={28} className="animate-spin text-blue-400" />
        </div>
      </ModalShell>
    )
  }

  if (!details) {
    return (
      <ModalShell onClose={onClose}>
        <div className="flex items-center justify-center h-64 text-slate-400">Task not found.</div>
      </ModalShell>
    )
  }

  const t = details
  const isCreator = t.username === currentUsername
  const isAssignee = t.assigned_to === currentUsername
  const isPendingApproval = t.approval_status === 'pending_approval'
  const isCompleted = t.completed

  const comments = t.history.filter((h: HistoryEntry) => h.type === 'comment')
  const historyEvents = t.history.filter((h: HistoryEntry) => h.type !== 'comment')

  return (
    <ModalShell onClose={onClose}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <TaskStatusBadge status={t.task_status} />
              <PriorityBadge priority={t.priority} />
              <ApprovalBadge status={t.approval_status} />
            </div>
            <h2 className={cn('text-xl font-bold', isCompleted ? 'line-through text-slate-400' : 'text-slate-900')}>
              {t.title}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-slate-500">
              <span>by {t.username}</span>
              <span>·</span>
              <DueDateChip dateStr={t.due_date} completed={isCompleted} />
              {t.kpi_type && (
                <>
                  <span>·</span>
                  <span className="text-purple-600">{t.kpi_type}</span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {isCreator && !isCompleted && (
              <button
                onClick={() => onEdit(t)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                title="Edit"
              >
                <Edit3 size={18} />
              </button>
            )}
            {isCreator && !isCompleted && (
              <button
                onClick={() => doAction(() => archiveTodoAction(t.id))}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                title="Archive"
              >
                <Archive size={18} />
              </button>
            )}
            {isCreator && !isCompleted && (
              <button
                onClick={async () => {
                  await doAction(() => deleteTodoAction(t.id))
                  onClose()
                }}
                className="p-2 rounded-xl hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                title="Delete"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Primary actions */}
        {actionError && (
          <div className="mt-3 px-3 py-2 bg-red-50 rounded-xl text-sm text-red-600">{actionError}</div>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {isAssignee && t.task_status === 'backlog' && (
            <ActionBtn
              icon={<PlayCircle size={15}/>}
              label="Start Work"
              color="blue"
              onClick={() => doAction(() => startTaskAction(t.id))}
              loading={isPending}
            />
          )}
          {!isCompleted && !isPendingApproval && (isAssignee || isCreator) && t.task_status !== 'backlog' && (
            <ActionBtn
              icon={<CheckCircle2 size={15}/>}
              label={isCreator ? 'Mark Complete' : 'Submit for Approval'}
              color="green"
              onClick={() => doAction(() => toggleTodoCompleteAction(t.id, true))}
              loading={isPending}
            />
          )}
          {isCreator && isPendingApproval && (
            <>
              <ActionBtn
                icon={<CheckCircle2 size={15}/>}
                label="Approve Completion"
                color="green"
                onClick={() => doAction(() => approveTodoAction(t.id))}
                loading={isPending}
              />
              <ActionBtn
                icon={<XCircle size={15}/>}
                label="Decline"
                color="red"
                onClick={() => setShowDeclineInput(true)}
                loading={isPending}
              />
            </>
          )}
        </div>

        {showDeclineInput && (
          <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason for declining..."
              rows={2}
              className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-red-300 resize-none"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setShowDeclineInput(false)
                  doAction(() => declineTodoAction(t.id, declineReason))
                }}
                className="px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Confirm Decline
              </button>
              <button
                onClick={() => setShowDeclineInput(false)}
                className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-slate-100 -mb-4">
          {(['info', 'history', 'attachments', 'share'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {tab === 'history' ? `History${historyEvents.length > 0 ? ` (${historyEvents.length})` : ''}` :
               tab === 'attachments' ? `Files${details.attachments.length > 0 ? ` (${details.attachments.length})` : ''}` :
               tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* INFO TAB */}
        {activeTab === 'info' && (
          <div className="space-y-5">
            {/* Package + App */}
            {(t.package_name || t.app_name) && (
              <InfoRow label="Package">
                <div className="flex items-center gap-2">
                  {t.app_name && <span className="text-blue-600 font-medium">{t.app_name}</span>}
                  {t.app_name && t.package_name && <span className="text-slate-300">·</span>}
                  {t.package_name && <span className="text-slate-700">{t.package_name}</span>}
                </div>
              </InfoRow>
            )}

            {/* Assignment */}
            {t.assigned_to && (
              <InfoRow label="Assigned To">
                <div className="flex items-center gap-2">
                  <UserAvatar username={t.assigned_to} size="sm" />
                  <span className="text-slate-700">{t.assigned_to}</span>
                </div>
              </InfoRow>
            )}

            {/* Multi-assignment */}
            {t.multi_assignment?.enabled && t.multi_assignment.assignees.length > 0 && (
              <InfoRow label="Multi-Assigned">
                <div className="flex flex-wrap gap-2">
                  {t.multi_assignment.assignees.map((a) => (
                    <div key={a.username} className="flex items-center gap-1.5 px-2 py-1 bg-cyan-50 rounded-lg">
                      <UserAvatar username={a.username} size="sm" />
                      <span className="text-sm text-slate-700">{a.username}</span>
                    </div>
                  ))}
                </div>
              </InfoRow>
            )}

            {/* Queue */}
            {t.queue_status === 'queued' && t.queue_department && (
              <InfoRow label="Department Queue">
                <span className="px-2 py-1 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
                  {t.queue_department}
                </span>
              </InfoRow>
            )}

            {/* Description */}
            {t.description && (
              <InfoRow label="Description">
                <p className="text-sm text-slate-700 leading-relaxed">{t.description}</p>
              </InfoRow>
            )}

            {/* Our Goal */}
            {t.our_goal && (
              <InfoRow label="Our Goal">
                <div
                  className="text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: t.our_goal }}
                />
              </InfoRow>
            )}

            {/* Notes */}
            {t.notes && (
              <InfoRow label="Notes">
                <p className="text-sm text-slate-500 italic leading-relaxed">{t.notes}</p>
              </InfoRow>
            )}

            {/* Created / Actual Due */}
            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Created">
                <span className="text-sm text-slate-600">
                  {new Date(t.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </span>
              </InfoRow>
              {t.actual_due_date && (
                <InfoRow label="Completed On">
                  <span className="text-sm text-slate-600">
                    {new Date(t.actual_due_date).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </InfoRow>
              )}
            </div>

            {/* Comments section */}
            <div className="pt-3 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MessageCircle size={13} /> Comments {comments.length > 0 && `(${comments.length})`}
              </h4>
              <div className="space-y-3 mb-4">
                {comments.map((c, i) => (
                  <div key={i} className="flex gap-3">
                    <UserAvatar username={c.user} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-slate-700">{c.user}</span>
                        <span className="text-xs text-slate-400">
                          {formatDistanceToNow(new Date(c.timestamp), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 mt-0.5">{c.details}</p>
                    </div>
                  </div>
                ))}
                {comments.length === 0 && (
                  <p className="text-sm text-slate-400 italic">No comments yet.</p>
                )}
              </div>
              {/* Add comment */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && comment.trim()) {
                      e.preventDefault()
                      doAction(() => addCommentAction(t.id, comment.trim()))
                      setComment('')
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (comment.trim()) {
                      doAction(() => addCommentAction(t.id, comment.trim()))
                      setComment('')
                    }
                  }}
                  disabled={!comment.trim() || isPending}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-1">
            {historyEvents.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-8">No history yet.</p>
            )}
            {historyEvents.map((h, i) => (
              <div key={i} className="flex gap-3 py-3 border-b border-slate-50">
                <div className="mt-0.5">
                  <HistoryIcon type={h.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{h.user}</span>{' '}
                    <span>{historyLabel(h)}</span>
                  </div>
                  {h.details && (
                    <p className="text-xs text-slate-500 mt-0.5">{h.details}</p>
                  )}
                </div>
                <div className="text-xs text-slate-400 shrink-0">
                  {formatDistanceToNow(new Date(h.timestamp), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ATTACHMENTS TAB */}
        {activeTab === 'attachments' && (
          <div>
            {details.attachments.length === 0 ? (
              <div className="text-center py-12">
                <Paperclip size={28} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-400">No attachments</p>
              </div>
            ) : (
              <div className="space-y-2">
                {details.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:border-blue-200 transition-colors">
                    <Paperclip size={16} className="text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.file_name}</p>
                      <div className="text-xs text-slate-400">
                        {a.uploaded_by} · {new Date(a.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <a
                      href={a.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs rounded-lg text-blue-600 hover:bg-blue-50 font-medium transition-colors"
                    >
                      Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SHARE TAB */}
        {activeTab === 'share' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Share with User
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareUsername}
                  onChange={(e) => setShareUsername(e.target.value)}
                  placeholder="Enter username..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                />
                <button
                  onClick={() => {
                    if (shareUsername.trim()) {
                      doAction(() => shareTodoAction(t.id, shareUsername.trim()))
                      setShareUsername('')
                    }
                  }}
                  disabled={!shareUsername.trim() || isPending}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  <UserPlus size={14} /> Share
                </button>
              </div>
            </div>

            {details.shares.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Shared With
                </p>
                <div className="space-y-2">
                  {details.shares.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-2">
                        <UserAvatar username={s.shared_with} size="sm" />
                        <span className="text-sm font-medium text-slate-700">{s.shared_with}</span>
                      </div>
                      {isCreator && (
                        <button
                          onClick={() => doAction(() => unshareTodoAction(t.id, s.shared_with))}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                          title="Remove share"
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {details.shares.length === 0 && (
              <p className="text-sm text-slate-400 italic">Not shared with anyone yet.</p>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', WebkitBackdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        {children}
      </div>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ActionBtn({
  icon,
  label,
  color,
  onClick,
  loading,
}: {
  icon: React.ReactNode
  label: string
  color: 'blue' | 'green' | 'red'
  onClick: () => void
  loading?: boolean
}) {
  const colors = {
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
    green: 'bg-green-600 hover:bg-green-700 text-white',
    red: 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
  }
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60',
        colors[color]
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

function HistoryIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    created: <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center"><span className="text-xs">✨</span></div>,
    assigned: <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center"><span className="text-xs">👤</span></div>,
    started: <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center"><span className="text-xs">🚀</span></div>,
    status_change: <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center"><span className="text-xs">🔄</span></div>,
    completed: <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center"><span className="text-xs">✅</span></div>,
    completion_submitted: <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center"><span className="text-xs">📤</span></div>,
    approved: <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center"><span className="text-xs">👍</span></div>,
    declined: <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center"><span className="text-xs">👎</span></div>,
    edit: <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center"><span className="text-xs">✏️</span></div>,
    acknowledged: <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center"><span className="text-xs">👀</span></div>,
    comment: <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center"><span className="text-xs">💬</span></div>,
  }
  return (icons[type] ?? <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs">•</div>) as React.ReactElement
}

function historyLabel(h: HistoryEntry): string {
  switch (h.type) {
    case 'created': return 'created this task'
    case 'assigned': return `assigned to ${h.to ?? '—'}`
    case 'started': return 'started working on this task'
    case 'status_change': return `changed status to ${h.to ?? ''}`
    case 'completed': return 'marked as completed'
    case 'completion_submitted': return 'submitted for approval'
    case 'uncompleted': return 'marked as incomplete'
    case 'approved': return 'approved the completion'
    case 'declined': return 'declined the completion'
    case 'edit': return 'edited the task'
    case 'acknowledged': return 'acknowledged the task'
    case 'comment': return 'commented'
    default: return h.type
  }
}
