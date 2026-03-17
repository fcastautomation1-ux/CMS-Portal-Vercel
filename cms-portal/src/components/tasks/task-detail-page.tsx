'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
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
import { CMS_STORAGE_BUCKET } from '@/lib/storage'
import { splitTaskMeta } from '@/lib/task-metadata'
import { normalizeTaskDescription } from '@/lib/task-description'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { queryKeys } from '@/lib/query-keys'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { Todo, TodoDetails, HistoryEntry } from '@/types'
import { CreateTaskModal } from './create-task-modal'
import {
  acknowledgeTaskAction,
  addCommentAction,
  approveTodoAction,
  archiveTodoAction,
  acceptMaAssigneeAction,
  acceptMaSubAssigneeAction,
  createTaskAttachmentUploadUrlAction,
  deleteTodoCommentAction,
  deleteTodoAttachmentAction,
  delegateMaAssigneeAction,
  editTodoCommentAction,
  declineTodoAction,
  deleteTodoAction,
  getTodoDetails,
  getUsersForAssignment,
  markTaskCommentsReadAction,
  rejectMaAssigneeAction,
  rejectMaSubAssigneeAction,
  removeMaDelegationAction,
  reopenMaAssigneeAction,
  saveTodoAttachmentAction,
  shareTodoAction,
  startTaskAction,
  toggleTodoCompleteAction,
  unshareTodoAction,
  updateMaAssigneeStatusAction,
  updateMaSubAssigneeStatusAction,
} from '@/app/dashboard/tasks/actions'

type TabId = 'info' | 'history' | 'files' | 'share' | 'timeline'
const MAX_ATTACHMENT_SIZE = 1024 * 1024 * 1024
const MAX_PARALLEL_UPLOADS = 3

type TaskActionDialogState =
  | { type: 'ma-submit' }
  | { type: 'delegate' }
  | { type: 'sub-submit'; delegatorUsername: string }
  | { type: 'reject-assignee'; assigneeUsername: string }
  | { type: 'reopen-assignee'; assigneeUsername: string }
  | { type: 'reject-sub'; delegatorUsername: string; subUsername: string }
  | { type: 'remove-delegation'; delegatorUsername: string; subUsername: string }
  | { type: 'delete-comment'; messageId: string }
  | null

const COMMENT_EDIT_WINDOW_MS = 10 * 60 * 1000

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

