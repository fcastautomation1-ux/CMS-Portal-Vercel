'use client'

import { useState, useTransition, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  RotateCcw,
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
import { createBrowserClient } from '@/lib/supabase/client'
import { formatPakistanDate, formatPakistanDateTime } from '@/lib/pakistan-time'
import { CMS_STORAGE_BUCKET } from '@/lib/storage'
import { splitTaskMeta } from '@/lib/task-metadata'
import { normalizeTaskDescription } from '@/lib/task-description'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { queryKeys } from '@/lib/query-keys'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { TaskHandoffDialog } from '@/components/tasks/task-handoff-dialog'
import { formatDistanceToNow } from 'date-fns'
import type { Todo, TodoDetails, HistoryEntry } from '@/types'
import {
  getTodoDetails,
  addCommentAction,
  acknowledgeTaskAction,
  acceptMaAssigneeAction,
  acceptMaSubAssigneeAction,
  delegateMaAssigneeAction,
  toggleTodoCompleteAction,
  rejectMaAssigneeAction,
  rejectMaSubAssigneeAction,
  removeMaDelegationAction,
  reopenMaAssigneeAction,
  startTaskAction,
  approveTodoAction,
  declineTodoAction,
  shareTodoAction,
  unshareTodoAction,
  deleteTodoAction,
  createTaskAttachmentUploadUrlAction,
  deleteTodoAttachmentAction,
  deleteTodoCommentAction,
  editTodoCommentAction,
  getUsersForAssignment,
  convertTaskToMultiAssignmentAction,
  saveTodoAttachmentAction,
  markTaskCommentsReadAction,
  archiveTodoAction,
  sendTaskToDepartmentQueueAction,
  updateAssignmentStepAction,
  updateMaAssigneeStatusAction,
  updateMaSubAssigneeStatusAction,
  updateSingleTaskDueDateAction,
} from '@/app/dashboard/tasks/actions'

const COMMENT_EDIT_WINDOW_MS = 10 * 60 * 1000
const TASK_WORKFLOW_FOCUS_KEY = 'cms-task-workflow-focus'

interface TaskDetailModalProps {
  taskId: string
  currentUsername: string
  currentUserRole?: string
  onClose: () => void
  onEdit: (task: Todo) => void
  onRefresh: () => void
}

type TaskActionDialogState =
  | { type: 'ma-submit' }
  | { type: 'complete' }
  | { type: 'single-due-date' }
  | { type: 'step-edit'; assigneeUsername: string }
  | { type: 'reassign' }
  | { type: 'split-multi' }
  | { type: 'delegate' }
  | { type: 'sub-submit'; delegatorUsername: string }
  | { type: 'reject-assignee'; assigneeUsername: string }
  | { type: 'reopen-assignee'; assigneeUsername: string }
  | { type: 'reject-sub'; delegatorUsername: string; subUsername: string }
  | { type: 'remove-delegation'; delegatorUsername: string; subUsername: string }
  | { type: 'delete-comment'; messageId: string }
  | null

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
  if (task.approval_status === 'pending_approval') return `Waiting for approval from ${task.pending_approver || task.username}`
  if (task.task_status === 'in_progress') return 'Pending action from assigned agent'
  if (task.task_status === 'backlog' || task.task_status === 'todo') return 'Waiting to be started'
  return null
}

function fmtTs(ts: string) {
  try { return formatPakistanDateTime(ts) } catch { return ts }
}

const MAX_ATTACHMENT_SIZE = 1024 * 1024 * 1024
const MAX_PARALLEL_UPLOADS = 3

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
    label: list.length ? list.join(', ') : '—',
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
    value: '—',
    sub: null,
  }
}

function getAssigneeDueDate(task: TodoDetails, username: string) {
  const assignee = task.multi_assignment?.assignees?.find((entry) => entry.username === username)
  return assignee?.actual_due_date ?? task.due_date ?? task.expected_due_date ?? null
}

function getAssignmentStepOwner(task: TodoDetails, assigneeUsername: string): string | null {
  const target = String(assigneeUsername || '').trim().toLowerCase()
  if (!target) return null

  for (let i = task.assignment_chain.length - 1; i >= 0; i -= 1) {
    const entry = task.assignment_chain[i]
    if ((entry.next_user || '').trim().toLowerCase() === target && entry.user?.trim()) {
      return entry.user.trim()
    }
  }

  if ((task.assigned_to || '').trim().toLowerCase() === target) {
    for (let i = task.assignment_chain.length - 1; i >= 0; i -= 1) {
      const entry = task.assignment_chain[i]
      if ((entry.role || '').trim() === 'claimed_from_department' && (entry.user || '').trim().toLowerCase() === target) {
        return entry.user.trim()
      }
    }
    return task.username || null
  }

  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    const exists = task.multi_assignment.assignees.some((entry) => (entry.username || '').trim().toLowerCase() === target)
    if (exists && task.multi_assignment.created_by) {
      return task.multi_assignment.created_by
    }
  }

  return null
}

function getAssignmentStepNote(task: TodoDetails, assigneeUsername: string): string {
  const target = String(assigneeUsername || '').trim().toLowerCase()
  if (!target) return ''
  for (let i = task.assignment_chain.length - 1; i >= 0; i -= 1) {
    const entry = task.assignment_chain[i]
    if ((entry.next_user || '').trim().toLowerCase() === target) {
      return entry.feedback?.trim() || ''
    }
  }
  return ''
}

type WorkflowTreeNode = {
  key: string
  label: string
  tone: 'user' | 'department' | 'multi' | 'active'
  avatarUrl?: string | null
  title: string
  subtitle?: string
  focusTarget?: string
  children?: WorkflowTreeNode[]
}

type WorkflowTreeRow = {
  node: WorkflowTreeNode
  depth: number
  pathHasNext: boolean[]
  isLast: boolean
}

