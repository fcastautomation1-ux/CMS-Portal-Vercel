'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
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
  X,
  XCircle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/cn'
import { formatPakistanDate, formatPakistanDateTime, pakistanInputValue, pakistanOfficeMinInputValue } from '@/lib/pakistan-time'
import { createBrowserClient } from '@/lib/supabase/client'
import { CMS_STORAGE_BUCKET } from '@/lib/storage'
import { splitTaskMeta } from '@/lib/task-metadata'
import { normalizeTaskDescription } from '@/lib/task-description'
import { subscribeToPostgresChanges } from '@/lib/realtime'
import { queryKeys } from '@/lib/query-keys'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { OfficeDateTimePicker } from '@/components/ui/office-datetime-picker'
import type { Todo, TodoDetails, HistoryEntry, MultiAssignmentEntry } from '@/types'
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
  convertTaskToMultiAssignmentAction,
  getTodoDetails,
  getUsersForAssignment,
  markTaskCommentsReadAction,
  sendTaskToDepartmentQueueAction,
  rejectMaAssigneeAction,
  rejectMaSubAssigneeAction,
  removeMaDelegationAction,
  saveTodoAttachmentAction,
  shareTodoAction,
  startTaskAction,
  toggleTodoCompleteAction,
  unshareTodoAction,
  updateAssignmentStepAction,
  updateMaAssigneeStatusAction,
  updateMaSubAssigneeStatusAction,
  updateSingleTaskDueDateAction,
  pauseHallTaskAction,
  activateHallTaskAction,
  reassignTaskAction,
  extendMultiAssignmentStepAction,
} from '@/app/dashboard/tasks/actions'

const TaskHandoffDialog = dynamic(
  () => import('@/components/tasks/task-handoff-dialog').then((mod) => mod.TaskHandoffDialog),
  { ssr: false }
)

const CreateTaskModal = dynamic(
  () => import('./create-task-modal').then((mod) => mod.CreateTaskModal),
  { ssr: false }
)

type TabId = 'info' | 'history' | 'files' | 'share' | 'timeline'
const MAX_ATTACHMENT_SIZE = 1024 * 1024 * 1024
const MAX_PARALLEL_UPLOADS = 3
const TASK_WORKFLOW_FOCUS_KEY = 'cms-task-workflow-focus'

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
  if (task.approval_status === 'pending_approval') return `Waiting for approval from ${task.pending_approver || task.username}`
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
  status: 'start' | 'assigned' | 'claimed' | 'pending'
  timestamp?: string | null
  avatarUrl?: string | null
  title: string
  subtitle?: string
  focusTarget?: string
  children?: WorkflowTreeNode[]
}

type WorkflowLayoutNode = {
  node: WorkflowTreeNode
  depth: number
  row: number
  parentKey: string | null
}

type WorkflowLayoutEdge = {
  from: string
  to: string
}

function formatFlowAge(timestamp?: string | null): string {
  if (!timestamp) return '--'
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
  } catch {
    return '--'
  }
}