const EVT_META: Record<string, { label: string; emoji: string; badgeBg: string; badgeText: string; chipBg: string; chipText: string }> = {
  created: { label: 'Task Created', emoji: '✨', badgeBg: 'bg-blue-100', badgeText: 'text-blue-700', chipBg: 'bg-blue-50', chipText: 'text-blue-700' },
  assigned: { label: 'Assigned', emoji: '👥', badgeBg: 'bg-violet-100', badgeText: 'text-violet-700', chipBg: 'bg-violet-50', chipText: 'text-violet-700' },
  started: { label: 'In Progress', emoji: '🚀', badgeBg: 'bg-sky-100', badgeText: 'text-sky-700', chipBg: 'bg-sky-50', chipText: 'text-sky-700' },
  status_change: { label: 'Status Changed', emoji: '🔄', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700', chipBg: 'bg-slate-100', chipText: 'text-slate-700' },
  completed: { label: 'Completed', emoji: '✅', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700', chipBg: 'bg-emerald-50', chipText: 'text-emerald-700' },
  completion_submitted: { label: 'Submitted For Approval', emoji: '📨', badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', chipBg: 'bg-amber-50', chipText: 'text-amber-700' },
  approved: { label: 'Approved', emoji: '🎉', badgeBg: 'bg-green-100', badgeText: 'text-green-700', chipBg: 'bg-green-50', chipText: 'text-green-700' },
  declined: { label: 'Declined', emoji: '⛔', badgeBg: 'bg-red-100', badgeText: 'text-red-700', chipBg: 'bg-red-50', chipText: 'text-red-700' },
  edit: { label: 'Task Edited', emoji: '🛠️', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-700', chipBg: 'bg-indigo-50', chipText: 'text-indigo-700' },
  acknowledged: { label: 'Acknowledged', emoji: '👋', badgeBg: 'bg-cyan-100', badgeText: 'text-cyan-700', chipBg: 'bg-cyan-50', chipText: 'text-cyan-700' },
  comment: { label: 'Message Sent', emoji: '💬', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700', chipBg: 'bg-orange-50', chipText: 'text-orange-700' },
  uncompleted: { label: 'Reopened', emoji: '♻️', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700', chipBg: 'bg-orange-50', chipText: 'text-orange-700' },
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
  const seen = new Map<string, { username: string; role: string; avatarUrl: string | null }>()

  const addParticipant = (username: string | null | undefined, role: string) => {
    const value = (username ?? '').trim()
    if (!value || seen.has(value)) return
    seen.set(value, { username: value, role, avatarUrl: task.participant_avatars?.[value] ?? null })
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
function getActiveMentionQuery(value: string, caretIndex: number) {
  const uptoCaret = value.slice(0, caretIndex)
  const match = uptoCaret.match(/(^|\s)@([a-zA-Z0-9._-]*)$/)
  if (!match) return null
  return {
    query: match[2] ?? '',
    start: caretIndex - (match[2]?.length ?? 0) - 1,
    end: caretIndex,
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

export function TaskDetailPage({
  initialDetails,
  currentUsername,
  currentUserRole,
}: {
  initialDetails: TodoDetails
  currentUsername: string
  currentUserRole: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('info')
  const [comment, setComment] = useState('')
  const [shareUsername, setShareUsername] = useState('')
  const [shareUsers, setShareUsers] = useState<Array<{ username: string; role: string; department: string | null; avatar_data: string | null }>>([])
  const [declineReason, setDeclineReason] = useState('')
  const [showDeclineInput, setShowDeclineInput] = useState(false)
  const [editTask, setEditTask] = useState<Todo | null>(null)
  const [actionError, setActionError] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ progress: number; fileName: string; currentFile: number; totalFiles: number; stage: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [taskDialog, setTaskDialog] = useState<TaskActionDialogState>(null)
  const [dialogValue, setDialogValue] = useState('')
  const [dialogExtraValue, setDialogExtraValue] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const refreshTimerRef = useRef<number | null>(null)

  const detailsQuery = useQuery({
    queryKey: queryKeys.taskDetail(initialDetails.id),
    queryFn: async () => {
      const updated = await getTodoDetails(initialDetails.id)
      return updated ?? initialDetails
    },
    initialData: initialDetails,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const details = detailsQuery.data ?? initialDetails
  const appNames = splitTaskMeta(details.app_name)
  const packageNames = splitTaskMeta(details.package_name)

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

  useEffect(() => {
    if (!uploadingFiles) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [uploadingFiles])

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
    setUploadProgress({ progress: 5, fileName: files[0]?.name ?? '', currentFile: 1, totalFiles: files.length, stage: 'Preparing upload' })

    try {
      const supabase = createBrowserClient()
      let completed = 0
      const totalFiles = files.length

      const updateCounterProgress = (fileName: string, stage: string) => {
        const progress = Math.max(5, Math.min(100, Math.round((completed / totalFiles) * 100)))
        setUploadProgress({
          progress,
          fileName,
          currentFile: Math.min(completed + 1, totalFiles),
          totalFiles,
          stage,
        })
      }

      await runWithConcurrency(files, MAX_PARALLEL_UPLOADS, async (file) => {
        updateCounterProgress(file.name, 'Preparing secure upload')
        const signedUpload = await createTaskAttachmentUploadUrlAction({
          todo_id: details.id,
          owner_username: details.username,
          file_name: file.name,
        })

        if (!signedUpload.success || !signedUpload.path || !signedUpload.token) {
          throw new Error(signedUpload.error ?? 'Unable to prepare file upload.')
        }

        updateCounterProgress(file.name, 'Uploading file')
        const upload = await supabase.storage
          .from(signedUpload.bucket || CMS_STORAGE_BUCKET)
          .uploadToSignedUrl(signedUpload.path, signedUpload.token, file)

        if (upload.error) throw new Error(upload.error.message)

        updateCounterProgress(file.name, 'Saving attachment record')
        const saved = await saveTodoAttachmentAction({
          todo_id: details.id,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          storage_path: signedUpload.path,
        })

        if (!saved.success) throw new Error(saved.error ?? `Failed to attach ${file.name}`)
        completed += 1
        updateCounterProgress(file.name, completed === totalFiles ? 'Completed' : 'Uploading files')
      })

      await refreshDetails()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Attachment upload failed.')
    } finally {
      window.setTimeout(() => setUploadProgress(null), 600)
      setUploadingFiles(false)
    }
  }

  const t = details
  const isAdminOrSuperManager = currentUserRole === 'Admin' || currentUserRole === 'Super Manager'
  const isCreator = t.username === currentUsername
  const isAssignee = t.assigned_to === currentUsername
  const isPendingApproval = t.approval_status === 'pending_approval'
  const isCompleted = t.completed
  const ma = t.multi_assignment
  const myMaEntry = ma?.assignees?.find((entry) => (entry.username || '').toLowerCase() === currentUsername.toLowerCase())
  const delegatedOwner = ma?.assignees?.find((entry) => Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase()))
  const myDelegatedEntry = delegatedOwner?.delegated_to?.find((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase())
  const sm = STATUS_META[t.task_status] ?? STATUS_META.backlog
  const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.medium
  const comments = t.history.filter((h: HistoryEntry) => h.type === 'comment' && (!h.is_deleted || isAdminOrSuperManager))
  const historyEvents = t.history.filter((h: HistoryEntry) => h.type !== 'comment')
  const activityTimeline = [...historyEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const combinedTimeline = [...t.history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const nextStep = nextStepLabel(t)
  const participants = getTaskParticipants(t)
  const assignedSummary = getAssignedSummary(t)
  const departmentSummary = getDepartmentSummary(t)
  const activeMention = getActiveMentionQuery(comment, commentInputRef.current?.selectionStart ?? comment.length)
  const mentionSuggestions = activeMention
    ? participants.filter((participant) => participant.username.toLowerCase().includes(activeMention.query.toLowerCase()))
    : []

  useEffect(() => {
    const hasUnreadComments = comments.some((entry) =>
      Array.isArray(entry.unread_by) && entry.unread_by.some((username) => username.toLowerCase() === currentUsername.toLowerCase())
    )
    if (!hasUnreadComments) return
    void markTaskCommentsReadAction(t.id)
  }, [comments, currentUsername, t.id])

  const insertMention = (username: string) => {
    const textarea = commentInputRef.current
    const selectionStart = textarea?.selectionStart ?? comment.length
    const selectionEnd = textarea?.selectionEnd ?? selectionStart
    const active = getActiveMentionQuery(comment, selectionStart)
    if (!active) return

    const nextValue = `${comment.slice(0, active.start)}@${username} ${comment.slice(selectionEnd)}`
    setComment(nextValue)
    setMentionIndex(0)

    window.requestAnimationFrame(() => {
      const nextCaret = active.start + username.length + 2
      textarea?.focus()
      textarea?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const openTaskDialog = (dialog: NonNullable<TaskActionDialogState>) => {
    setDialogValue('')
    setDialogExtraValue('')
    setTaskDialog(dialog)
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
        void doAction(() => updateMaAssigneeStatusAction(t.id, 'completed', dialogValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'delegate':
        if (!dialogValue.trim()) {
          setActionError('Please enter a username for delegation.')
          return
        }
        void doAction(() => delegateMaAssigneeAction(t.id, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'sub-submit':
        void doAction(() => updateMaSubAssigneeStatusAction(t.id, taskDialog.delegatorUsername, 'completed', dialogValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'reject-assignee':
        if (!dialogValue.trim()) {
          setActionError('Feedback is required.')
          return
        }
        void doAction(() => rejectMaAssigneeAction(t.id, taskDialog.assigneeUsername, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'reopen-assignee':
        if (!dialogValue.trim()) {
          setActionError('Feedback is required.')
          return
        }
        if (!dialogExtraValue.trim()) {
          setActionError('New due date is required.')
          return
        }
        void doAction(() => reopenMaAssigneeAction(t.id, taskDialog.assigneeUsername, dialogValue.trim(), dialogExtraValue.trim()))
        closeTaskDialog()
        return
      case 'reject-sub':
        if (!dialogValue.trim()) {
          setActionError('Feedback is required.')
          return
        }
        void doAction(() => rejectMaSubAssigneeAction(t.id, taskDialog.delegatorUsername, taskDialog.subUsername, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'remove-delegation':
        void doAction(() => removeMaDelegationAction(t.id, taskDialog.delegatorUsername, taskDialog.subUsername))
        closeTaskDialog()
        return
      case 'delete-comment':
        applyOptimisticCommentDelete(taskDialog.messageId)
        void doAction(() => deleteTodoCommentAction(t.id, taskDialog.messageId))
        closeTaskDialog()
        return
      default:
        return
    }
  }

  const canManageComment = (entry: HistoryEntry) => {
    if (entry.type !== 'comment' || entry.is_deleted) return false
    if ((entry.user || '').toLowerCase() !== currentUsername.toLowerCase()) return false
    const sentAt = new Date(entry.timestamp).getTime()
    if (Number.isNaN(sentAt)) return false
    return Date.now() - sentAt <= COMMENT_EDIT_WINDOW_MS
  }

  const startEditingComment = (entry: HistoryEntry) => {
    if (!entry.message_id || !canManageComment(entry)) return
    setEditingCommentId(entry.message_id)
    setEditingCommentText(entry.details)
  }

  const cancelEditingComment = () => {
    setEditingCommentId(null)
    setEditingCommentText('')
  }

  const applyOptimisticCommentEdit = (messageId: string, nextText: string) => {
    const nowIso = new Date().toISOString()
    queryClient.setQueryData<TodoDetails>(queryKeys.taskDetail(t.id), (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        history: prev.history.map((item) =>
          item.message_id === messageId
            ? {
                ...item,
                details: nextText,
                edited_at: nowIso,
              }
            : item
        ),
      }
    })
  }

  const applyOptimisticCommentDelete = (messageId: string) => {
    const nowIso = new Date().toISOString()
    queryClient.setQueryData<TodoDetails>(queryKeys.taskDetail(t.id), (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        history: prev.history.map((item) =>
          item.message_id === messageId
            ? {
                ...item,
                is_deleted: true,
                deleted_at: nowIso,
              }
            : item
        ),
      }
    })
  }

  const saveEditedComment = (entry: HistoryEntry) => {
    if (!entry.message_id || !editingCommentText.trim()) return
    const nextText = editingCommentText.trim()
    applyOptimisticCommentEdit(entry.message_id, nextText)
    void doAction(() => editTodoCommentAction(t.id, entry.message_id!, nextText))
    cancelEditingComment()
  }

  const deleteComment = (entry: HistoryEntry) => {
    if (!entry.message_id) return
    openTaskDialog({ type: 'delete-comment', messageId: entry.message_id })
  }

  const handleCommentKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((prev) => (prev + 1) % mentionSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        insertMention(mentionSuggestions[mentionIndex]?.username ?? mentionSuggestions[0].username)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionIndex(0)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && comment.trim()) {
      e.preventDefault()
      void doAction(() => addCommentAction(t.id, comment.trim()))
      setComment('')
      setMentionIndex(0)
    }
  }

  const tabs = [
    { id: 'info' as const, label: 'Details' },
    { id: 'history' as const, label: `Activity${historyEvents.length ? ` (${historyEvents.length})` : ''}` },
    { id: 'files' as const, label: `Files${t.attachments.length ? ` (${t.attachments.length})` : ''}` },
    { id: 'share' as const, label: `Shared${t.shares.length ? ` (${t.shares.length})` : ''}` },
    { id: 'timeline' as const, label: `Activity & Conversation${t.history.length ? ` (${t.history.length})` : ''}` },
  ]

  const renderTimeline = (entries: HistoryEntry[], options?: { emptyText?: string; includeConversationHint?: boolean; showNextStep?: boolean }) => {
    const emptyText = options?.emptyText ?? 'No activity yet.'

    if (entries.length === 0 && !(options?.showNextStep && nextStep)) {
      return (
        <div className="py-16 text-center">
          <Clock size={28} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm text-slate-400">{emptyText}</p>
        </div>
      )
    }

    return (
      <div className="relative pl-1">
        <div className="absolute bottom-0 left-[21px] top-0 w-px bg-gradient-to-b from-blue-200 via-slate-200 to-transparent" />
        {entries.map((entry, index) => {
          const meta = EVT_META[entry.type] ?? { label: entry.type, emoji: '📝', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700', chipBg: 'bg-slate-100', chipText: 'text-slate-700' }
          const isComment = entry.type === 'comment'
          const isLast = index === entries.length - 1 && !(options?.showNextStep && nextStep)

          return (
            <div key={`${entry.timestamp}-${index}`} className={cn('relative flex gap-4', isLast ? 'pb-0' : 'pb-5')}>
              <div className="relative z-10 mt-0.5">
                <UserAvatar username={entry.user} avatarUrl={t.participant_avatars?.[entry.user] ?? null} className="ring-4 ring-white shadow-sm" />
                <span className={cn('absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] shadow-sm', meta.badgeBg, meta.badgeText)}>
                  {meta.emoji}
                </span>
              </div>

              <div className="min-w-0 flex-1 rounded-[26px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{entry.title ?? meta.label}</p>
                      <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]', meta.chipBg, meta.chipText)}>
                        {isComment ? 'Conversation' : 'Activity'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{entry.user}</span>
                      {' · '}
                      {fmtTs(entry.timestamp)}
                    </p>
                  </div>
                  <span className="text-[11px] font-medium text-slate-400">{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
                </div>

                {isComment ? (
                  <div className="mt-3 rounded-[22px] border border-orange-100 bg-orange-50/70 px-4 py-3 text-sm leading-relaxed text-slate-700">
                    {renderCommentWithMentions(entry.details)}
                  </div>
                ) : entry.details ? (
                  <div className="mt-3 rounded-[22px] border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
                    {entry.details}
                  </div>
                ) : null}

                {(entry.from && entry.to) || (entry.mention_users && entry.mention_users.length > 0) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {entry.from && entry.to && (
                      <>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">{entry.from}</span>
                        <span className="text-xs font-semibold text-slate-300">→</span>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">{entry.to}</span>
                      </>
                    )}
                    {entry.mention_users?.map((username) => (
                      <span key={`${entry.timestamp}-${username}`} className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-600">
                        @{username}
                      </span>
                    ))}
                  </div>
                ) : null}

                {options?.includeConversationHint && isComment && (
                  <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.16em] text-orange-500">Task chat message</p>
                )}
              </div>
            </div>
          )
        })}

        {options?.showNextStep && nextStep && (
          <div className="relative mt-1 flex gap-4">
            <div className="relative z-10 mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-white text-sm shadow-sm">
              ⏭️
            </div>
            <div className="min-w-0 flex-1 rounded-[24px] border border-dashed border-blue-200 bg-blue-50/60 px-4 py-3">
              <p className="text-sm font-semibold text-slate-700">{isPendingApproval ? 'Awaiting Approval' : t.task_status === 'in_progress' ? 'Next Step' : 'Pending Step'}</p>
              <p className="mt-1 text-sm text-slate-500">{nextStep}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

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
                {appNames.length > 0 && <span className="flex items-center gap-1.5 font-medium text-blue-600"><Tag size={14} /> {appNames.join(', ')}</span>}
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
              {myMaEntry && !isCompleted && myMaEntry.status === 'pending' && (
                <PrimaryBtn icon={<PlayCircle size={14} />} label="MA Start" color="blue" onClick={() => doAction(() => updateMaAssigneeStatusAction(t.id, 'in_progress'))} loading={isPending} />
              )}
              {myMaEntry && !isCompleted && myMaEntry.status === 'in_progress' && (
                <PrimaryBtn
                  icon={<CheckCircle2 size={14} />}
                  label="MA Submit"
                  color="green"
                  onClick={() => openTaskDialog({ type: 'ma-submit' })}
                  loading={isPending}
                />
              )}
              {myMaEntry && !isCompleted && (
                <button
                  onClick={() => openTaskDialog({ type: 'delegate' })}
                  className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                >
                  Delegate
                </button>
              )}
              {myDelegatedEntry && !isCompleted && myDelegatedEntry.status === 'pending' && (
                <button
                  onClick={() => void doAction(() => updateMaSubAssigneeStatusAction(t.id, delegatedOwner!.username, 'in_progress'))}
                  className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                  Sub Start
                </button>
              )}
              {myDelegatedEntry && !isCompleted && myDelegatedEntry.status === 'in_progress' && (
                <button
                  onClick={() => openTaskDialog({ type: 'sub-submit', delegatorUsername: delegatedOwner!.username })}
                  className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                >
                  Sub Submit
                </button>
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
                <div className={cn('space-y-6', activeTab === 'info' ? 'block' : 'hidden')}>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <MetaCard icon={<User size={13} className="text-purple-500" />} label="Assigned To" value={assignedSummary.value} sub={assignedSummary.sub} />
                      <MetaCard icon={<Building2 size={13} className="text-blue-500" />} label={`Departments (${departmentSummary.count})`} value={departmentSummary.label} />
                      <MetaCard icon={<Calendar size={13} className="text-orange-500" />} label="Due Date" value={t.due_date ? formatPakistanDate(t.due_date) : '-'} accent={!isCompleted && t.due_date && new Date(t.due_date) < new Date() ? 'red' : undefined} />
                      <MetaCard icon={<Target size={13} className="text-pink-500" />} label="KPI Type" value={t.kpi_type ?? '-'} />
                      <MetaCard icon={<Tag size={13} className="text-blue-500" />} label="Apps" value={appNames.join(', ') || '-'} />
                      <MetaCard icon={<Link2 size={13} className="text-cyan-500" />} label="Packages" value={packageNames.join(', ') || '-'} />
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
                        <div className="grid gap-3">
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
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {isCreator && assignee.status === 'completed' && (
                                    <>
                                      <button onClick={() => void doAction(() => acceptMaAssigneeAction(t.id, assignee.username))} className="rounded-2xl bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700">
                                        Accept
                                      </button>
                                      <button
                                        onClick={() => openTaskDialog({ type: 'reject-assignee', assigneeUsername: assignee.username })}
                                        className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}
                                  {isCreator && assignee.status === 'accepted' && (
                                    <button
                                      onClick={() => openTaskDialog({ type: 'reopen-assignee', assigneeUsername: assignee.username })}
                                      className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                                    >
                                      Reopen
                                    </button>
                                  )}
                                </div>
                                {Array.isArray(assignee.delegated_to) && assignee.delegated_to.length > 0 && (
                                  <div className="mt-3 space-y-2 rounded-[20px] border border-sky-100 bg-white/70 p-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">Delegated To</div>
                                    {assignee.delegated_to.map((sub) => {
                                      const subStatus = sub.status || 'pending'
                                      const isDelegator = assignee.username.toLowerCase() === currentUsername.toLowerCase()
                                      const isSubMe = (sub.username || '').toLowerCase() === currentUsername.toLowerCase()
                                      return (
                                        <div key={`${assignee.username}-${sub.username}`} className="rounded-2xl border border-slate-100 bg-white px-3 py-3">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-slate-800">{sub.username}</span>
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">{subStatus}</span>
                                            {sub.notes && <span className="text-[11px] text-amber-700">Note: {sub.notes}</span>}
                                          </div>
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {isSubMe && subStatus === 'pending' && (
                                              <button onClick={() => void doAction(() => updateMaSubAssigneeStatusAction(t.id, assignee.username, 'in_progress'))} className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                                                Start
                                              </button>
                                            )}
                                            {isSubMe && subStatus === 'in_progress' && (
                                              <button
                                                onClick={() => openTaskDialog({ type: 'sub-submit', delegatorUsername: assignee.username })}
                                                className="rounded-2xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-100"
                                              >
                                                Submit
                                              </button>
                                            )}
                                            {isDelegator && subStatus === 'completed' && (
                                              <>
                                                <button onClick={() => void doAction(() => acceptMaSubAssigneeAction(t.id, assignee.username, sub.username))} className="rounded-2xl bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700">
                                                  Accept
                                                </button>
                                                <button
                                                  onClick={() => openTaskDialog({ type: 'reject-sub', delegatorUsername: assignee.username, subUsername: sub.username })}
                                                  className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                                                >
                                                  Reject
                                                </button>
                                              </>
                                            )}
                                            {isDelegator && (
                                              <button
                                                onClick={() => openTaskDialog({ type: 'remove-delegation', delegatorUsername: assignee.username, subUsername: sub.username })}
                                                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                                              >
                                                Remove
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </Section>
                    )}
                  </div>

                <div className={activeTab === 'history' ? 'block' : 'hidden'}>
                  <div className="mb-4 rounded-[24px] border border-blue-100 bg-[linear-gradient(135deg,rgba(59,130,246,0.10),rgba(255,255,255,0.95))] px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">Activity Feed</p>
                        <p className="mt-1 text-xs text-slate-500">Every task action in one clean audit trail with actors, timestamps, and state changes.</p>
                      </div>
                      <div className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600 shadow-sm">
                        {activityTimeline.length} actions
                      </div>
                    </div>
                  </div>
                  {renderTimeline(activityTimeline, { showNextStep: true })}
                </div>

                <div className={cn('space-y-4', activeTab === 'files' ? 'block' : 'hidden')}>
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
                    {uploadProgress && (
                      <div className="rounded-[24px] border border-blue-100 bg-[linear-gradient(135deg,rgba(59,130,246,0.10),rgba(255,255,255,0.95))] p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Uploading attachment</p>
                            <p className="mt-1 text-xs text-slate-500">File {uploadProgress.currentFile} of {uploadProgress.totalFiles} · {uploadProgress.fileName}</p>
                          </div>
                          <div className="text-sm font-bold text-blue-600">{uploadProgress.progress}%</div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                          <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${uploadProgress.progress}%` }} />
                        </div>
                        <p className="mt-2 text-xs font-medium text-blue-700">{uploadProgress.stage}</p>
                      </div>
                    )}
                    {t.attachments.length === 0 ? (
                      <div className="py-16 text-center">
                        <Paperclip size={28} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-sm text-slate-400">No attachments for this task.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {t.attachments.map((attachment) => {
                          const ext = attachment.file_name.split('.').pop()?.toUpperCase() ?? 'FILE'
                          const canRemoveAttachment = !isCompleted && (attachment.uploaded_by === currentUsername || isCreator)
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
                              {canRemoveAttachment && (
                                <button
                                  type="button"
                                  onClick={() => void doAction(() => deleteTodoAttachmentAction(t.id, attachment.id))}
                                  className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                <div className={cn('space-y-5', activeTab === 'share' ? 'block' : 'hidden')}>
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

                <div className={cn('space-y-5', activeTab === 'timeline' ? 'block' : 'hidden')}>
                    <div className="rounded-[24px] border border-orange-100 bg-[linear-gradient(135deg,rgba(249,115,22,0.10),rgba(255,255,255,0.96))] px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">Activity & Conversation</p>
                          <p className="mt-1 text-xs text-slate-500">A full timeline of task actions, assignments, approvals, and chat messages in order.</p>
                        </div>
                        <div className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600 shadow-sm">
                          {combinedTimeline.length} events
                        </div>
                      </div>
                    </div>
                    {renderTimeline(combinedTimeline, { emptyText: 'No activity or conversation yet.', includeConversationHint: true, showNextStep: true })}
                  </div>
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {participants.map((participant) => (
                    <button
                      key={participant.username}
                      type="button"
                      title={`${participant.username} (${participant.role})`}
                      aria-label={`${participant.username} (${participant.role})`}
                      onClick={() => insertMention(participant.username)}
                      className="group flex rounded-full border border-slate-200 bg-slate-50 p-0.5 transition-colors hover:border-orange-200 hover:bg-orange-50"
                    >
                      <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} size="lg" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {comments.length === 0 ? (
                  <div className="flex h-full min-h-[360px] items-center justify-center rounded-[32px] border border-dashed border-slate-200 bg-slate-50 text-center">
                    <div>
                      <MessageCircle size={34} className="mx-auto mb-4 text-slate-300" />
                      <p className="text-base text-slate-500">No task chat yet.</p>
                    </div>
                  </div>
                ) : (
                  comments.map((entry, index) => {
                    const isMe = entry.user === currentUsername
                    const canManage = canManageComment(entry)
                    const isEditing = editingCommentId === entry.message_id
                    return (
                      <div key={`${entry.timestamp}-${index}`} className={cn('flex gap-3', isMe && 'justify-end')}>
                        {!isMe && (
                          <UserAvatar username={entry.user} avatarUrl={t.participant_avatars?.[entry.user] ?? null} />
                        )}
                        <div className={cn('max-w-[85%]', isMe && 'items-end')}>
                          {entry.mention_users && entry.mention_users.length > 0 && !entry.is_deleted && (
                            <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-[0.14em]', isMe ? 'text-blue-200 text-right' : 'text-orange-500')}>
                              For {entry.mention_users.map((username) => `@${username}`).join(', ')}
                            </div>
                          )}
                          <div className={cn('rounded-[24px] px-4 py-3 text-sm shadow-sm', isMe ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800', entry.is_deleted && 'bg-slate-200 text-slate-500')}>
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editingCommentText}
                                  onChange={(e) => setEditingCommentText(e.target.value)}
                                  rows={3}
                                  className="w-full resize-none rounded-2xl border border-white/40 bg-white/90 px-3 py-2 text-sm text-slate-700 outline-none"
                                />
                                <div className="flex justify-end gap-2">
                                  <button onClick={cancelEditingComment} className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">Cancel</button>
                                  <button onClick={() => saveEditedComment(entry)} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">Save</button>
                                </div>
                              </div>
                            ) : (
                              renderCommentWithMentions(entry.details)
                            )}
                          </div>
                          {!isEditing && (canManage || entry.edited_at) && (
                            <div className={cn('mt-1 flex items-center gap-2 px-1 text-[10px]', isMe ? 'justify-end' : 'justify-start')}>
                              {entry.edited_at && !entry.is_deleted && <span className="text-slate-400">edited</span>}
                              {canManage && !entry.is_deleted && (
                                <>
                                  <button onClick={() => startEditingComment(entry)} className="font-semibold text-blue-500 hover:text-blue-600">Edit</button>
                                  <button onClick={() => deleteComment(entry)} className="font-semibold text-red-500 hover:text-red-600">Delete</button>
                                </>
                              )}
                            </div>
                          )}
                          <div className={cn('mt-1 px-1 text-[10px] text-slate-400', isMe && 'text-right')}>
                            {entry.user} · {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                          </div>
                        </div>
                        {isMe && (
                          <UserAvatar username={entry.user} avatarUrl={t.participant_avatars?.[entry.user] ?? null} className="bg-blue-100 text-blue-700" />
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                <div className="rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm">
                  <textarea
                    ref={commentInputRef}
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value)
                      setMentionIndex(0)
                    }}
                    placeholder="Write a message for this task... Use @username to mention someone."
                    rows={3}
                    className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-slate-700 outline-none"
                    onClick={() => setMentionIndex(0)}
                    onKeyUp={() => setMentionIndex(0)}
                    onKeyDown={handleCommentKeyDown}
                  />
                  {mentionSuggestions.length > 0 && (
                    <div className="mx-2 mb-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
                      {mentionSuggestions.slice(0, 6).map((participant, index) => (
                        <button
                          key={participant.username}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertMention(participant.username)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                            index === mentionIndex ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white'
                          )}
                        >
                          <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} className="bg-white" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">@{participant.username}</span>
                            <span className="block text-[11px] uppercase tracking-[0.14em] text-slate-400">{participant.role}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-end border-t border-slate-100 px-2 pt-2">
                    <button
                      onClick={() => {
                        if (!comment.trim()) return
                        void doAction(() => addCommentAction(t.id, comment.trim()))
                        setComment('')
                        setMentionIndex(0)
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

      {taskDialog && (
        <ActionDialog
          title={
            taskDialog.type === 'delegate' ? 'Delegate task work' :
            taskDialog.type === 'remove-delegation' ? 'Remove delegation' :
            taskDialog.type === 'reopen-assignee' ? 'Reopen accepted work' :
            taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Send feedback' :
            taskDialog.type === 'delete-comment' ? 'Delete message' :
            'Add summary'
          }
          description={
            taskDialog.type === 'delegate' ? 'Assign this work to another username with optional instructions.' :
            taskDialog.type === 'remove-delegation' ? 'This removes the delegated user from the task workflow.' :
            taskDialog.type === 'reopen-assignee' ? 'Explain why this accepted work should be reopened.' :
            taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Give clear feedback so the work can be corrected.' :
            taskDialog.type === 'delete-comment' ? 'This will remove the message from the conversation.' :
            'Add an optional summary for this submission.'
          }
          primaryLabel={taskDialog.type === 'remove-delegation' ? 'Remove delegation' : taskDialog.type === 'delete-comment' ? 'Delete message' : 'Confirm'}
          onClose={closeTaskDialog}
          onConfirm={submitTaskDialog}
        >
          {taskDialog.type === 'delegate' ? (
            <div className="space-y-3">
              <DialogInput label="Username" value={dialogValue} onChange={setDialogValue} placeholder="Enter username" />
              <DialogTextarea label="Instructions (optional)" value={dialogExtraValue} onChange={setDialogExtraValue} placeholder="Add delegation notes or instructions" />
            </div>
          ) : taskDialog.type === 'remove-delegation' ? (
            <p className="text-sm text-slate-600">Remove delegated access for <span className="font-semibold text-slate-900">{taskDialog.subUsername}</span>?</p>
          ) : taskDialog.type === 'delete-comment' ? (
            <p className="text-sm text-slate-600">Are you sure you want to delete this message?</p>
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

      {editTask && <CreateTaskModal editTask={editTask} onClose={() => setEditTask(null)} onSaved={refreshDetails} />}
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