function buildWorkflowTree(task: TodoDetails): WorkflowTreeNode[] {
  const creator = String(task.username || '').trim()
  if (!creator) return []

  const root: WorkflowTreeNode = {
    key: `creator:${creator}`,
    label: creator,
    tone: 'user',
    avatarUrl: task.participant_avatars?.[creator] ?? null,
    title: `Created by ${creator}`,
    subtitle: 'Created here',
    focusTarget: creator,
    children: [],
  }

  const childrenByKey = new Map<string, WorkflowTreeNode[]>()
  childrenByKey.set(root.key, root.children!)
  const latestKeyByUser = new Map<string, string>()
  latestKeyByUser.set(creator.toLowerCase(), root.key)
  let fallbackParentKey = root.key

  const addChild = (parentKey: string, node: WorkflowTreeNode) => {
    if (!childrenByKey.has(parentKey)) childrenByKey.set(parentKey, [])
    childrenByKey.get(parentKey)!.push(node)
    node.children = []
    childrenByKey.set(node.key, node.children)
    latestKeyByUser.set(node.label.toLowerCase(), node.key)
  }

  ;(task.assignment_chain || []).forEach((entry, index) => {
    const target = String(entry.next_user || '').trim()
    if (!target) return
    const actor = String(entry.user || '').trim()
    const isDepartmentStep = ['routed_to_department_queue', 'queued_department'].includes(String(entry.role || ''))
    const parentKey = latestKeyByUser.get(actor.toLowerCase()) || fallbackParentKey
    addChild(parentKey, {
      key: `step:${index}:${target}`,
      label: target,
      tone: isDepartmentStep ? 'department' : 'user',
      avatarUrl: isDepartmentStep ? null : (task.participant_avatars?.[target] ?? null),
      title: isDepartmentStep ? `${actor} routed to ${target}` : `${actor} assigned to ${target}`,
      subtitle: isDepartmentStep ? `Sent by ${actor}` : `From ${actor}`,
      focusTarget: target,
    })
    fallbackParentKey = `step:${index}:${target}`
  })

  if (task.assigned_to && !latestKeyByUser.has(task.assigned_to.toLowerCase())) {
    addChild(root.key, {
      key: `assignee:${task.assigned_to}`,
      label: task.assigned_to,
      tone: task.task_status === 'in_progress' ? 'active' : 'user',
      avatarUrl: task.participant_avatars?.[task.assigned_to] ?? null,
      title: `Currently assigned to ${task.assigned_to}`,
      subtitle: 'Current owner',
      focusTarget: task.assigned_to,
    })
  }

  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    task.multi_assignment.assignees.forEach((entry, index) => {
      if (latestKeyByUser.has(entry.username.toLowerCase())) return
      const owner = getAssignmentStepOwner(task, entry.username) || task.multi_assignment?.created_by || task.assigned_to || creator
      const parentKey = latestKeyByUser.get(owner.toLowerCase()) || root.key
      addChild(parentKey, {
        key: `multi:${index}:${entry.username}`,
        label: entry.username,
        tone: (entry.status === 'in_progress' || entry.status === 'completed') ? 'active' : 'multi',
        avatarUrl: task.participant_avatars?.[entry.username] ?? null,
        title: `Multi-assigned to ${entry.username}`,
        subtitle: `From ${owner}`,
        focusTarget: entry.username,
      })
    })
  }

  if (task.queue_status === 'queued' && task.queue_department && !latestKeyByUser.has(task.queue_department.toLowerCase())) {
    addChild(fallbackParentKey, {
      key: `queue:${task.queue_department}`,
      label: task.queue_department,
      tone: 'department',
      title: `Queued in ${task.queue_department}`,
      subtitle: 'Waiting here',
      focusTarget: task.queue_department,
    })
  }

  return [root]
}

function flattenWorkflowTree(
  nodes: WorkflowTreeNode[],
  depth = 0,
  pathHasNext: boolean[] = []
): WorkflowTreeRow[] {
  const rows: WorkflowTreeRow[] = []
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1
    rows.push({ node, depth, pathHasNext, isLast })
    if (node.children?.length) {
      rows.push(...flattenWorkflowTree(node.children, depth + 1, [...pathHasNext, !isLast]))
    }
  })
  return rows
}

