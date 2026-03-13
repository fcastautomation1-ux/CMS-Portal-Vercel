'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition, type ChangeEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Archive,
  Building2,
  Calendar,
  CheckCheck,
  CheckCircle2,
  Clock,
  Edit3,
  Flag,
  Link2,
  Loader2,
  MessageCircle,
  Paperclip,
  PlayCircle,
  Send,
  Tag,
  Target,
  Trash2,
  User,
  UserMinus,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/cn'
import { formatPakistanDate, formatPakistanDateTime } from '@/lib/pakistan-time'
import { createBrowserClient } from '@/lib/supabase/client'
import { normalizeTaskDescription } from '@/lib/task-description'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { queryKeys } from '@/lib/query-keys'
import type { Todo, TodoDetails, HistoryEntry } from '@/types'
import { CreateTaskModal } from './create-task-modal'
import {
  acknowledgeTaskAction,
  addCommentAction,
  approveTodoAction,
  archiveTodoAction,
  declineTodoAction,
  deleteTodoAction,
  getTodoDetails,
  getUsersForAssignment,
  saveTodoAttachmentAction,
  shareTodoAction,
  startTaskAction,
  toggleTodoCompleteAction,
  unshareTodoAction,
} from '@/app/dashboard/tasks/actions'

type TabId = 'info' | 'history' | 'files' | 'share'
const TASK_ATTACHMENTS_BUCKET = 'task-attachments'
const MAX_ATTACHMENT_SIZE = 1024 * 1024 * 1024

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  backlog: { label: 'Backlog', bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  todo: { label: 'To Do', bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  in_progress: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  done: { label: 'Done', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
}

const PRIORITY_META: Record<string, { label: string; bg: string; text: string }> = {
  urgent: { label: 'Urgent', bg: 'bg-red-100', text: 'text-red-700' },
  high: { label: 'High', bg: 'bg-orange-100', text: 'text-orange-700' },
  medium: { label: 'Medium', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  low: { label: 'Low', bg: 'bg-green-100', text: 'text-green-700' },
}

const EVT_META: Record<string, { label: string; iconBg: string; iconText: string }> = {
  created: { label: 'Task Created', iconBg: 'bg-blue-100', iconText: 'text-blue-700' },
  assigned: { label: 'Assigned', iconBg: 'bg-purple-100', iconText: 'text-purple-700' },
  started: { label: 'In Progress', iconBg: 'bg-sky-100', iconText: 'text-sky-700' },
  status_change: { label: 'Status Changed', iconBg: 'bg-slate-100', iconText: 'text-slate-700' },
  completed: { label: 'Completed', iconBg: 'bg-green-100', iconText: 'text-green-700' },
  completion_submitted: { label: 'Submitted For Approval', iconBg: 'bg-amber-100', iconText: 'text-amber-700' },
  approved: { label: 'Approved', iconBg: 'bg-green-100', iconText: 'text-green-700' },
  declined: { label: 'Declined', iconBg: 'bg-red-100', iconText: 'text-red-700' },
  edit: { label: 'Task Edited', iconBg: 'bg-blue-100', iconText: 'text-blue-700' },
  acknowledged: { label: 'Acknowledged', iconBg: 'bg-slate-100', iconText: 'text-slate-700' },
  comment: { label: 'Comment Added', iconBg: 'bg-slate-100', iconText: 'text-slate-700' },
  uncompleted: { label: 'Reopened', iconBg: 'bg-orange-100', iconText: 'text-orange-700' },
}

function fmtTs(ts: string) {
  try {
    return formatPakistanDateTime(ts)
  } catch {
    return ts
  }
}

function nextStepLabel(task: TodoDetails): string | null {
  if (task.completed) return null
  if (task.approval_status === 'pending_approval') return 'Waiting for creator approval'
  if (task.task_status === 'in_progress') return 'Pending action from assigned agent'
  if (task.task_status === 'backlog' || task.task_status === 'todo') return 'Waiting to be started'
  return null
}

function getTaskParticipants(task: TodoDetails) {
  const seen = new Map<string, { username: string; role: string }>()

  const addParticipant = (username: string | null | undefined, role: string) => {
    const value = (username ?? '').trim()
    if (!value || seen.has(value)) return
    seen.set(value, { username: value, role })
  }

  addParticipant(task.username, 'Creator')
  addParticipant(task.assigned_to, 'Assignee')

  String(task.manager_id ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => addParticipant(value, 'Manager'))

  task.multi_assignment?.assignees?.forEach((assignee) => addParticipant(assignee.username, 'Contributor'))
  task.shares.forEach((share) => addParticipant(share.shared_with, share.can_edit ? 'Shared Editor' : 'Shared Viewer'))

  return Array.from(seen.values())
}

function splitDepartments(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getDepartmentSummary(task: TodoDetails) {
  const departments = new Set<string>()

  splitDepartments(task.creator_department ?? task.category ?? null).forEach((department) => departments.add(department))
  splitDepartments(task.assignee_department).forEach((department) => departments.add(department))
  if (task.queue_department) departments.add(task.queue_department)

  const list = Array.from(departments)
  return {
    count: list.length,
    label: list.length ? list.join(', ') : '-',
  }
}

function getAssignedSummary(task: TodoDetails) {
  if (task.assigned_to) {
    return {
      value: task.assigned_to,
      sub: task.assignee_department,
    }
  }

  const assignees = task.multi_assignment?.assignees ?? []
  if (assignees.length > 0) {
    return {
      value: `${assignees.length} users assigned`,
      sub: assignees.map((assignee) => assignee.username).join(', '),
    }
  }

  if (task.queue_status === 'queued' && task.queue_department) {
    return {
      value: 'Department queue',
      sub: task.queue_department,
    }
  }

  return {
    value: '-',
    sub: null,
  }
}

function getAssigneeDueDate(task: TodoDetails, username: string) {
  const assignee = task.multi_assignment?.assignees?.find((entry) => entry.username === username)
  return assignee?.actual_due_date ?? task.due_date ?? task.expected_due_date ?? null
}

function renderCommentWithMentions(details: string) {
  const parts = details.split(/(@[a-zA-Z0-9._-]+)/g)
  return parts.map((part, index) => {
    if (/^@[a-zA-Z0-9._-]+$/.test(part)) {
      return <span key={`${part}-${index}`} className="font-semibold underline underline-offset-2">{part}</span>
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

export function TaskDetailPage({
  initialDetails,
  currentUsername,
}: {
  initialDetails: TodoDetails
  currentUsername: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('info')
  const [comment, setComment] = useState('')
  const [shareUsername, setShareUsername] = useState('')
  const [shareUsers, setShareUsers] = useState<Array<{ username: string; role: string; department: string | null }>>([])
  const [declineReason, setDeclineReason] = useState('')
  const [showDeclineInput, setShowDeclineInput] = useState(false)
  const [editTask, setEditTask] = useState<Todo | null>(null)
  const [actionError, setActionError] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const refreshTimerRef = useRef<number | null>(null)

  const detailsQuery = useQuery({
    queryKey: queryKeys.taskDetail(initialDetails.id),
    queryFn: async () => {
      const updated = await getTodoDetails(initialDetails.id)
      return updated ?? initialDetails
    },
    initialData: initialDetails,
  })

  const details = detailsQuery.data ?? initialDetails

  const refreshDetails = useCallback(async () => {
    const updated = await getTodoDetails(details.id)
    if (!updated) {
      router.push('/dashboard/tasks')
      router.refresh()
      return
    }
    queryClient.setQueryData(queryKeys.taskDetail(details.id), updated)
    router.refresh()
  }, [details.id, queryClient, router])

  useEffect(() => {
    let cancelled = false
    getUsersForAssignment().then((users) => {
      if (!cancelled) setShareUsers(users)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshDetails()
      }, 200)
    }

    const unsubscribe = subscribeToPostgresChanges(
      `task-detail-page:${details.id}`,
      [
        { table: 'todos', filter: `id=eq.${details.id}` },
        { table: 'todo_attachments', filter: `todo_id=eq.${details.id}` },
        { table: 'todo_shares', filter: `todo_id=eq.${details.id}` },
      ],
      scheduleRefresh
    )

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      unsubscribe()
    }
  }, [details.id, refreshDetails])

  const doAction = async (fn: () => Promise<{ success: boolean; error?: string }>, options?: { redirectToTasks?: boolean }) => {
    setActionError('')
    startTransition(async () => {
      const res = await fn()
      if (!res.success) {
        setActionError(res.error ?? 'Action failed')
        return
      }
      if (options?.redirectToTasks) {
        router.push('/dashboard/tasks')
        router.refresh()
        return
      }
      await refreshDetails()
    })
  }

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return

    const oversized = files.find((file) => file.size > MAX_ATTACHMENT_SIZE)
    if (oversized) {
      setActionError(`${oversized.name} is larger than 1 GB.`)
      return
    }

    setActionError('')
    setUploadingFiles(true)

    try {
      const supabase = createBrowserClient()
      for (const file of files) {
        const ext = file.name.includes('.') ? file.name.split('.').pop() : undefined
        const storagePath = `todos/${details.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
        const upload = await supabase.storage
          .from(TASK_ATTACHMENTS_BUCKET)
          .upload(storagePath, file, { upsert: false })

        if (upload.error) throw new Error(upload.error.message)

        const saved = await saveTodoAttachmentAction({
          todo_id: details.id,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          storage_path: storagePath,
        })

        if (!saved.success) throw new Error(saved.error ?? `Failed to attach ${file.name}`)
      }

      await refreshDetails()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Attachment upload failed.')
    } finally {
      setUploadingFiles(false)
    }
  }

  const t = details
  const isCreator = t.username === currentUsername
  const isAssignee = t.assigned_to === currentUsername
  const isPendingApproval = t.approval_status === 'pending_approval'
  const isCompleted = t.completed
  const sm = STATUS_META[t.task_status] ?? STATUS_META.backlog
  const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.medium
  const comments = t.history.filter((h: HistoryEntry) => h.type === 'comment')
  const historyEvents = t.history.filter((h: HistoryEntry) => h.type !== 'comment')
  const nextStep = nextStepLabel(t)
  const participants = getTaskParticipants(t)
  const assignedSummary = getAssignedSummary(t)
  const departmentSummary = getDepartmentSummary(t)

  const tabs = [
    { id: 'info' as const, label: 'Details' },
    { id: 'history' as const, label: `Activity${historyEvents.length ? ` (${historyEvents.length})` : ''}` },
    { id: 'files' as const, label: `Files${t.attachments.length ? ` (${t.attachments.length})` : ''}` },
    { id: 'share' as const, label: `Shared${t.shares.length ? ` (${t.shares.length})` : ''}` },
  ]

  return (
    <>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)] px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/80 bg-white/85 px-5 py-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="min-w-0">
              <Link href="/dashboard/tasks" className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-blue-600">
                <ArrowLeft size={14} />
                Back To Tasks
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', sm.bg, sm.text)}>
                  <span className={cn('h-2 w-2 rounded-full', sm.dot)} />
                  {sm.label}
                </span>
                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', pm.bg, pm.text)}>{pm.label}</span>
                {isPendingApproval && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Pending Approval</span>}
                {isCompleted && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Completed</span>}
              </div>
              <h1 className={cn('mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl', isCompleted && 'line-through text-slate-400')}>
                {t.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                <span className="flex items-center gap-1.5"><User size={14} /> {t.username}</span>
                <span className="flex items-center gap-1.5"><Clock size={14} /> {formatPakistanDate(t.created_at)}</span>
                {t.due_date && (
                  <span className={cn('flex items-center gap-1.5', !isCompleted && new Date(t.due_date) < new Date() && 'font-semibold text-red-500')}>
                    <Calendar size={14} />
                    Due {formatPakistanDate(t.due_date)}
                  </span>
                )}
                {t.app_name && <span className="flex items-center gap-1.5 font-medium text-blue-600"><Tag size={14} /> {t.app_name}</span>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isAssignee && t.task_status === 'backlog' && (
                <PrimaryBtn icon={<PlayCircle size={14} />} label="Acknowledge" color="blue" onClick={() => doAction(() => acknowledgeTaskAction(t.id))} loading={isPending} />
              )}
              {isAssignee && t.task_status === 'todo' && (
                <PrimaryBtn icon={<PlayCircle size={14} />} label="Start Work" color="blue" onClick={() => doAction(() => startTaskAction(t.id))} loading={isPending} />
              )}
              {!isCompleted && !isPendingApproval && (isAssignee || isCreator) && t.task_status !== 'backlog' && (
                <PrimaryBtn
                  icon={<CheckCircle2 size={14} />}
                  label={isCreator ? 'Mark Complete' : 'Submit For Approval'}
                  color="green"
                  onClick={() => doAction(() => toggleTodoCompleteAction(t.id, true))}
                  loading={isPending}
                />
              )}
              {isCreator && isPendingApproval && (
                <>
                  <PrimaryBtn icon={<CheckCheck size={14} />} label="Approve" color="green" onClick={() => doAction(() => approveTodoAction(t.id))} loading={isPending} />
                  <PrimaryBtn icon={<XCircle size={14} />} label="Decline" color="red" onClick={() => setShowDeclineInput(true)} loading={isPending} />
                </>
              )}
              {isCreator && !isCompleted && (
                <>
                  <button onClick={() => setEditTask(t)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50">
                    <span className="inline-flex items-center gap-2"><Edit3 size={14} /> Edit</span>
                  </button>
                  <button onClick={() => doAction(() => archiveTodoAction(t.id))} className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700" title="Archive">
                    <Archive size={16} />
                  </button>
                  <button onClick={() => doAction(() => deleteTodoAction(t.id), { redirectToTasks: true })} className="rounded-2xl border border-red-200 bg-red-50 p-2.5 text-red-500 transition-colors hover:bg-red-100" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          {actionError && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{actionError}</div>}

          {showDeclineInput && (
            <div className="rounded-[28px] border border-red-200 bg-white px-5 py-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
              <p className="text-sm font-semibold text-slate-800">Decline completion request</p>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Reason for declining..."
                rows={3}
                className="mt-3 w-full rounded-2xl border border-red-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-red-300 focus:ring-2 focus:ring-red-100"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setShowDeclineInput(false)
                    void doAction(() => declineTodoAction(t.id, declineReason))
                  }}
                  className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                >
                  Confirm Decline
                </button>
                <button onClick={() => setShowDeclineInput(false)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_380px]">
            <section className="overflow-hidden rounded-[32px] border border-white/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
              <div className={cn('h-1.5 w-full', sm.dot)} />
              <div className="border-b border-slate-100 px-5 pt-3">
                <div className="flex flex-wrap gap-1">
                  {tabs.map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      className={cn(
                        'rounded-t-2xl border-b-2 px-4 py-3 text-sm font-semibold transition-colors',
                        activeTab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-5 sm:px-6">
                {activeTab === 'info' && (
                  <div className="space-y-6">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <MetaCard icon={<User size={13} className="text-purple-500" />} label="Assigned To" value={assignedSummary.value} sub={assignedSummary.sub} />
                      <MetaCard icon={<Building2 size={13} className="text-blue-500" />} label={`Departments (${departmentSummary.count})`} value={departmentSummary.label} />
                      <MetaCard icon={<Calendar size={13} className="text-orange-500" />} label="Due Date" value={t.due_date ? formatPakistanDate(t.due_date) : '-'} accent={!isCompleted && t.due_date && new Date(t.due_date) < new Date() ? 'red' : undefined} />
                      <MetaCard icon={<Target size={13} className="text-pink-500" />} label="KPI Type" value={t.kpi_type ?? '-'} />
                      <MetaCard icon={<Link2 size={13} className="text-cyan-500" />} label="Package" value={t.package_name ?? '-'} />
                      {t.queue_status === 'queued' && t.queue_department && <MetaCard icon={<Flag size={13} className="text-green-500" />} label="Queue" value={t.queue_department} accent="green" />}
                    </div>

                    {t.description && (
                      <Section icon={<MessageCircle size={14} />} label="Description">
                        <div
                          className={cn(
                            'rounded-[24px] border border-slate-100 bg-slate-50 px-5 py-4 text-sm leading-relaxed text-slate-700',
                            '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
                            '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
                            '[&_li]:my-1',
                            '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
                            '[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
                            '[&_th]:border [&_th]:border-slate-200 [&_th]:bg-white [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold'
                          )}
                          dangerouslySetInnerHTML={{ __html: normalizeTaskDescription(t.description) }}
                        />
                      </Section>
                    )}

                    {t.our_goal && (
                      <Section icon={<Target size={14} />} label="Our Goal">
                        <div className="prose prose-sm max-w-none rounded-[24px] border border-slate-100 bg-slate-50 px-5 py-4 text-slate-700" dangerouslySetInnerHTML={{ __html: t.our_goal }} />
                      </Section>
                    )}

                    {t.notes && (
                      <Section icon={<MessageCircle size={14} />} label="Notes">
                        <div className="rounded-[24px] border border-slate-100 bg-slate-50 px-5 py-4 text-sm italic text-slate-600">{t.notes}</div>
                      </Section>
                    )}

                    {t.multi_assignment?.enabled && t.multi_assignment.assignees.length > 0 && (
                      <Section icon={<Users size={14} />} label="Multi-Assignment">
                        <div className="grid gap-3 md:grid-cols-2">
                          {t.multi_assignment.assignees.map((assignee) => {
                            const pct = t.multi_assignment?.completion_percentage ?? 0
                            const done = assignee.status === 'completed' || assignee.status === 'accepted'
                            return (
                              <div key={assignee.username} className="rounded-[24px] border border-cyan-100 bg-cyan-50 px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white', done ? 'bg-green-500' : assignee.status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-400')}>
                                    {assignee.username.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-slate-800">{assignee.username}</p>
                                    <p className="text-xs capitalize text-slate-500">{assignee.status ?? 'pending'}</p>
                                    <p className="text-[11px] text-slate-400">
                                      Due {getAssigneeDueDate(t, assignee.username) ? formatPakistanDate(getAssigneeDueDate(t, assignee.username) as string) : '-'}
                                    </p>
                                  </div>
                                  <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                                  <div className={cn('h-full rounded-full', done ? 'bg-green-500' : 'bg-blue-500')} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </Section>
                    )}
                  </div>
                )}

                {activeTab === 'history' && (
                  <div>
                    {historyEvents.length === 0 && !nextStep ? (
                      <div className="py-16 text-center">
                        <Clock size={28} className="mx-auto mb-3 text-slate-200" />
                        <p className="text-sm text-slate-400">No activity yet.</p>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute bottom-0 left-[19px] top-0 w-px bg-slate-200" />
                        {historyEvents.map((entry, index) => {
                          const meta = EVT_META[entry.type] ?? { label: entry.type, iconBg: 'bg-slate-100', iconText: 'text-slate-700' }
                          const isLast = index === historyEvents.length - 1 && !nextStep
                          return (
                            <div key={`${entry.timestamp}-${index}`} className={cn('relative flex gap-4', isLast ? 'pb-0' : 'pb-5')}>
                              <div className={cn('relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white text-xs font-bold', meta.iconBg, meta.iconText)}>
                                {entry.user.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1 rounded-[24px] border border-slate-100 bg-white px-4 py-3 shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{entry.title ?? meta.label}</p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                      <span className="font-medium text-slate-700">{entry.user}</span>
                                      {' · '}
                                      {fmtTs(entry.timestamp)}
                                    </p>
                                  </div>
                                  <span className="text-[11px] text-slate-400">{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
                                </div>
                                {entry.details && <p className="mt-2 border-t border-slate-100 pt-2 text-sm leading-relaxed text-slate-600">{entry.details}</p>}
                                {entry.from && entry.to && (
                                  <div className="mt-2 flex items-center gap-2 text-xs">
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">{entry.from}</span>
                                    <span className="text-slate-300">to</span>
                                    <span className="rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-600">{entry.to}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}

                        {nextStep && (
                          <div className="relative flex gap-4">
                            <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-white">
                              <div className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                            </div>
                            <div className="min-w-0 flex-1 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-sm font-semibold text-slate-500">{isPendingApproval ? 'Awaiting Approval' : t.task_status === 'in_progress' ? 'In Progress' : 'Pending'}</p>
                              <p className="mt-1 text-sm text-slate-400">{nextStep}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'files' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Attach files</p>
                        <p className="text-xs text-slate-500">Any attached user can upload. Maximum 1 GB per file. No file-count limit.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={uploadFiles} />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingFiles}
                          className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                        >
                          <span className="inline-flex items-center gap-2">{uploadingFiles ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Upload Files</span>
                        </button>
                      </div>
                    </div>
                    {t.attachments.length === 0 ? (
                      <div className="py-16 text-center">
                        <Paperclip size={28} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-sm text-slate-400">No attachments for this task.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {t.attachments.map((attachment) => {
                          const ext = attachment.file_name.split('.').pop()?.toUpperCase() ?? 'FILE'
                          return (
                            <div key={attachment.id} className="flex flex-wrap items-center gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-[11px] font-bold text-blue-700">{ext}</div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-800">{attachment.file_name}</p>
                                <p className="text-xs text-slate-400">
                                  {attachment.uploaded_by} · {formatPakistanDate(attachment.created_at)}
                                  {attachment.file_size ? ` · ${(attachment.file_size / 1024).toFixed(0)} KB` : ''}
                                </p>
                              </div>
                              <a href={attachment.file_url} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50">
                                Open File
                              </a>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'share' && (
                  <div className="space-y-5">
                    <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                      <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Share with user</label>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <select
                          value={shareUsername}
                          onChange={(e) => setShareUsername(e.target.value)}
                          className="min-w-[220px] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="">Select a user to share with</option>
                          {shareUsers
                            .filter((user) => user.username !== t.username && !t.shares.some((share) => share.shared_with === user.username))
                            .map((user) => (
                              <option key={user.username} value={user.username}>
                                {user.username}{user.department ? ` - ${user.department}` : ''}{user.role ? ` (${user.role})` : ''}
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={() => {
                            if (!shareUsername.trim()) return
                            void doAction(() => shareTodoAction(t.id, shareUsername.trim()))
                            setShareUsername('')
                          }}
                          disabled={!shareUsername.trim() || isPending}
                          className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                        >
                          <span className="inline-flex items-center gap-2"><UserPlus size={14} /> Share</span>
                        </button>
                      </div>
                    </div>

                    {t.shares.length === 0 ? (
                      <p className="text-sm text-slate-400">This task is not shared with anyone yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {t.shares.map((share) => (
                          <div key={share.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-300 text-sm font-bold text-white">
                                {share.shared_with.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">{share.shared_with}</p>
                                <p className="text-xs text-slate-400">{share.can_edit ? 'Can edit' : 'View only'}</p>
                              </div>
                            </div>
                            {isCreator && (
                              <button onClick={() => doAction(() => unshareTodoAction(t.id, share.shared_with))} className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100">
                                <span className="inline-flex items-center gap-2"><UserMinus size={14} /> Remove</span>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <aside className="flex min-h-[720px] flex-col self-start overflow-hidden rounded-[32px] border border-white/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)] xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)]">
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-slate-900">Task Chat</p>
                    <p className="mt-1 text-sm text-slate-500">Conversation only for this task.</p>
                  </div>
                  <div className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-600">
                    {participants.length} users
                  </div>
                </div>
              </div>

              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  <Users size={14} />
                  Attached Users
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {participants.map((participant) => (
                    <button
                      key={participant.username}
                      type="button"
                      onClick={() => setComment((prev) => `${prev.trim()} @${participant.username}`.trim() + ' ')}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-orange-200 hover:bg-orange-50"
                    >
                      <p className="text-xs font-semibold text-slate-800">{participant.username}</p>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{participant.role}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {comments.length === 0 ? (
                  <div className="flex h-full min-h-[260px] items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-slate-50 text-center">
                    <div>
                      <MessageCircle size={28} className="mx-auto mb-3 text-slate-300" />
                      <p className="text-sm text-slate-500">No task chat yet.</p>
                    </div>
                  </div>
                ) : (
                  comments.map((entry, index) => {
                    const isMe = entry.user === currentUsername
                    return (
                      <div key={`${entry.timestamp}-${index}`} className={cn('flex gap-3', isMe && 'justify-end')}>
                        {!isMe && (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-300 text-sm font-bold text-white">
                            {entry.user.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className={cn('max-w-[85%]', isMe && 'items-end')}>
                          {entry.mention_users && entry.mention_users.length > 0 && (
                            <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-[0.14em]', isMe ? 'text-blue-200 text-right' : 'text-orange-500')}>
                              For {entry.mention_users.map((username) => `@${username}`).join(', ')}
                            </div>
                          )}
                          <div className={cn('rounded-[24px] px-4 py-3 text-sm shadow-sm', isMe ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800')}>
                            {renderCommentWithMentions(entry.details)}
                          </div>
                          <div className={cn('mt-1 px-1 text-[10px] text-slate-400', isMe && 'text-right')}>
                            {entry.user} · {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                          </div>
                        </div>
                        {isMe && (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                            {entry.user.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                <div className="rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a message for this task... Use @username to mention someone."
                    rows={3}
                    className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-slate-700 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && comment.trim()) {
                        e.preventDefault()
                        void doAction(() => addCommentAction(t.id, comment.trim()))
                        setComment('')
                      }
                    }}
                  />
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 pt-2">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Task-only discussion</p>
                    <button
                      onClick={() => {
                        if (!comment.trim()) return
                        void doAction(() => addCommentAction(t.id, comment.trim()))
                        setComment('')
                      }}
                      disabled={!comment.trim() || isPending}
                      className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                    >
                      {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {editTask && <CreateTaskModal editTask={editTask} onClose={() => setEditTask(null)} onSaved={refreshDetails} />}
    </>
  )
}

function MetaCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string | null
  accent?: 'red' | 'green'
}) {
  return (
    <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {icon}
        {label}
      </div>
      <p className={cn('text-sm font-semibold', accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-green-600' : 'text-slate-800')}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function Section({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {icon}
        {label}
      </div>
      {children}
    </section>
  )
}

function PrimaryBtn({
  icon,
  label,
  color,
  onClick,
  loading,
}: {
  icon: ReactNode
  label: string
  color: 'blue' | 'green' | 'red'
  onClick: () => void
  loading?: boolean
}) {
  const cls = {
    blue: 'bg-blue-600 text-white hover:bg-blue-700',
    green: 'bg-green-600 text-white hover:bg-green-700',
    red: 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
  }

  return (
    <button onClick={onClick} disabled={loading} className={cn('rounded-2xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60', cls[color])}>
      <span className="inline-flex items-center gap-2">
        {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
        {label}
      </span>
    </button>
  )
}