function buildWorkflowTree(task: TodoDetails): WorkflowTreeNode[] {
  const creator = String(task.username || '').trim()
  if (!creator) return []

  const root: WorkflowTreeNode = {
    key: `creator:${creator}`,
    label: creator,
    tone: 'user',
    status: 'start',
    timestamp: task.created_at ?? null,
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
    const actor = String(entry.user || '').trim()
    const role = String(entry.role || '').trim().toLowerCase()

    // claimed_from_department: actor is the claimer — show them as child of the dept node
    if (role === 'claimed_from_department') {
      if (!actor) return
      const deptRouteEntry = (task.assignment_chain || []).slice(0, index).reverse()
        .find((e) => ['routed_to_department_queue', 'queued_department'].includes(String(e.role || '').toLowerCase()))
      const deptName = String(deptRouteEntry?.next_user || task.queue_department || '').trim()
      const deptParentKey = deptName ? latestKeyByUser.get(deptName.toLowerCase()) : undefined
      const parentKey = deptParentKey ?? fallbackParentKey
      const nodeKey = `step:${index}:${actor}`
      const isCurrentOwner = actor.toLowerCase() === (task.assigned_to || '').toLowerCase()
      addChild(parentKey, {
        key: nodeKey,
        label: actor,
        tone: isCurrentOwner && task.task_status === 'in_progress' ? 'active' : 'user',
        status: isCurrentOwner ? (task.task_status === 'in_progress' ? 'claimed' : 'assigned') : 'claimed',
        timestamp: entry.assignedAt ?? null,
        avatarUrl: task.participant_avatars?.[actor] ?? null,
        title: `${actor} claimed from ${deptName || 'department queue'}`,
        subtitle: `Claimed from ${deptName || 'department'}`,
        focusTarget: actor,
      })
      fallbackParentKey = nodeKey
      return
    }

    const target = String(entry.next_user || '').trim()
    if (!target) return
    const isDepartmentStep = ['routed_to_department_queue', 'queued_department'].includes(String(entry.role || ''))
    const status: WorkflowTreeNode['status'] =
      isDepartmentStep ? 'pending' : 'assigned'

    // If actor is not yet in the tree (their initial assignment was stored in task.assigned_to
    // rather than in assignment_chain), auto-insert the actor as a bridge node so their target
    // becomes actor's child — matching the outer Queue Task Chain display.
    let parentKey = latestKeyByUser.get(actor.toLowerCase())
    if (!parentKey && actor && actor.toLowerCase() !== creator.toLowerCase()) {
      const autoKey = `auto-actor:${actor}`
      const isCurrentOwner = actor.toLowerCase() === (task.assigned_to || '').toLowerCase()
      addChild(fallbackParentKey, {
        key: autoKey,
        label: actor,
        tone: isCurrentOwner && task.task_status === 'in_progress' ? 'active' : 'user',
        status: isCurrentOwner ? (task.task_status === 'in_progress' ? 'claimed' : 'assigned') : 'assigned',
        timestamp: null,
        avatarUrl: task.participant_avatars?.[actor] ?? null,
        title: `Assigned to ${actor}`,
        subtitle: isCurrentOwner ? `Current owner · From ${creator}` : `From ${creator}`,
        focusTarget: actor,
      })
      fallbackParentKey = autoKey
      parentKey = autoKey
    }

    const resolvedParentKey = parentKey ?? fallbackParentKey
    addChild(resolvedParentKey, {
      key: `step:${index}:${target}`,
      label: target,
      tone: isDepartmentStep ? 'department' : 'user',
      status,
      timestamp: entry.assignedAt ?? null,
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
      status: task.task_status === 'in_progress' ? 'claimed' : 'assigned',
      timestamp: task.last_handoff_at ?? task.updated_at ?? null,
      avatarUrl: task.participant_avatars?.[task.assigned_to] ?? null,
      title: `Currently assigned to ${task.assigned_to}`,
      subtitle: 'Current owner',
      focusTarget: task.assigned_to,
    })
  }

  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    // Multi-pass: if the parent node is also in the assignee list but processed later,
    // defer and retry so children are always placed under the correct parent.
    const indexed = task.multi_assignment.assignees.map((entry, index) => ({ entry, index }))
    let remaining = indexed.filter(({ entry }) => !latestKeyByUser.has(entry.username.toLowerCase()))
    let passLimit = remaining.length + 1
    while (remaining.length > 0 && passLimit-- > 0) {
      const nextRound: Array<{ entry: MultiAssignmentEntry; index: number }> = []
      for (const { entry, index } of remaining) {
        const owner = getAssignmentStepOwner(task, entry.username) || task.multi_assignment?.created_by || task.assigned_to || creator
        const parentKey = latestKeyByUser.get(owner.toLowerCase())
        if (!parentKey) {
          nextRound.push({ entry, index })
          continue
        }
        const entryStatus = String(entry.status || '').toLowerCase()
        const status: WorkflowTreeNode['status'] =
          entryStatus === 'in_progress' || entryStatus === 'completed' || entryStatus === 'accepted'
            ? 'claimed'
            : entryStatus === 'pending' || entryStatus === 'rejected'
              ? 'pending'
              : 'assigned'
        addChild(parentKey, {
          key: `multi:${index}:${entry.username}`,
          label: entry.username,
          tone: (entry.status === 'in_progress' || entry.status === 'completed') ? 'active' : 'multi',
          status,
          timestamp: entry.assigned_at ?? entry.completed_at ?? null,
          avatarUrl: task.participant_avatars?.[entry.username] ?? null,
          title: `Multi-assigned to ${entry.username}`,
          subtitle: `From ${owner}`,
          focusTarget: entry.username,
        })
      }
      remaining = nextRound
    }
    // Fallback: any still-unresolvable nodes (e.g. circular) go under root
    for (const { entry, index } of remaining) {
      const entryStatus = String(entry.status || '').toLowerCase()
      const status: WorkflowTreeNode['status'] =
        entryStatus === 'in_progress' || entryStatus === 'completed' || entryStatus === 'accepted'
          ? 'claimed' : 'assigned'
      addChild(root.key, {
        key: `multi:${index}:${entry.username}`,
        label: entry.username,
        tone: 'multi',
        status,
        timestamp: entry.assigned_at ?? entry.completed_at ?? null,
        avatarUrl: task.participant_avatars?.[entry.username] ?? null,
        title: `Multi-assigned to ${entry.username}`,
        subtitle: `From ${creator}`,
        focusTarget: entry.username,
      })
    }
  }

  if (task.queue_status === 'queued' && task.queue_department && !latestKeyByUser.has(task.queue_department.toLowerCase())) {
    addChild(fallbackParentKey, {
      key: `queue:${task.queue_department}`,
      label: task.queue_department,
      tone: 'department',
      status: 'pending',
      timestamp: task.updated_at ?? null,
      title: `Queued in ${task.queue_department}`,
      subtitle: 'Waiting here',
      focusTarget: task.queue_department,
    })
  }

  return [root]
}

function buildWorkflowLayout(nodes: WorkflowTreeNode[]) {
  const layoutNodes: WorkflowLayoutNode[] = []
  const edges: WorkflowLayoutEdge[] = []
  let row = 0
  let maxDepth = 0

  const walk = (items: WorkflowTreeNode[], depth: number, parentKey: string | null) => {
    items.forEach((node) => {
      const currentRow = row
      row += 1
      maxDepth = Math.max(maxDepth, depth)
      layoutNodes.push({ node, depth, row: currentRow, parentKey })
      if (parentKey) edges.push({ from: parentKey, to: node.key })
      if (node.children?.length) walk(node.children, depth + 1, node.key)
    })
  }

  walk(nodes, 0, null)

  return {
    layoutNodes,
    edges,
    maxDepth,
    maxRow: Math.max(0, row - 1),
  }
}