function WorkflowTree({
  nodes,
  onNodeClick,
}: {
  nodes: WorkflowTreeNode[]
  onNodeClick: (node: WorkflowTreeNode) => void
}) {
  if (nodes.length === 0) return null
  const rows = flattenWorkflowTree(nodes).slice(0, 10)
  const indent = 28
  const lineOffset = 16

  return (
    <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Assignment Flow</div>
      <div className="relative">
        {rows.map(({ node, depth, pathHasNext, isLast }) => {
          const centerX = lineOffset + depth * indent
          const ringCls =
            node.tone === 'active'
              ? 'ring-2 ring-blue-200'
              : node.tone === 'department'
                ? 'ring-2 ring-emerald-100'
                : node.tone === 'multi'
                  ? 'ring-2 ring-cyan-100'
                  : 'ring-2 ring-white'

          return (
            <div key={node.key} className="group/flow relative min-h-[56px]">
              {pathHasNext.map((hasNext, level) =>
                hasNext ? (
                  <div
                    key={`${node.key}-guide-${level}`}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-slate-200"
                    style={{ left: `${lineOffset + level * indent}px` }}
                  />
                ) : null
              )}
              {depth > 0 && (
                <>
                  <div className="pointer-events-none absolute top-0 h-1/2 w-px bg-slate-300" style={{ left: `${centerX}px` }} />
                  {!isLast && <div className="pointer-events-none absolute top-1/2 bottom-0 w-px bg-slate-300" style={{ left: `${centerX}px` }} />}
                  <div className="pointer-events-none absolute top-1/2 h-px bg-slate-300" style={{ left: `${centerX - indent + 1}px`, width: `${indent}px` }} />
                </>
              )}
              <button
                type="button"
                onClick={() => onNodeClick(node)}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-white"
                style={{ marginLeft: `${depth * indent}px` }}
                title={node.title}
              >
                <UserAvatar
                  username={node.label}
                  avatarUrl={node.avatarUrl}
                  size="sm"
                  className={cn(
                    'shrink-0 shadow-sm transition-transform group-hover/flow:scale-105',
                    node.tone === 'department' && 'bg-emerald-100 text-emerald-700',
                    node.tone === 'multi' && 'bg-cyan-100 text-cyan-700',
                    node.tone === 'active' && 'bg-blue-100 text-blue-700',
                    ringCls
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-slate-700">{node.label}</span>
                  {node.subtitle && <span className="block truncate text-[10px] text-slate-400">{node.subtitle}</span>}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
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

function clearCurrentUserUnreadFlags(entry: HistoryEntry, username: string): HistoryEntry {
  if (entry.type !== 'comment' || entry.is_deleted) return entry

  const unreadBy = Array.isArray(entry.unread_by)
    ? entry.unread_by.filter((value) => String(value).toLowerCase() !== username.toLowerCase())
    : []
  const readBy = Array.from(new Set([...(entry.read_by || []), username]))

  return {
    ...entry,
    unread_by: unreadBy,
    read_by: readBy,
  }
}

export function TaskDetailModal({
  taskId,
  currentUsername,
  currentUserRole = 'User',
  onClose,
  onEdit,
  onRefresh,
}: TaskDetailModalProps) {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'files' | 'share'>('info')
  const [comment, setComment] = useState('')
  const [shareUsername, setShareUsername] = useState('')
  const [shareUsers, setShareUsers] = useState<Array<{ username: string; role: string; department: string | null; avatar_data: string | null }>>([])
  const [highlightedAssignee, setHighlightedAssignee] = useState<string | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [showDeclineInput, setShowDeclineInput] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [pendingAttachmentDelete, setPendingAttachmentDelete] = useState<{ id: string; name: string } | null>(null)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [showCreatorCompleteConfirm, setShowCreatorCompleteConfirm] = useState(false)
  const [showCreatorReopenConfirm, setShowCreatorReopenConfirm] = useState(false)
  const [showHandoffDialog, setShowHandoffDialog] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [taskDialog, setTaskDialog] = useState<TaskActionDialogState>(null)
  const [dialogValue, setDialogValue] = useState('')
  const [dialogExtraValue, setDialogExtraValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const assigneeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const detailsQuery = useQuery({
    queryKey: queryKeys.taskDetail(taskId),
    queryFn: () => getTodoDetails(taskId),
    enabled: Boolean(taskId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })

  const details = detailsQuery.data ?? null
  const appNames = splitTaskMeta(details?.app_name)
  const packageNames = splitTaskMeta(details?.package_name)
  const workflowTree = details ? buildWorkflowTree(details) : []
  useEffect(() => {
    setLoading(detailsQuery.isLoading && !detailsQuery.data)
  }, [detailsQuery.data, detailsQuery.isLoading])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(async () => {
        const updated = await getTodoDetails(taskId)
        queryClient.setQueryData(queryKeys.taskDetail(taskId), updated)
        onRefresh()
      }, 200)
    }

    const unsubscribe = subscribeToPostgresChanges(
      `task-detail-modal:${taskId}`,
      [
        { table: 'todos', filter: `id=eq.${taskId}` },
        { table: 'todo_attachments', filter: `todo_id=eq.${taskId}` },
        { table: 'todo_shares', filter: `todo_id=eq.${taskId}` },
      ],
      scheduleRefresh
    )

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      unsubscribe()
    }
  }, [onRefresh, queryClient, taskId])

  useEffect(() => {
    let cancelled = false
    getUsersForAssignment().then((users) => {
      if (!cancelled) setShareUsers(users)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!details || typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(TASK_WORKFLOW_FOCUS_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { taskId?: string; target?: string }
      if (parsed.taskId !== details.id || !parsed.target) return
      if (!details.multi_assignment?.assignees?.some((entry) => entry.username === parsed.target)) return
      setHighlightedAssignee(parsed.target)
      window.sessionStorage.removeItem(TASK_WORKFLOW_FOCUS_KEY)
      window.setTimeout(() => {
        assigneeRefs.current[parsed.target!]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
      window.setTimeout(() => {
        setHighlightedAssignee((current) => (current === parsed.target ? null : current))
      }, 2600)
    } catch {
      window.sessionStorage.removeItem(TASK_WORKFLOW_FOCUS_KEY)
    }
  }, [details])

  useEffect(() => {
    if (!details) return
    const comments = details.history.filter((entry) => entry.type === 'comment' && !entry.is_deleted)
    const hasUnreadComments = comments.some((entry) =>
      Array.isArray(entry.unread_by) &&
      entry.unread_by.some((username) => username.toLowerCase() === currentUsername.toLowerCase())
    )
    if (!hasUnreadComments) return
    queryClient.setQueryData<TodoDetails>(queryKeys.taskDetail(taskId), (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        history: prev.history.map((entry) => clearCurrentUserUnreadFlags(entry, currentUsername)),
      }
    })
    queryClient.setQueryData<Todo[]>(queryKeys.tasks(currentUsername), (prev) => {
      if (!prev) return prev
      return prev.map((task) =>
        task.id !== taskId
          ? task
          : {
              ...task,
              history: task.history.map((entry) => clearCurrentUserUnreadFlags(entry, currentUsername)),
            }
      )
    })
    void markTaskCommentsReadAction(details.id)
  }, [currentUsername, details, queryClient, taskId])

  useEffect(() => {
    if (!uploadingFiles) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [uploadingFiles])

  const doAction = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setActionError('')
    startTransition(async () => {
      const res = await fn()
      if (res.success) {
        const updated = await getTodoDetails(taskId)
        queryClient.setQueryData(queryKeys.taskDetail(taskId), updated)
        onRefresh()
      } else {
        setActionError(res.error ?? 'Action failed')
      }
    })
  }

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || !details) return

    const oversized = files.find((file) => file.size > MAX_ATTACHMENT_SIZE)
    if (oversized) {
      setActionError(`${oversized.name} is larger than 1 GB.`)
      return
    }

    setActionError('')
    setUploadingFiles(true)

    try {
      const supabase = createBrowserClient()
      await runWithConcurrency(files, MAX_PARALLEL_UPLOADS, async (file) => {
        const signedUpload = await createTaskAttachmentUploadUrlAction({
          todo_id: details.id,
          owner_username: details.username,
          file_name: file.name,
        })

        if (!signedUpload.success || !signedUpload.path || !signedUpload.token) {
          throw new Error(signedUpload.error ?? 'Unable to prepare file upload.')
        }

        const upload = await supabase.storage
          .from(signedUpload.bucket || CMS_STORAGE_BUCKET)
          .uploadToSignedUrl(signedUpload.path, signedUpload.token, file)

        if (upload.error) throw new Error(upload.error.message)

        const saved = await saveTodoAttachmentAction({
          todo_id: details.id,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          storage_path: signedUpload.path,
        })

        if (!saved.success) throw new Error(saved.error ?? `Failed to attach ${file.name}`)
      })

      const updated = await getTodoDetails(taskId)
      queryClient.setQueryData(queryKeys.taskDetail(taskId), updated)
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Attachment upload failed.')
    } finally {
      setUploadingFiles(false)
    }
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
  const isAdminOrSuperManager = currentUserRole === 'Admin' || currentUserRole === 'Super Manager'
  const isCreator = t.username === currentUsername
  const isAssignee = t.assigned_to === currentUsername
  const isPendingApproval = t.approval_status === 'pending_approval'
  const pendingApprover = t.pending_approver || t.username
  const canApproveCurrentStep = isPendingApproval && pendingApprover.toLowerCase() === currentUsername.toLowerCase()
  const isCompleted = t.completed
  const ma = t.multi_assignment
  const maEnabled = !!(ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0)
  const maAllAccepted = maEnabled && ma.assignees.every((entry) => entry.status === 'accepted')
  const canCreatorControlSingleFlow = isCreator && (!maEnabled || maAllAccepted)
  const singleStepOwner = !maEnabled && t.assigned_to ? getAssignmentStepOwner(t, t.assigned_to) : null
  const showSingleDueDateBtn = !maEnabled && !isCompleted && !isPendingApproval && !!t.assigned_to && (singleStepOwner || '').toLowerCase() === currentUsername.toLowerCase()
  const maProgress = (() => {
    if (!ma?.enabled || !Array.isArray(ma.assignees) || ma.assignees.length === 0) return t.completed ? 100 : 0
    if (t.completed) return 100
    const storedPct =
      typeof ma.completion_percentage === 'number' && Number.isFinite(ma.completion_percentage)
        ? ma.completion_percentage
        : null
    if (storedPct !== null && storedPct >= 0) {
      return Math.max(0, Math.min(100, Math.round(storedPct)))
    }
    const doneCount = ma.assignees.filter((assignee) => assignee.status === 'accepted' || assignee.status === 'completed').length
    return Math.max(0, Math.min(100, Math.round((doneCount / ma.assignees.length) * 100)))
  })()
  const myMaEntry = ma?.assignees?.find((entry) => (entry.username || '').toLowerCase() === currentUsername.toLowerCase())
  const delegatedOwner = ma?.assignees?.find((entry) => Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase()))
  const myDelegatedEntry = delegatedOwner?.delegated_to?.find((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase())
  const sm = STATUS_META[t.task_status] ?? STATUS_META.backlog
  const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.medium

  const comments     = t.history.filter((h: HistoryEntry) => h.type === 'comment' && (!h.is_deleted || isAdminOrSuperManager))
  const historyEvts  = t.history.filter((h: HistoryEntry) => h.type !== 'comment')
  const nextStep     = nextStepLabel(t)
  const assignedSummary = getAssignedSummary(t)
  const departmentSummary = getDepartmentSummary(t)
  const participants = getTaskParticipants(t)
  const activeMention = getActiveMentionQuery(comment, commentInputRef.current?.selectionStart ?? comment.length)
  const mentionSuggestions = activeMention
    ? participants.filter((participant) => participant.username.toLowerCase().includes(activeMention.query.toLowerCase()))
    : []

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
    setTaskDialog(dialog)
    setDialogValue('')
    setDialogExtraValue('')
  }

  const closeTaskDialog = () => {
    setTaskDialog(null)
    setDialogValue('')
    setDialogExtraValue('')
  }

  const handleWorkflowNodeClick = (node: WorkflowTreeNode) => {
    if (!node.focusTarget) return
    if (t.multi_assignment?.assignees?.some((entry) => entry.username === node.focusTarget)) {
      setHighlightedAssignee(node.focusTarget)
      window.setTimeout(() => {
        assigneeRefs.current[node.focusTarget!]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
      window.setTimeout(() => {
        setHighlightedAssignee((current) => (current === node.focusTarget ? null : current))
      }, 2600)
    }
  }

  const submitTaskDialog = () => {
    if (!taskDialog) return

    switch (taskDialog.type) {
      case 'ma-submit':
        void doAction(() => updateMaAssigneeStatusAction(t.id, 'completed', dialogValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'complete':
        if (!dialogValue.trim()) {
          setActionError('Completion feedback is required.')
          return
        }
        void doAction(() => toggleTodoCompleteAction(t.id, true, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'single-due-date':
        if (!dialogValue.trim()) {
          setActionError('Due date is required.')
          return
        }
        void doAction(() => updateSingleTaskDueDateAction(t.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'step-edit':
        if (!dialogValue.trim()) {
          setActionError('Due date is required.')
          return
        }
        void doAction(() => updateAssignmentStepAction(t.id, taskDialog.assigneeUsername, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'split-multi': {
        const rows = dialogValue
          .split('\n')
          .map((row) => row.trim())
          .filter(Boolean)
        if (rows.length === 0) return
        const assignees = rows
          .map((row) => {
            const [username, dueDate] = row.split('|').map((part) => part.trim())
            return {
              username,
              actual_due_date: dueDate ? new Date(dueDate).toISOString() : null,
            }
          })
          .filter((entry) => entry.username)
        if (assignees.length === 0) return
        void doAction(() => convertTaskToMultiAssignmentAction(t.id, assignees))
        closeTaskDialog()
        return
      }
      case 'delegate':
        if (!dialogValue.trim()) return
        void doAction(() => delegateMaAssigneeAction(t.id, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'sub-submit':
        void doAction(() => updateMaSubAssigneeStatusAction(t.id, taskDialog.delegatorUsername, 'completed', dialogValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'reject-assignee':
        if (!dialogValue.trim()) return
        void doAction(() => rejectMaAssigneeAction(t.id, taskDialog.assigneeUsername, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'reopen-assignee':
        if (!dialogValue.trim()) return
        if (!dialogExtraValue.trim()) return
        void doAction(() => reopenMaAssigneeAction(t.id, taskDialog.assigneeUsername, dialogValue.trim(), dialogExtraValue.trim()))
        closeTaskDialog()
        return
      case 'reject-sub':
        if (!dialogValue.trim()) return
        void doAction(() => rejectMaSubAssigneeAction(t.id, taskDialog.delegatorUsername, taskDialog.subUsername, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'remove-delegation':
        void doAction(() => removeMaDelegationAction(t.id, taskDialog.delegatorUsername, taskDialog.subUsername))
        closeTaskDialog()
        return
      case 'delete-comment':
        applyOptimisticCommentDelete(taskDialog.messageId)
        doAction(() => deleteTodoCommentAction(t.id, taskDialog.messageId))
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
    queryClient.setQueryData<TodoDetails>(queryKeys.taskDetail(taskId), (prev) => {
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
    queryClient.setQueryData<TodoDetails>(queryKeys.taskDetail(taskId), (prev) => {
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
    doAction(() => editTodoCommentAction(t.id, entry.message_id!, nextText))
    cancelEditingComment()
  }

  const deleteComment = (entry: HistoryEntry) => {
    if (!entry.message_id) return
    openTaskDialog({ type: 'delete-comment', messageId: entry.message_id })
  }

  const confirmDeleteAttachment = async () => {
    if (!pendingAttachmentDelete) return
    setActionError('')
    setDeletingAttachmentId(pendingAttachmentDelete.id)
    const res = await deleteTodoAttachmentAction(t.id, pendingAttachmentDelete.id)
    if (!res.success) {
      setActionError(res.error ?? 'Failed to remove attachment.')
      setDeletingAttachmentId(null)
      return
    }
    const updated = await getTodoDetails(taskId)
    queryClient.setQueryData(queryKeys.taskDetail(taskId), updated)
    onRefresh()
    setDeletingAttachmentId(null)
    setPendingAttachmentDelete(null)
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
      doAction(() => addCommentAction(t.id, comment.trim()))
      setComment('')
      setMentionIndex(0)
    }
  }

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
                  Pending: {pendingApprover}
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
                {formatPakistanDate(t.created_at)}
              </span>
              {t.due_date && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className={cn('flex items-center gap-1', !isCompleted && new Date(t.due_date) < new Date() ? 'text-red-500 font-semibold' : '')}>
                    <Calendar size={11} /> Due {formatPakistanDate(t.due_date)}
                  </span>
                </>
              )}
              {appNames.length > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="flex items-center gap-1 text-blue-600 font-medium"><Tag size={11} /> {appNames.join(', ')}</span>
                </>
              )}
            </div>

            {workflowTree.length > 0 && (
              <div className="mt-4 max-w-[420px]">
                <WorkflowTree nodes={workflowTree} onNodeClick={handleWorkflowNodeClick} />
              </div>
            )}
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
            <PrimaryBtn icon={<PlayCircle size={14}/>} label="Acknowledge" color="blue" onClick={() => doAction(() => acknowledgeTaskAction(t.id))} loading={isPending} />
          )}
          {isAssignee && t.task_status === 'todo' && (
            <PrimaryBtn icon={<PlayCircle size={14}/>} label="Start Work" color="blue" onClick={() => doAction(() => startTaskAction(t.id))} loading={isPending} />
          )}
          {!isCompleted && !isPendingApproval && (isAssignee || canCreatorControlSingleFlow) && !!t.assigned_to && !maEnabled && (
            <button
              onClick={() => setShowHandoffDialog(true)}
              className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100"
            >
              Assign To Next
            </button>
          )}
          {showSingleDueDateBtn && (
            <button
                onClick={() => {
                  setDialogValue(t.actual_due_date ? t.actual_due_date.slice(0, 16) : '')
                  setDialogExtraValue(getAssignmentStepNote(t, t.assigned_to!))
                  openTaskDialog({ type: 'step-edit', assigneeUsername: t.assigned_to! })
                }}
              className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
            >
              Edit Assignee
              </button>
          )}
          {!isCompleted && !isPendingApproval && (((isAssignee && !maEnabled) || canCreatorControlSingleFlow)) && t.task_status !== 'backlog' && (
            <PrimaryBtn
              icon={<CheckCircle2 size={14}/>}
              label={isCreator ? 'Mark Complete' : 'Submit for Approval'}
              color="green"
              onClick={() => {
                if (isCreator) {
                  setShowCreatorCompleteConfirm(true)
                  return
                }
                openTaskDialog({ type: 'complete' })
              }}
              loading={isPending}
            />
          )}
          {isCreator && isCompleted && (
            <PrimaryBtn
              icon={<RotateCcw size={14}/>}
              label="Reopen Task"
              color="amber"
              onClick={() => setShowCreatorReopenConfirm(true)}
              loading={isPending}
            />
          )}
          {canApproveCurrentStep && (
            <>
              <PrimaryBtn icon={<CheckCheck size={14}/>} label="Approve Completion" color="green" onClick={() => doAction(() => approveTodoAction(t.id))} loading={isPending} />
              <PrimaryBtn icon={<XCircle size={14}/>} label="Decline" color="red" onClick={() => setShowDeclineInput(true)} loading={isPending} />
            </>
          )}
          {myMaEntry && !isCompleted && myMaEntry.status === 'pending' && (
            <PrimaryBtn icon={<PlayCircle size={14}/>} label="MA Start" color="blue" onClick={() => doAction(() => updateMaAssigneeStatusAction(t.id, 'in_progress'))} loading={isPending} />
          )}
          {myMaEntry && !isCompleted && myMaEntry.status === 'in_progress' && (
            <PrimaryBtn icon={<CheckCircle2 size={14}/>} label="MA Submit" color="green" onClick={() => openTaskDialog({ type: 'ma-submit' })} loading={isPending} />
          )}
          {myMaEntry && !isCompleted && (
            <button onClick={() => openTaskDialog({ type: 'delegate' })} className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100">
              Delegate
            </button>
          )}
          {myDelegatedEntry && !isCompleted && myDelegatedEntry.status === 'pending' && (
            <button onClick={() => void doAction(() => updateMaSubAssigneeStatusAction(t.id, delegatedOwner!.username, 'in_progress'))} className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100">
              Sub Start
            </button>
          )}
          {myDelegatedEntry && !isCompleted && myDelegatedEntry.status === 'in_progress' && (
            <button onClick={() => openTaskDialog({ type: 'sub-submit', delegatorUsername: delegatedOwner!.username })} className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100">
              Sub Submit
            </button>
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
        <div className={cn('space-y-5', activeTab === 'info' ? 'block' : 'hidden')}>
            {/* Two-column meta grid */}
            <div className="grid grid-cols-2 gap-3">
              <MetaCard icon={<User size={13} className="text-purple-500" />} label="Assigned To" value={assignedSummary.value} sub={assignedSummary.sub} />
              <MetaCard icon={<Building2 size={13} className="text-blue-500" />} label={`Departments (${departmentSummary.count})`} value={departmentSummary.label} />
              {t.due_date && <MetaCard icon={<Calendar size={13} className="text-orange-500" />} label="Due Date"
                value={formatPakistanDate(t.due_date)} accent={!isCompleted && new Date(t.due_date) < new Date() ? 'red' : undefined} />}
              {t.kpi_type && <MetaCard icon={<Target size={13} className="text-pink-500" />} label="KPI Type" value={t.kpi_type} />}
              {appNames.length > 0 && <MetaCard icon={<Tag size={13} className="text-blue-500" />} label="Apps" value={appNames.join(', ')} />}
              {packageNames.length > 0 && <MetaCard icon={<Link2 size={13} className="text-cyan-500" />} label="Packages" value={packageNames.join(', ')} />}
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
              <Section
                icon={<User size={14} />}
                label="Multi-Assignment"
              >
                <div className="space-y-2">
                  {t.multi_assignment.assignees.map((a) => {
                    const pct = maProgress
                    const done = t.completed || a.status === 'completed' || a.status === 'accepted'
                    return (
                      <div
                        key={a.username}
                        ref={(node) => {
                          assigneeRefs.current[a.username] = node
                        }}
                        className={cn(
                          'rounded-xl border border-cyan-100 bg-cyan-50 p-2.5 transition-all duration-500',
                          highlightedAssignee === a.username && 'ring-2 ring-blue-300 shadow-[0_0_0_6px_rgba(59,130,246,0.12)]'
                        )}
                      >
                        <div className="flex items-center gap-3">
                        <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0',
                          done ? 'bg-green-500' : a.status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-300')}>
                          {a.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{a.username}</p>
                          <p className="text-xs text-slate-500 capitalize">{a.status ?? 'pending'}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {getAssignmentStepOwner(t, a.username) && (
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                By {getAssignmentStepOwner(t, a.username)}
                              </span>
                            )}
                            {getAssignmentStepNote(t, a.username) && (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                                Note by {getAssignmentStepOwner(t, a.username) || 'User'}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400">
                              Due {getAssigneeDueDate(t, a.username) ? formatPakistanDate(getAssigneeDueDate(t, a.username) as string) : '—'}
                            </span>
                          </div>
                          {getAssignmentStepNote(t, a.username) && (
                            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                              {getAssignmentStepNote(t, a.username)}
                            </div>
                          )}
                        </div>
                        <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all', done ? 'bg-green-500' : 'bg-blue-500')} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 w-8 text-right">{pct}%</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                        {((getAssignmentStepOwner(t, a.username) || '').toLowerCase() === currentUsername.toLowerCase()) && !isCompleted && (
                          <button
                            onClick={() => {
                              setDialogValue(a.actual_due_date ? a.actual_due_date.slice(0, 16) : '')
                              setDialogExtraValue(getAssignmentStepNote(t, a.username))
                              openTaskDialog({ type: 'step-edit', assigneeUsername: a.username })
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                        )}
                        {isCreator && a.status === 'completed' && (
                          <>
                            <button onClick={() => void doAction(() => acceptMaAssigneeAction(t.id, a.username))} className="rounded-xl bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700">
                              Accept
                            </button>
                            <button onClick={() => openTaskDialog({ type: 'reject-assignee', assigneeUsername: a.username })} className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">
                              Reject
                            </button>
                          </>
                        )}
                        {isCreator && a.status === 'accepted' && (
                          <button onClick={() => openTaskDialog({ type: 'reopen-assignee', assigneeUsername: a.username })} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                            Reopen
                          </button>
                        )}
                        </div>
                        {Array.isArray(a.delegated_to) && a.delegated_to.length > 0 && (
                          <div className="mt-2 space-y-2 rounded-xl border border-sky-100 bg-white/80 p-2.5">
                          {a.delegated_to.map((sub) => {
                            const isDelegator = a.username.toLowerCase() === currentUsername.toLowerCase()
                            const isSubMe = (sub.username || '').toLowerCase() === currentUsername.toLowerCase()
                            return (
                              <div key={`${a.username}-${sub.username}`} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-slate-800">{sub.username}</span>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{sub.status || 'pending'}</span>
                                  {sub.notes && <span className="text-[10px] text-amber-700">Note: {sub.notes}</span>}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {isSubMe && sub.status === 'pending' && <button onClick={() => void doAction(() => updateMaSubAssigneeStatusAction(t.id, a.username, 'in_progress'))} className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100">Start</button>}
                                  {isSubMe && sub.status === 'in_progress' && <button onClick={() => openTaskDialog({ type: 'sub-submit', delegatorUsername: a.username })} className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-100">Submit</button>}
                                  {isDelegator && sub.status === 'completed' && <button onClick={() => void doAction(() => acceptMaSubAssigneeAction(t.id, a.username, sub.username))} className="rounded-xl bg-green-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green-700">Accept</button>}
                                  {isDelegator && sub.status === 'completed' && <button onClick={() => openTaskDialog({ type: 'reject-sub', delegatorUsername: a.username, subUsername: sub.username })} className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100">Reject</button>}
                                  {isDelegator && <button onClick={() => openTaskDialog({ type: 'remove-delegation', delegatorUsername: a.username, subUsername: sub.username })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Remove</button>}
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

            {/* ── Comments ── */}
            <Section icon={<MessageCircle size={14} />} label={`Comments${comments.length ? ` (${comments.length})` : ''}`}>
              <div className="mb-3 flex flex-wrap gap-2">
                {participants.map((participant) => (
                  <button
                    key={participant.username}
                    type="button"
                    title={`${participant.username} (${participant.role})`}
                    aria-label={`${participant.username} (${participant.role})`}
                    onClick={() => insertMention(participant.username)}
                    className="rounded-full border border-slate-200 bg-slate-50 p-0.5 transition-colors hover:border-orange-200 hover:bg-orange-50"
                  >
                    <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} size="sm" />
                  </button>
                ))}
              </div>
              <div className="space-y-3 mb-4">
                {comments.length === 0 && (
                  <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-center">
                    <div>
                      <MessageCircle size={28} className="mx-auto mb-3 text-slate-300" />
                      <p className="text-sm text-slate-400 italic">No comments yet.</p>
                    </div>
                  </div>
                )}
                {comments.map((c, i) => {
                  const isMe = c.user === currentUsername
                  const canManage = canManageComment(c)
                  const isEditing = editingCommentId === c.message_id
                  return (
                    <div key={i} className={cn('flex gap-2.5', isMe ? 'flex-row-reverse' : '')}>
                      <UserAvatar username={c.user} avatarUrl={t.participant_avatars?.[c.user] ?? null} size="sm" className={cn('mt-0.5', isMe ? 'bg-blue-100 text-blue-700' : '')} />
                      <div className={cn('max-w-[75%]', isMe ? 'items-end' : 'items-start')}>
                        {c.mention_users && c.mention_users.length > 0 && !c.is_deleted && (
                          <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-[0.14em]', isMe ? 'text-blue-200 text-right' : 'text-orange-500')}>
                            For {c.mention_users.map((username) => `@${username}`).join(', ')}
                          </div>
                        )}
                        <div className={cn('px-3.5 py-2.5 rounded-2xl text-sm text-slate-800 shadow-sm',
                          isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-100 rounded-tl-sm', c.is_deleted && 'bg-slate-200 text-slate-500')}>
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
                                <button onClick={() => saveEditedComment(c)} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">Save</button>
                              </div>
                            </div>
                          ) : (
                            renderCommentWithMentions(c.details)
                          )}
                        </div>
                        {!isEditing && (canManage || c.edited_at) && (
                          <div className={cn('mt-1 flex items-center gap-2 px-1 text-[10px]', isMe ? 'justify-end' : 'justify-start')}>
                            {c.edited_at && !c.is_deleted && <span className="text-slate-400">edited</span>}
                            {canManage && !c.is_deleted && (
                              <>
                                <button onClick={() => startEditingComment(c)} className="font-semibold text-blue-500 hover:text-blue-600">Edit</button>
                                <button onClick={() => deleteComment(c)} className="font-semibold text-red-500 hover:text-red-600">Delete</button>
                              </>
                            )}
                          </div>
                        )}
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
                    ref={commentInputRef}
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value)
                      setMentionIndex(0)
                    }}
                    placeholder="Write a message for this task... Use @username to mention someone."
                    rows={1}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 resize-none"
                    onClick={() => setMentionIndex(0)}
                    onKeyUp={() => setMentionIndex(0)}
                    onKeyDown={handleCommentKeyDown}
                  />
                  {mentionSuggestions.length > 0 && (
                    <div className="absolute inset-x-0 bottom-full mb-2 rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                      {mentionSuggestions.slice(0, 6).map((participant, index) => (
                        <button
                          key={participant.username}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertMention(participant.username)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                            index === mentionIndex ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} size="sm" className="bg-slate-100" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">@{participant.username}</span>
                            <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-400">{participant.role}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { if (comment.trim()) { doAction(() => addCommentAction(t.id, comment.trim())); setComment(''); setMentionIndex(0) } }}
                  disabled={!comment.trim() || isPending}
                  className="shrink-0 w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  <Send size={14} className="translate-x-0.5" />
                </button>
              </div>
            </Section>
          </div>

        {/* ────── HISTORY / ACTIVITY TAB ────── */}
        <div className={activeTab === 'history' ? 'block' : 'hidden'}>
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

        {/* ────── FILES TAB ────── */}
        <div className={cn('space-y-4', activeTab === 'files' ? 'block' : 'hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
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
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">{uploadingFiles ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Upload Files</span>
                </button>
              </div>
            </div>
            {t.attachments.length === 0 ? (
              <div className="text-center py-12">
                <Paperclip size={28} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-400">No attachments</p>
              </div>
            ) : (
              <div className="space-y-2">
                {t.attachments.map((a) => {
                  const ext = a.file_name.split('.').pop()?.toUpperCase() ?? 'FILE'
                  const canRemoveAttachment = !isCompleted && (a.uploaded_by === currentUsername || isCreator)
                  return (
                    <div key={a.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:border-blue-200 hover:bg-blue-50/30 transition-colors group">
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700">
                        {ext}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.file_name}</p>
                        <p className="text-xs text-slate-400">
                          {a.uploaded_by} · {formatPakistanDate(a.created_at)}
                          {a.file_size ? ` · ${(a.file_size / 1024).toFixed(0)} KB` : ''}
                        </p>
                      </div>
                      <a
                        href={a.file_url}
                        download={a.file_name}
                        className="px-3 py-1.5 text-xs rounded-lg text-blue-600 hover:bg-blue-100 font-semibold transition-colors opacity-0 group-hover:opacity-100">
                        Download
                      </a>
                      <a
                        href={a.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs rounded-lg text-slate-600 hover:bg-slate-100 font-semibold transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Open
                      </a>
                      {canRemoveAttachment && (
                        <button
                          type="button"
                          onClick={() => setPendingAttachmentDelete({ id: a.id, name: a.file_name })}
                          disabled={deletingAttachmentId === a.id}
                          className="px-3 py-1.5 text-xs rounded-lg border border-red-200 bg-red-50 text-red-600 font-semibold transition-colors hover:bg-red-100 disabled:opacity-60"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {deletingAttachmentId === a.id ? <Loader2 size={12} className="animate-spin" /> : null}
                            {deletingAttachmentId === a.id ? 'Removing...' : 'Remove'}
                          </span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        {/* ────── SHARE TAB ────── */}
        <div className={cn('space-y-5', activeTab === 'share' ? 'block' : 'hidden')}>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Share with User</label>
              <div className="flex gap-2">
                <select
                  value={shareUsername}
                  onChange={(e) => setShareUsername(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
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
      </div>
      {taskDialog && (
        <ActionDialog
          title={
            taskDialog.type === 'complete' ? 'Submit completion feedback' :
            taskDialog.type === 'single-due-date' ? 'Set assignee due date' :
            taskDialog.type === 'step-edit' ? `Edit ${taskDialog.assigneeUsername}'s step` :
            taskDialog.type === 'split-multi' ? 'Split into multi-assignment' :
            taskDialog.type === 'delegate' ? 'Delegate task work' :
            taskDialog.type === 'remove-delegation' ? 'Remove delegation' :
            taskDialog.type === 'reopen-assignee' ? 'Reopen accepted work' :
            taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Send feedback' :
            taskDialog.type === 'delete-comment' ? 'Delete message' :
            'Add summary'
          }
          description={
            taskDialog.type === 'complete' ? 'Add a short summary before submitting this task as completed.' :
            taskDialog.type === 'single-due-date' ? 'Set the assignee due date for this single task.' :
            taskDialog.type === 'step-edit' ? 'Update only this child assignee step. This will not change other users.' :
            taskDialog.type === 'split-multi' ? 'Add one assignee per line: username|YYYY-MM-DDTHH:mm (due optional).' :
            taskDialog.type === 'delegate' ? 'Assign this work to another username with optional instructions.' :
            taskDialog.type === 'remove-delegation' ? 'This removes the delegated user from the task workflow.' :
            taskDialog.type === 'reopen-assignee' ? 'Explain why this accepted work should be reopened.' :
            taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Give clear feedback so the work can be corrected.' :
            taskDialog.type === 'delete-comment' ? 'This will remove the message from the conversation.' :
            'Add an optional summary for this submission.'
          }
          primaryLabel={taskDialog.type === 'remove-delegation' ? 'Remove delegation' : taskDialog.type === 'delete-comment' ? 'Delete message' : taskDialog.type === 'complete' ? 'Submit completion' : taskDialog.type === 'single-due-date' || taskDialog.type === 'step-edit' ? 'Save changes' : 'Confirm'}
          onClose={closeTaskDialog}
          onConfirm={submitTaskDialog}
        >
          {taskDialog.type === 'complete' ? (
            <DialogTextarea
              label="Completion Feedback"
              value={dialogValue}
              onChange={setDialogValue}
              placeholder="What work was completed? Add summary or handoff notes."
            />
          ) : taskDialog.type === 'single-due-date' ? (
            <DialogInput label="Assignee Due Date" value={dialogValue} onChange={setDialogValue} type="datetime-local" min={new Date().toISOString().slice(0, 16)} />
          ) : taskDialog.type === 'step-edit' ? (
            <div className="space-y-3">
              <DialogInput label="Assignee Due Date" value={dialogValue} onChange={setDialogValue} type="datetime-local" min={new Date().toISOString().slice(0, 16)} />
              <DialogTextarea label="Step Detail" value={dialogExtraValue} onChange={setDialogExtraValue} placeholder="Add or update instructions for this assignee only" />
            </div>
          ) : taskDialog.type === 'split-multi' ? (
            <DialogTextarea
              label="Assignees"
              value={dialogValue}
              onChange={setDialogValue}
              placeholder={'user1|2026-03-20T18:00\nuser2|2026-03-22T12:00\nuser3'}
            />
          ) : taskDialog.type === 'delegate' ? (
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
      <TaskHandoffDialog
        open={showHandoffDialog}
        currentUsername={currentUsername}
        currentAssignee={t.assigned_to}
        onClose={() => setShowHandoffDialog(false)}
        onAssignDepartment={(department, dueDate, note) => {
          setShowHandoffDialog(false)
          void doAction(() => sendTaskToDepartmentQueueAction(t.id, department, dueDate, note))
        }}
        onAssignMulti={(assignees, note) => {
          setShowHandoffDialog(false)
          void doAction(() => convertTaskToMultiAssignmentAction(t.id, assignees, note))
        }}
      />
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
          doAction(() => toggleTodoCompleteAction(t.id, true))
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
          doAction(() => toggleTodoCompleteAction(t.id, false))
          setShowCreatorReopenConfirm(false)
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingAttachmentDelete)}
        title={pendingAttachmentDelete ? `Delete "${pendingAttachmentDelete.name}"?` : 'Delete attachment?'}
        description="This file will be removed from this task."
        confirmLabel={deletingAttachmentId ? 'Deleting...' : 'Delete'}
        danger
        onCancel={() => {
          if (deletingAttachmentId) return
          setPendingAttachmentDelete(null)
        }}
        onConfirm={() => { void confirmDeleteAttachment() }}
      />
    </ModalShell>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
  children: React.ReactNode
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
  icon, label, action, children,
}: { icon: React.ReactNode; label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {icon} {label}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function PrimaryBtn({
  icon, label, color, onClick, loading,
}: {
  icon: React.ReactNode; label: string; color: 'blue' | 'green' | 'red' | 'amber';
  onClick: () => void; loading?: boolean
}) {
  const cls = {
    blue:  'bg-blue-600 hover:bg-blue-700 text-white',
    green: 'bg-green-600 hover:bg-green-700 text-white',
    red:   'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
    amber: 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200',
  }
  return (
    <button onClick={onClick} disabled={loading}
      className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 shadow-sm', cls[color])}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