function WorkflowTree({
  nodes,
  onNodeClick,
}: {
  nodes: WorkflowTreeNode[]
  onNodeClick: (node: WorkflowTreeNode) => void
}) {
  const cardWidth = 224
  const cardHeight = 124
  const colGap = 124
  const rowGap = 36
  const leftPad = 22
  const topPad = 18

  const { layoutNodes, edges } = useMemo(() => buildWorkflowLayout(nodes), [nodes])

  const layoutPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    layoutNodes.forEach((entry) => {
      map.set(entry.node.key, {
        x: leftPad + entry.depth * (cardWidth + colGap),
        y: topPad + entry.row * (cardHeight + rowGap),
      })
    })
    return map
  }, [layoutNodes])

  const [dragOverrides, setDragOverrides] = useState<Map<string, { x: number; y: number }>>(() => new Map())

  const prevKeysRef = useRef('')
  useEffect(() => {
    const keys = layoutNodes.map((n) => n.node.key).join(',')
    if (keys !== prevKeysRef.current) {
      prevKeysRef.current = keys
      setDragOverrides(new Map())
    }
  }, [layoutNodes])

  const draggingRef = useRef<{
    key: string
    startMouseX: number
    startMouseY: number
    origX: number
    origY: number
  } | null>(null)
  const hasDragged = useRef(false)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = draggingRef.current
    if (!drag) return
    const dx = e.clientX - drag.startMouseX
    const dy = e.clientY - drag.startMouseY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged.current = true
    setDragOverrides((prev) => {
      const next = new Map(prev)
      next.set(drag.key, {
        x: Math.max(0, drag.origX + dx),
        y: Math.max(0, drag.origY + dy),
      })
      return next
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)
    window.addEventListener('mouseleave', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      window.removeEventListener('mouseleave', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const { canvasWidth, canvasHeight } = useMemo(() => {
    let maxX = 0
    let maxY = 0
    layoutNodes.forEach(({ node }) => {
      const pos = dragOverrides.get(node.key) ?? layoutPositions.get(node.key)
      if (pos) {
        maxX = Math.max(maxX, pos.x + cardWidth + leftPad)
        maxY = Math.max(maxY, pos.y + cardHeight + topPad)
      }
    })
    return { canvasWidth: Math.max(maxX, 300), canvasHeight: Math.max(maxY, 160) }
  }, [dragOverrides, layoutPositions, layoutNodes])

  if (nodes.length === 0) return null

  const chipStyle: Record<WorkflowTreeNode['status'], string> = {
    start: 'bg-[#1137C8] text-white',
    assigned: 'bg-[#DDF8E8] text-[#13884A]',
    claimed: 'bg-[#DEE9FF] text-[#2250C8]',
    pending: 'bg-[#EFF3F8] text-[#77859A]',
  }

  const statusLabel: Record<WorkflowTreeNode['status'], string> = {
    start: 'START',
    assigned: 'ASSIGNED',
    claimed: 'CLAIMED',
    pending: 'PENDING',
  }

  return (
    <div className="rounded-[26px] border border-slate-200 bg-[#EEF1F6] p-4 md:p-5 select-none">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Assignment Flow</span>
        <span className="text-[10px] text-slate-400">· drag nodes to reposition</span>
      </div>
      <div className="overflow-auto pb-2">
        <div className="relative" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
          <svg className="pointer-events-none absolute inset-0" width={canvasWidth} height={canvasHeight}>
            {edges.map((edge) => {
              const from = dragOverrides.get(edge.from) ?? layoutPositions.get(edge.from)
              const to = dragOverrides.get(edge.to) ?? layoutPositions.get(edge.to)
              if (!from || !to) return null
              const startX = from.x + cardWidth
              const startY = from.y + cardHeight / 2
              const endX = to.x
              const endY = to.y + cardHeight / 2
              const midX = (startX + endX) / 2
              const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={d}
                  stroke="#C5CFDE"
                  strokeWidth="1.8"
                  strokeDasharray="5 8"
                  fill="none"
                  strokeLinecap="round"
                />
              )
            })}
          </svg>

          {layoutNodes.map(({ node }) => {
            const pos = dragOverrides.get(node.key) ?? layoutPositions.get(node.key)
            if (!pos) return null

            const avatarTone =
              node.tone === 'department'
                ? 'bg-emerald-100 text-emerald-700'
                : node.tone === 'multi'
                  ? 'bg-cyan-100 text-cyan-700'
                  : node.tone === 'active'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-white text-slate-700'

            return (
              <div
                key={node.key}
                role="button"
                tabIndex={0}
                className={cn(
                  'absolute rounded-[20px] border bg-white px-4 py-3 cursor-grab active:cursor-grabbing shadow-[0_10px_26px_rgba(16,24,40,0.08)] hover:shadow-[0_14px_34px_rgba(16,24,40,0.12)]',
                  node.status === 'start' ? 'border-[#1E48D9] ring-1 ring-[#C9D6FF]' : 'border-[#E5EAF2]',
                  node.status === 'claimed' && 'ring-1 ring-blue-100',
                  node.status === 'pending' && 'opacity-70'
                )}
                style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${cardWidth}px`, minHeight: `${cardHeight}px` }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  const currentPos = dragOverrides.get(node.key) ?? layoutPositions.get(node.key)
                  if (!currentPos) return
                  hasDragged.current = false
                  draggingRef.current = {
                    key: node.key,
                    startMouseX: e.clientX,
                    startMouseY: e.clientY,
                    origX: currentPos.x,
                    origY: currentPos.y,
                  }
                }}
                onClick={() => {
                  if (!hasDragged.current) onNodeClick(node)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onNodeClick(node)
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em]', chipStyle[node.status])}>
                    {statusLabel[node.status]}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatFlowAge(node.timestamp)}</span>
                </div>

                <div className="truncate text-slate-900" style={{ fontSize: node.status === 'start' ? '32px' : '29px', lineHeight: node.status === 'start' ? '1.02' : '1.08', fontWeight: 600 }}>
                  {node.label}
                </div>
                {node.subtitle && <div className="mt-1 truncate text-[12px] text-slate-500">{node.subtitle}</div>}

                <div className="mt-3 flex items-center gap-2">
                  <UserAvatar
                    username={node.label}
                    avatarUrl={node.avatarUrl}
                    size="sm"
                    className={cn('h-7 w-7 ring-1 ring-slate-200 shrink-0', avatarTone)}
                  />
                  <span className="truncate text-[12px] text-slate-500">{node.title}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
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
  const [backHref, setBackHref] = useState('/dashboard/tasks')
  const [activeTab, setActiveTab] = useState<TabId>('info')
  const [comment, setComment] = useState('')
  const [shareUsername, setShareUsername] = useState('')
  const [shareUsers, setShareUsers] = useState<Array<{ username: string; role: string; department: string | null; avatar_data: string | null }>>([])
  const [stepEditNewAssignee, setStepEditNewAssignee] = useState('')
  const [stepEditAddSearch, setStepEditAddSearch] = useState('')
  const [stepEditAddUsers, setStepEditAddUsers] = useState<Array<{ username: string; dueDate: string }>>([])
  const [highlightedAssignee, setHighlightedAssignee] = useState<string | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [showDeclineInput, setShowDeclineInput] = useState(false)
  const [editTask, setEditTask] = useState<Todo | null>(null)
  const [actionError, setActionError] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [pendingAttachmentDelete, setPendingAttachmentDelete] = useState<{ id: string; name: string } | null>(null)
  const [showCreatorCompleteConfirm, setShowCreatorCompleteConfirm] = useState(false)
  const [showHandoffDialog, setShowHandoffDialog] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ progress: number; fileName: string; currentFile: number; totalFiles: number; stage: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [taskDialog, setTaskDialog] = useState<TaskActionDialogState>(null)
  const [dialogValue, setDialogValue] = useState('')
  const [dialogExtraValue, setDialogExtraValue] = useState('')
  const [dialogFiles, setDialogFiles] = useState<File[]>([])
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const assigneeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const detailsQuery = useQuery({
    queryKey: queryKeys.taskDetail(initialDetails.id),
    queryFn: async () => {
      const updated = await getTodoDetails(initialDetails.id)
      return updated ?? initialDetails
    },
    initialData: initialDetails,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  })

  const details = detailsQuery.data ?? initialDetails
  const appNames = splitTaskMeta(details.app_name)
  const packageNames = splitTaskMeta(details.package_name)
  const workflowTree = useMemo(
    () => activeTab === 'info' ? buildWorkflowTree(details) : [],
    [activeTab, details]
  )
  const refreshDetails = useCallback(async () => {
    const updated = await getTodoDetails(details.id)
    if (!updated) {
      router.push(backHref)
      return
    }
    queryClient.setQueryData(queryKeys.taskDetail(details.id), updated)
    queryClient.setQueryData<Todo[]>(queryKeys.tasks(currentUsername), (prev) => {
      if (!prev) return prev
      return prev.map((task) => (task.id === updated.id ? { ...task, ...updated } : task))
    })
  }, [backHref, currentUsername, details.id, queryClient, router])

  const markCommentsReadLocally = useCallback(() => {
    queryClient.setQueryData<TodoDetails>(queryKeys.taskDetail(details.id), (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        history: prev.history.map((entry) => clearCurrentUserUnreadFlags(entry, currentUsername)),
      }
    })

    queryClient.setQueryData<Todo[]>(queryKeys.tasks(currentUsername), (prev) => {
      if (!prev) return prev
      return prev.map((task) =>
        task.id !== details.id
          ? task
          : {
              ...task,
              unread_comment_count: 0,
              history: task.history.map((entry) => clearCurrentUserUnreadFlags(entry, currentUsername)),
            }
      )
    })
  }, [currentUsername, details.id, queryClient])

  useEffect(() => {
    const stored = sessionStorage.getItem('task-detail-back')
    if (stored) {
      setBackHref(stored)
      sessionStorage.removeItem('task-detail-back')
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'share') return
    let cancelled = false
    getUsersForAssignment().then((users) => {
      if (!cancelled) setShareUsers(users)
    })
    return () => { cancelled = true }
  }, [activeTab])

  useEffect(() => {
    if (typeof window === 'undefined') return
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
  }, [details.id, details.multi_assignment])

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
      try {
        const res = await fn()
        if (!res.success) {
          setActionError(res.error ?? 'Action failed')
          return
        }
        if (options?.redirectToTasks) {
          router.push(backHref)
          return
        }
        await refreshDetails()
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Unexpected action error')
      }
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
  const isLeaderRole =
    currentUserRole === 'Manager' ||
    currentUserRole === 'Supervisor' ||
    currentUserRole === 'Super Manager' ||
    currentUserRole === 'Admin'
  const isCreator = t.username === currentUsername
  const isAssignee = t.assigned_to === currentUsername
  // Hall scheduler controls only apply once the task is actively in a user's hall queue flow.
  const tAny = t as unknown as Record<string, unknown>
  const hallSchedulerState = tAny.scheduler_state as string | null
  const isHallTask = !!t.cluster_id && !t.cluster_inbox
  const isHallScheduledForMe = isAssignee && !!t.cluster_id && t.workflow_state === 'claimed_by_department'
  const isPendingApproval = t.approval_status === 'pending_approval'
  const pendingApprover = t.pending_approver || t.username
  const canApproveCurrentStep = isPendingApproval && pendingApprover.toLowerCase() === currentUsername.toLowerCase()
  const isMySubmission = (t.completed_by || '').toLowerCase() === currentUsername.toLowerCase()
  const isCurrentlyAssignedToMe = (t.assigned_to || '').toLowerCase() === currentUsername.toLowerCase()
  const hasForwardedSubmission = (t.assignment_chain || []).some((entry) => {
    const actor = (entry.user || '').toLowerCase()
    const role = String(entry.role || '').toLowerCase()
    const action = String(entry.action || '').toLowerCase()
    return actor === currentUsername.toLowerCase() && (
      role === 'submitted_for_approval' ||
      action === 'submit' ||
      action === 'complete' ||
      action === 'complete_final'
    )
  })
  const isCompleted = t.completed ||
    (isMySubmission && (!isCurrentlyAssignedToMe || isPendingApproval)) ||
    (hasForwardedSubmission && (isPendingApproval || !isCurrentlyAssignedToMe))
  const ma = t.multi_assignment
  const maEnabled = !!(ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0)
  const singleStepOwner = !maEnabled && t.assigned_to ? getAssignmentStepOwner(t, t.assigned_to) : null
  const showSingleDueDateBtn = !maEnabled && !isCompleted && !isPendingApproval && !!t.assigned_to && (singleStepOwner || '').toLowerCase() === currentUsername.toLowerCase()
  const maProgress = t.completed
    ? 100
    : (ma?.completion_percentage ?? (
      ma?.assignees?.length
        ? Math.round((ma.assignees.filter((entry) => entry.status === 'accepted' || entry.status === 'completed').length / ma.assignees.length) * 100)
        : 0
    ))
  
  // Multi-level Complete button logic
  const stepOwner = t.assigned_to ? getAssignmentStepOwner(t, t.assigned_to) : null
  const isStepOwner = (stepOwner || '').toLowerCase() === currentUsername.toLowerCase()
  const currentAssigneeApproved = (t.approval_status === 'approved' || !t.approval_status) && !!t.completed_by
  const showStandardReassignBtn =
    !isCompleted &&
    !isPendingApproval &&
    (isAssignee || isCreator) &&
    !!t.assigned_to &&
    !maEnabled &&
    !t.cluster_id
  const showHallMgrReassignBtn = !!t.cluster_id && !t.cluster_inbox && !isCompleted && isLeaderRole && !isCreator
  
  const showCompleteBtn = !t.completed && !isPendingApproval && (
    (isAssignee && !maEnabled && (t.task_status === 'in_progress' || (isHallScheduledForMe && hallSchedulerState === 'active'))) || 
    (isStepOwner && currentAssigneeApproved)
  )

  const myMaEntry = ma?.assignees?.find((entry) => (entry.username || '').toLowerCase() === currentUsername.toLowerCase())
  const delegatedOwner = ma?.assignees?.find((entry) => Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase()))
  const myDelegatedEntry = delegatedOwner?.delegated_to?.find((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase())
  const sm = STATUS_META[t.task_status] ?? STATUS_META.backlog
  const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.medium
  const comments = t.history.filter((h: HistoryEntry) => h.type === 'comment' && (!h.is_deleted || isAdminOrSuperManager))
  const historyEvents = t.history.filter((h: HistoryEntry) => h.type !== 'comment')
  const activityTimeline = [
    ...historyEvents,
    ...t.attachments.map((a) => ({
      type: 'file_attached',
      user: a.uploaded_by,
      title: 'File Attached',
      details: a.file_name,
      timestamp: a.created_at,
    } as HistoryEntry)),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
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
    markCommentsReadLocally()
    void markTaskCommentsReadAction(t.id)
  }, [comments, currentUsername, markCommentsReadLocally, t.id])

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
    setStepEditNewAssignee('')
    setStepEditAddSearch('')
    setStepEditAddUsers([])
    setTaskDialog(dialog)
    if (dialog.type === 'step-edit') {
      const assigneeEntry = details.multi_assignment?.assignees?.find(
        (a) => a.username.toLowerCase() === dialog.assigneeUsername.toLowerCase()
      )
      if (assigneeEntry?.actual_due_date) setDialogValue(pakistanInputValue(assigneeEntry.actual_due_date))
      if (assigneeEntry?.notes) setDialogExtraValue(assigneeEntry.notes)
      void getUsersForAssignment().then((users) => {
        setShareUsers(users)
      })
    }
  }

  const closeTaskDialog = () => {
    setTaskDialog(null)
    setDialogValue('')
    setDialogExtraValue('')
    setDialogFiles([])
    setStepEditNewAssignee('')
    setStepEditAddSearch('')
    setStepEditAddUsers([])
  }

  const submitTaskDialog = () => {
    if (!taskDialog) return

    switch (taskDialog.type) {
      case 'ma-submit': {
        const note = dialogValue.trim() || undefined
        const files = dialogFiles.slice()
        closeTaskDialog()
        void doAction(async () => {
          if (files.length) {
            const supabase = createBrowserClient()
            for (const file of files) {
              const signed = await createTaskAttachmentUploadUrlAction({ todo_id: t.id, owner_username: t.username, file_name: file.name })
              if (!signed.success || !signed.path || !signed.token) return { success: false, error: signed.error ?? 'File upload failed' }
              const upload = await supabase.storage.from(signed.bucket || CMS_STORAGE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file)
              if (upload.error) return { success: false, error: upload.error.message }
              const saved = await saveTodoAttachmentAction({ todo_id: t.id, file_name: file.name, file_size: file.size, mime_type: file.type || null, storage_path: signed.path })
              if (!saved.success) return { success: false, error: saved.error ?? `Failed to attach ${file.name}` }
            }
          }
          return updateMaAssigneeStatusAction(t.id, 'completed', note)
        })
        return
      }
      case 'complete': {
        const note = dialogValue.trim()
        if (!note) {
          setActionError('Completion feedback is required.')
          return
        }
        const files = dialogFiles.slice()
        closeTaskDialog()
        void doAction(async () => {
          if (files.length) {
            const supabase = createBrowserClient()
            for (const file of files) {
              const signed = await createTaskAttachmentUploadUrlAction({ todo_id: t.id, owner_username: t.username, file_name: file.name })
              if (!signed.success || !signed.path || !signed.token) return { success: false, error: signed.error ?? 'File upload failed' }
              const upload = await supabase.storage.from(signed.bucket || CMS_STORAGE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file)
              if (upload.error) return { success: false, error: upload.error.message }
              const saved = await saveTodoAttachmentAction({ todo_id: t.id, file_name: file.name, file_size: file.size, mime_type: file.type || null, storage_path: signed.path })
              if (!saved.success) return { success: false, error: saved.error ?? `Failed to attach ${file.name}` }
            }
          }
          return toggleTodoCompleteAction(t.id, true, note)
        })
        return
      }
      case 'single-due-date':
        if (!dialogValue.trim()) {
          setActionError('Due date is required.')
          return
        }
        void doAction(() => updateSingleTaskDueDateAction(t.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'step-edit':
        startTransition(async () => {
          if (stepEditAddUsers.length > 0 && stepEditAddUsers.some((u) => !u.dueDate.trim())) {
            setActionError('Each new member must have a due date.')
            return
          }
          let changed = false
          if (stepEditNewAssignee.trim()) {
            const res = await reassignTaskAction(t.id, stepEditNewAssignee.trim(), dialogExtraValue.trim() || undefined)
            if (!res.success) { setActionError(res.error ?? 'Failed to reassign'); return }
            changed = true
          } else if (dialogValue.trim()) {
            const res = await updateAssignmentStepAction(t.id, taskDialog.assigneeUsername, dialogValue.trim(), dialogExtraValue.trim() || undefined)
            if (!res.success) { setActionError(res.error ?? 'Failed to update step'); return }
            changed = true
          }
          if (stepEditAddUsers.length > 0) {
            const res = await extendMultiAssignmentStepAction(
              t.id,
              stepEditAddUsers.map((u) => ({ username: u.username, actual_due_date: new Date(u.dueDate).toISOString() })),
            )
            if (!res.success) { setActionError(res.error ?? 'Failed to add members'); return }
            changed = true
          }
          if (!changed) { setActionError('No changes to save.'); return }
          closeTaskDialog()
          void refreshDetails()
        })
        return
      case 'split-multi': {
        const rows = dialogValue
          .split('\n')
          .map((row) => row.trim())
          .filter(Boolean)
        if (rows.length === 0) {
          setActionError('Add at least one assignee line: username|YYYY-MM-DDTHH:mm')
          return
        }
        const assignees = rows
          .map((row) => {
            const [username, dueDate] = row.split('|').map((part) => part.trim())
            return {
              username,
              actual_due_date: dueDate ? new Date(dueDate).toISOString() : null,
            }
          })
          .filter((entry) => entry.username)
        if (assignees.length === 0) {
          setActionError('Assignee lines are invalid.')
          return
        }
        void doAction(() => convertTaskToMultiAssignmentAction(t.id, assignees))
        closeTaskDialog()
        return
      }
      case 'delegate':
        if (!dialogValue.trim()) {
          setActionError('Please enter a username for delegation.')
          return
        }
        void doAction(() => delegateMaAssigneeAction(t.id, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'sub-submit': {
        const note = dialogValue.trim() || undefined
        const files = dialogFiles.slice()
        const delegatorUsername = taskDialog.delegatorUsername
        closeTaskDialog()
        void doAction(async () => {
          if (files.length) {
            const supabase = createBrowserClient()
            for (const file of files) {
              const signed = await createTaskAttachmentUploadUrlAction({ todo_id: t.id, owner_username: t.username, file_name: file.name })
              if (!signed.success || !signed.path || !signed.token) return { success: false, error: signed.error ?? 'File upload failed' }
              const upload = await supabase.storage.from(signed.bucket || CMS_STORAGE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file)
              if (upload.error) return { success: false, error: upload.error.message }
              const saved = await saveTodoAttachmentAction({ todo_id: t.id, file_name: file.name, file_size: file.size, mime_type: file.type || null, storage_path: signed.path })
              if (!saved.success) return { success: false, error: saved.error ?? `Failed to attach ${file.name}` }
            }
          }
          return updateMaSubAssigneeStatusAction(t.id, delegatorUsername, 'completed', note)
        })
        return
      }
      case 'reject-assignee':
        if (!dialogValue.trim()) {
          setActionError('Feedback is required.')
          return
        }
        void doAction(() => rejectMaAssigneeAction(t.id, taskDialog.assigneeUsername, dialogValue.trim()))
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
    await refreshDetails()
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

  const handleWorkflowNodeClick = useCallback((node: WorkflowTreeNode) => {
    if (!node.focusTarget) return
    if (details.multi_assignment?.assignees?.some((entry) => entry.username === node.focusTarget)) {
      setHighlightedAssignee(node.focusTarget)
      window.setTimeout(() => {
        assigneeRefs.current[node.focusTarget!]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
      window.setTimeout(() => {
        setHighlightedAssignee((current) => (current === node.focusTarget ? null : current))
      }, 2600)
    }
  }, [details.multi_assignment])

  return (
    <>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)] px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/80 bg-white/85 px-3 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:px-5 sm:py-4">
            <div className="min-w-0">
              <Link href={backHref} className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-blue-600">
                <ArrowLeft size={14} />
                Back To Tasks
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', sm.bg, sm.text)}>
                  <span className={cn('h-2 w-2 rounded-full', sm.dot)} />
                  {sm.label}
                </span>
                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', pm.bg, pm.text)}>{pm.label}</span>
                {isPendingApproval && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Pending: {pendingApprover}</span>}
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
              {isAssignee && t.task_status === 'todo' && !isHallTask && (
                <PrimaryBtn icon={<PlayCircle size={14} />} label="Start Work" color="blue" onClick={() => doAction(() => startTaskAction(t.id))} loading={isPending} />
              )}
              {showStandardReassignBtn && (
                <button
                  onClick={() => setShowHandoffDialog(true)}
                  className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                >
                  Assign To Next
                </button>
              )}
              {showHallMgrReassignBtn && (
                <>
                  <button
                    onClick={() => router.push(`/dashboard/tasks/hall-assign/${t.id}`)}
                    className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                  >
                    Assign to Team Member
                  </button>
                  <button
                    onClick={() => router.push(`/dashboard/tasks/route-cluster/${t.id}`)}
                    className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                  >
                    Assign to Other Department
                  </button>
                </>
              )}
              {showSingleDueDateBtn && (
                <button
                    onClick={() => router.push(`/dashboard/tasks/edit-assignee/${t.id}`)}
                  className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                >
                  Edit Assignee
                </button>
              )}
              {showCompleteBtn && (
                <PrimaryBtn
                  icon={<CheckCircle2 size={14} />}
                  label={isCreator ? 'Mark Complete' : 'Submit Completion'}
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
              {canApproveCurrentStep && (
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

              {/* Activate button — hall task stuck in user_queue with no active task */}
              {isHallScheduledForMe && hallSchedulerState === 'user_queue' && !isCompleted && (
                <button
                  onClick={() => doAction(() => activateHallTaskAction(t.id))}
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                >
                  Start Task
                </button>
              )}

              {/* Pause button — only for hall-scheduled task that is active AND has other queued tasks */}
              {isHallScheduledForMe && hallSchedulerState === 'active' && !isCompleted && (
                <button
                  onClick={() => doAction(() => pauseHallTaskAction(t.id))}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                >
                  Pause
                </button>
              )}
              {showStandardReassignBtn && (
                <button 
                  onClick={() => openTaskDialog({ type: 'reassign' })}
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                >
                  {isCreator ? 'Reassign' : 'Assign to next'}
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

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_380px]">
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
                    <WorkflowTree nodes={workflowTree} onNodeClick={handleWorkflowNodeClick} />
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
                        <Section
                          icon={<Users size={14} />}
                        label="Multi-Assignment"
                      >
                        <div className="grid gap-3">
                          {t.multi_assignment.assignees.map((assignee) => {
                            const pct = maProgress
                            const done = t.completed || assignee.status === 'completed' || assignee.status === 'accepted'
                            return (
                              <div
                                key={assignee.username}
                                ref={(node) => {
                                  assigneeRefs.current[assignee.username] = node
                                }}
                                className={cn(
                                  'rounded-[24px] border border-cyan-100 bg-cyan-50 px-4 py-3 transition-all duration-500',
                                  highlightedAssignee === assignee.username && 'ring-2 ring-blue-300 shadow-[0_0_0_6px_rgba(59,130,246,0.12)]'
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white', done ? 'bg-green-500' : assignee.status === 'in_progress' ? 'bg-blue-500' : 'bg-slate-400')}>
                                    {assignee.username.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-slate-800">{assignee.username}</p>
                                    <p className="text-xs capitalize text-slate-500">{assignee.status ?? 'pending'}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      {getAssignmentStepOwner(t, assignee.username) && (
                                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                          By {getAssignmentStepOwner(t, assignee.username)}
                                        </span>
                                      )}
                                      {getAssignmentStepNote(t, assignee.username) && (
                                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                                          Note by {getAssignmentStepOwner(t, assignee.username) || 'User'}
                                        </span>
                                      )}
                                      <span className="text-[11px] text-slate-400">
                                        Due {getAssigneeDueDate(t, assignee.username) ? formatPakistanDate(getAssigneeDueDate(t, assignee.username) as string) : '-'}
                                      </span>
                                    </div>
                                    {getAssignmentStepNote(t, assignee.username) && (
                                      <div className="mt-2 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                        {getAssignmentStepNote(t, assignee.username)}
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                                  <div className={cn('h-full rounded-full', done ? 'bg-green-500' : 'bg-blue-500')} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {((getAssignmentStepOwner(t, assignee.username) || '').toLowerCase() === currentUsername.toLowerCase()) && !isCompleted && (
                                    <button
                                      onClick={() => {
                                        setDialogValue(pakistanInputValue(assignee.actual_due_date))
                                        setDialogExtraValue(getAssignmentStepNote(t, assignee.username))
                                        openTaskDialog({ type: 'step-edit', assigneeUsername: assignee.username })
                                      }}
                                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                    >
                                      Edit
                                    </button>
                                  )}
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
                )}

                {activeTab === 'history' && (
                  <div>
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
                              <a
                                href={attachment.file_url}
                                download={attachment.file_name}
                                className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                              >
                                Open File
                              </a>
                              <a
                                href={attachment.file_url}
                                download={attachment.file_name}
                                className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                              >
                                Download
                              </a>
                              {canRemoveAttachment && (
                                <button
                                  type="button"
                                  onClick={() => setPendingAttachmentDelete({ id: attachment.id, name: attachment.file_name })}
                                  disabled={deletingAttachmentId === attachment.id}
                                  className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    {deletingAttachmentId === attachment.id ? <Loader2 size={14} className="animate-spin" /> : null}
                                    {deletingAttachmentId === attachment.id ? 'Removing...' : 'Remove'}
                                  </span>
                                </button>
                              )}
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
                          className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:min-w-[220px]"
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

                {activeTab === 'timeline' && (
                  <div className="space-y-5">
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
                )}
              </div>
            </section>

            <aside className="flex min-h-0 flex-col self-start overflow-hidden rounded-[32px] border border-white/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)] xl:sticky xl:top-5 xl:min-h-[720px] xl:max-h-[calc(100vh-2.5rem)]">
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

      {taskDialog?.type === 'step-edit' && (() => {
        const maAssignees = t.multi_assignment?.assignees ?? []
        const existingUsernames = new Set(maAssignees.map((a) => a.username.toLowerCase()))
        const availableForAdd = shareUsers.filter((u) => !existingUsernames.has(u.username.toLowerCase()))
        const filteredForAdd = availableForAdd.filter(
          (u) => !stepEditAddUsers.some((s) => s.username === u.username) &&
            (!stepEditAddSearch.trim() || u.username.toLowerCase().includes(stepEditAddSearch.toLowerCase()))
        )
        const getStatusMeta = (status?: string) => {
          if (status === 'completed') return { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
          if (status === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' }
          if (status === 'accepted') return { label: 'Accepted', cls: 'bg-teal-50 text-teal-700 border-teal-200', dot: 'bg-teal-400' }
          if (status === 'rejected') return { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' }
          return { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' }
        }
        const saveLabel = stepEditNewAssignee.trim() ? 'Reassign Task' : stepEditAddUsers.length > 0 ? 'Save & Add Members' : 'Save Changes'
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
            <div className="relative flex w-full max-w-2xl flex-col rounded-3xl border border-white/80 bg-white shadow-[0_32px_100px_rgba(15,23,42,0.28)]" style={{ maxHeight: '92vh' }}>
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Manage Assignment Step</p>
                  <h2 className="text-lg font-bold text-slate-900 leading-snug truncate">{t.title}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Editing step for <span className="font-semibold text-slate-700">{taskDialog.assigneeUsername}</span></p>
                </div>
                <button onClick={closeTaskDialog} className="ml-4 mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                  <X size={18} />
                </button>
              </div>
              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {actionError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{actionError}</div>
                )}
                {/* Section 1: Current Team */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Users size={14} className="text-slate-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Current Team ({maAssignees.length})</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {maAssignees.map((assignee) => {
                      const sm = getStatusMeta(assignee.status)
                      const isBeingEdited = assignee.username.toLowerCase() === taskDialog.assigneeUsername.toLowerCase()
                      return (
                        <div key={assignee.username} className={cn('flex items-center gap-3 rounded-2xl border px-3 py-2.5', isBeingEdited ? 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-100' : 'border-slate-200 bg-slate-50/60')}>
                          <div className="h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
                            style={{ background: isBeingEdited ? 'linear-gradient(135deg,#3B82F6,#2563EB)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}>
                            {assignee.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn('text-sm font-semibold truncate', isBeingEdited ? 'text-blue-800' : 'text-slate-800')}>{assignee.username}</p>
                            {assignee.actual_due_date && <p className="text-[11px] text-slate-400 truncate">Due {formatPakistanDate(assignee.actual_due_date)}</p>}
                          </div>
                          <span className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold flex-shrink-0', sm.cls)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', sm.dot)} />
                            {sm.label}
                          </span>
                          {isBeingEdited && <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">Editing</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {/* Section 2: Edit this step's date + note */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Edit3 size={14} className="text-slate-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Edit {taskDialog.assigneeUsername}&apos;s Step</span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                    <DialogInput label="Assignee Due Date" value={dialogValue} onChange={setDialogValue} type="datetime-local" min={pakistanOfficeMinInputValue()} />
                    <DialogTextarea label="Step Instructions / Note" value={dialogExtraValue} onChange={setDialogExtraValue} placeholder="Add or update instructions for this assignee only" />
                  </div>
                </div>
                {/* Section 3: Replace this person */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <UserMinus size={14} className="text-slate-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Replace This Person <span className="normal-case font-normal text-[10px] text-slate-400 ml-1">(optional)</span></span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                    {shareUsers.length > 0 ? (
                      <>
                        <input value={stepEditNewAssignee} onChange={(e) => setStepEditNewAssignee(e.target.value)} placeholder="Search users to replace with..."
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 mb-3" />
                        <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-xl">
                          {shareUsers.filter((u) =>
                            u.username.toLowerCase() !== taskDialog.assigneeUsername.toLowerCase() &&
                            (!stepEditNewAssignee.trim() || u.username.toLowerCase().includes(stepEditNewAssignee.toLowerCase()))
                          ).map((u) => {
                            const isSelected = stepEditNewAssignee === u.username
                            return (
                              <button key={u.username} type="button" onClick={() => setStepEditNewAssignee(isSelected ? '' : u.username)}
                                className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all', isSelected ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                                <div className="h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                                  style={{ background: isSelected ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}>
                                  {u.username.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={cn('text-sm font-medium truncate', isSelected ? 'text-violet-700' : 'text-slate-700')}>{u.username}</p>
                                  {u.department && <p className="text-[11px] text-slate-400 truncate">{u.department}</p>}
                                </div>
                                {isSelected && <span className="text-[11px] font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full flex-shrink-0">Selected</span>}
                              </button>
                            )
                          })}
                        </div>
                        {stepEditNewAssignee.trim() && shareUsers.some((u) => u.username === stepEditNewAssignee) && (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
                            ⚠ Saving will <strong>replace</strong> {taskDialog.assigneeUsername} with <strong>{stepEditNewAssignee}</strong>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Loading users...</span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Section 4: Add more members */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <UserPlus size={14} className="text-slate-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Add More Members <span className="normal-case font-normal text-[10px] text-slate-400 ml-1">(optional)</span></span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                    <input value={stepEditAddSearch} onChange={(e) => setStepEditAddSearch(e.target.value)} placeholder="Search users to add..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 mb-3" />
                    {stepEditAddUsers.length > 0 && (
                      <div className="mb-3 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Will be added ({stepEditAddUsers.length})</p>
                        {stepEditAddUsers.map((entry) => (
                          <div key={entry.username} className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                            <div className="h-7 w-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                              style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)' }}>
                              {entry.username.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-blue-800 flex-1 min-w-0 truncate">{entry.username}</span>
                            <input type="datetime-local" value={entry.dueDate} min={pakistanOfficeMinInputValue()}
                              onChange={(e) => setStepEditAddUsers((prev) => prev.map((u) => u.username === entry.username ? { ...u, dueDate: e.target.value } : u))}
                              className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400 flex-shrink-0" />
                            <button type="button" onClick={() => setStepEditAddUsers((prev) => prev.filter((u) => u.username !== entry.username))}
                              className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"><X size={14} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-xl">
                      {filteredForAdd.length === 0 ? (
                        <div className="py-4 text-center text-sm text-slate-400">{shareUsers.length === 0 ? 'Loading...' : 'No more available users.'}</div>
                      ) : filteredForAdd.map((u) => (
                        <button key={u.username} type="button"
                          onClick={() => setStepEditAddUsers((prev) => [...prev, { username: u.username, dueDate: '' }])}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-200 text-left transition-all">
                          <div className="h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                            style={{ background: 'linear-gradient(135deg,#94a3b8,#64748b)' }}>
                            {u.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{u.username}</p>
                            {u.department && <p className="text-[11px] text-slate-400 truncate">{u.department}</p>}
                          </div>
                          <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full flex-shrink-0">+ Add</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4 rounded-b-3xl">
                <div className="flex-1 min-w-0">
                  {actionError && <p className="text-sm text-red-600 truncate">{actionError}</p>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={closeTaskDialog} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
                  <button onClick={submitTaskDialog} disabled={isPending}
                    className="rounded-2xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition-all">
                    {isPending ? 'Saving...' : saveLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {taskDialog && taskDialog.type !== 'step-edit' && (
        <ActionDialog
          title={
            taskDialog.type === 'complete' ? 'Submit completion feedback' :
            taskDialog.type === 'single-due-date' ? 'Set assignee due date' :
            taskDialog.type === 'split-multi' ? 'Split into multi-assignment' :
            taskDialog.type === 'delegate' ? 'Delegate task work' :
            taskDialog.type === 'remove-delegation' ? 'Remove delegation' :
            taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Send feedback' :
            taskDialog.type === 'delete-comment' ? 'Delete message' :
            'Add summary'
          }
          description={
            taskDialog.type === 'complete' ? 'Add a short summary before submitting this task as completed.' :
            taskDialog.type === 'single-due-date' ? 'Set the assignee due date for this single task.' :
            taskDialog.type === 'split-multi' ? 'Add one assignee per line: username|YYYY-MM-DDTHH:mm (due optional).' :
            taskDialog.type === 'delegate' ? 'Assign this work to another username with optional instructions.' :
            taskDialog.type === 'remove-delegation' ? 'This removes the delegated user from the task workflow.' :
            taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Give clear feedback so the work can be corrected.' :
            taskDialog.type === 'delete-comment' ? 'This will remove the message from the conversation.' :
            'Add an optional summary for this submission.'
          }
          primaryLabel={taskDialog.type === 'remove-delegation' ? 'Remove delegation' : taskDialog.type === 'delete-comment' ? 'Delete message' : taskDialog.type === 'complete' ? 'Submit completion' : taskDialog.type === 'single-due-date' ? 'Save changes' : 'Confirm'}
          onClose={closeTaskDialog}
          onConfirm={submitTaskDialog}
        >
          {taskDialog.type === 'complete' ? (
            <div className="space-y-3">
              <DialogTextarea
                label="Completion Feedback"
                value={dialogValue}
                onChange={setDialogValue}
                placeholder="What work was completed? Add summary or handoff notes."
              />
              <CompletionFileInput files={dialogFiles} onChange={setDialogFiles} />
            </div>
          ) : taskDialog.type === 'single-due-date' ? (
            <DialogInput label="Assignee Due Date" value={dialogValue} onChange={setDialogValue} type="datetime-local" min={pakistanOfficeMinInputValue()} />
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
          ) : (
            <div className="space-y-3">
              <DialogTextarea
                label={taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit' ? 'Summary (optional)' : 'Feedback'}
                value={dialogValue}
                onChange={setDialogValue}
                placeholder={taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit' ? 'Add work summary or notes' : 'Type feedback here'}
              />
              {(taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit') && (
                <CompletionFileInput files={dialogFiles} onChange={setDialogFiles} />
              )}
            </div>
          )}
        </ActionDialog>
      )}
      {showHandoffDialog && (
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
      )}

      {editTask && <CreateTaskModal editTask={editTask} onClose={() => setEditTask(null)} onSaved={refreshDetails} />}
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
          void doAction(() => toggleTodoCompleteAction(t.id, true))
          setShowCreatorCompleteConfirm(false)
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
    </>
  )
}

function CompletionFileInput({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">Attachments (optional)</span>
      <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50/50">
        <Paperclip size={14} className="flex-shrink-0" />
        <span>Click to attach files</span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (selected.length) onChange([...files, ...selected])
          }}
        />
      </label>
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <Paperclip size={11} className="flex-shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="flex-shrink-0 text-slate-400 transition-colors hover:text-red-500"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
  if (type === 'datetime-local') {
    return (
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
        <OfficeDateTimePicker value={value} onChange={onChange} min={min} className="w-full" />
      </label>
    )
  }
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

function Section({ icon, label, action, children }: { icon: ReactNode; label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {icon}
          {label}
        </div>
        {action}
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
  color: 'blue' | 'green' | 'red' | 'amber'
  onClick: () => void
  loading?: boolean
}) {
  const cls = {
    blue: 'bg-blue-600 text-white hover:bg-blue-700',
    green: 'bg-green-600 text-white hover:bg-green-700',
    red: 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
    amber: 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
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
