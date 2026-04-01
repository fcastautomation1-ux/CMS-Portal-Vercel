'use client'

import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import { useState, useTransition, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Todo, MultiAssignmentEntry, MultiAssignmentSubEntry } from '@/types'
import { cn } from '@/lib/cn'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { OfficeDateTimePicker } from '@/components/ui/office-datetime-picker'
import { UserAvatar } from '@/components/ui/user-avatar'
import { formatPakistanDate, formatPakistanTime, pakistanInputValue, pakistanOfficeMinInputValue } from '@/lib/pakistan-time'
import { splitTaskMeta } from '@/lib/task-metadata'
import { taskDescriptionToPlainText } from '@/lib/task-description'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'
import {
  Eye, Edit3, Trash2, Copy, ExternalLink,
  ChevronDown, ChevronUp, MessageCircle, CircleCheckBig,
  Calendar, User, Clock, Paperclip, X as XIcon,
} from 'lucide-react'
import {
  toggleTodoCompleteAction,
  startTaskAction,
  deleteTodoAction,
  archiveTodoAction,
  approveTodoAction,
  declineTodoAction,
  acknowledgeTaskAction,
  duplicateTodoAction,
  claimQueuedTaskAction,
  assignQueuedTaskToTeamMemberAction,
  claimClusterInboxTaskAction,
  assignClusterInboxTaskAction,
  assignHallInboxTaskWithSchedulerAction,
  activateHallTaskAction,
  pauseHallTaskAction,
  sendTaskToDepartmentQueueAction,
  convertTaskToMultiAssignmentAction,
  updateSingleTaskDueDateAction,
  updateAssignmentStepAction,
  extendMultiAssignmentStepAction,
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
  getUsersForAssignment,
  createTaskAttachmentUploadUrlAction,
  saveTodoAttachmentAction,
  getTodoDetails,
  addCommentAction,
} from '@/app/dashboard/tasks/actions'
import { createBrowserClient } from '@/lib/supabase/client'
import { CMS_STORAGE_BUCKET } from '@/lib/storage'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

const TaskHandoffDialog = dynamic(
  () => import('@/components/tasks/task-handoff-dialog').then((mod) => mod.TaskHandoffDialog),
  { ssr: false }
)

interface TaskCardProps {
  task: Todo
  currentUsername: string
  currentUserRole?: string
  currentUserDept?: string | null
  currentUserTeamMembers?: string[]
  currentUserTeamMemberDeptKeys?: string[]
  teamMemberTaskSummary?: Record<string, { active: number; queued: number }>
  enableQueueAssign?: boolean
  hasOtherQueuedTasks?: boolean
  onEdit: (task: Todo) => void
  onViewDetail: (task: Todo) => void
  onShare: (task: Todo) => void
  onRefresh: () => void
  compact?: boolean
}

type TaskActionDialogState =
  | { type: 'ma-submit' }
  | { type: 'complete' }
  | { type: 'creator-reopen' }
  | { type: 'approve' }
  | { type: 'decline-approval' }
  | { type: 'single-due-date' }
  | { type: 'step-edit'; assigneeUsername: string }
  | { type: 'queue-assign' }
  | { type: 'hall-assign' }
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

function getCompletionStatusText(dueIso: string, completedIso: string): string {
  if (!dueIso || !completedIso) return ''
  const ms = new Date(completedIso).getTime() - new Date(dueIso).getTime()
  const isEarly = ms < 0
  const absMs = Math.abs(ms)
  const days = Math.floor(absMs / 86_400_000)
  const hrs = Math.floor((absMs % 86_400_000) / 3_600_000)
  const mins = Math.floor((absMs % 3_600_000) / 60_000)
  
  let val = ''
  if (days > 0) val = `${days}d ${hrs}h`
  else if (hrs > 0) val = `${hrs}h ${mins}m`
  else val = `${mins}m`
  
  return `${val} ${isEarly ? 'early' : 'late'}`
}

function isOverdue(dateStr: string | null): boolean {
  return !!dateStr && new Date(dateStr).getTime() < Date.now()
}

function getAssignmentStepOwner(task: Todo, assigneeUsername: string): string | null {
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
        // Walk backward to find who originally routed to the department queue
        for (let j = i - 1; j >= 0; j -= 1) {
          const prev = task.assignment_chain[j]
          if ((prev.role || '').trim() === 'routed_to_department_queue') {
            return prev.user?.trim() || null
          }
        }
        return task.username || null
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

function getAssignmentStepNote(task: Todo, assigneeUsername: string): string {
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

function StatusDot({ status, approvalStatus, ackNeeded }: { status: string; approvalStatus?: string; ackNeeded?: boolean }) {
  if (ackNeeded) {
    const cfg = { label: 'Waiting Ack', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' }
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', cfg.cls)}>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} />
        {cfg.label}
      </span>
    )
  }
  if (approvalStatus === 'pending_approval') {
    const cfg = { label: 'In Review', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' }
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', cfg.cls)}>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0 animate-pulse', cfg.dot)} />
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

function ActBtn({ onClick, color, children, disabled }: { onClick: () => void; color: BtnColor; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors',
        BTN_CLS[color],
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {children}
    </button>
  )
}

type WorkflowRailNode = {
  key: string
  label: string
  tone: 'user' | 'department' | 'multi' | 'active'
  avatarUrl?: string | null
  title: string
  subtitle?: string
  focusTarget?: string
  children?: WorkflowRailNode[]
}

const TASK_WORKFLOW_FOCUS_KEY = 'cms-task-workflow-focus'

function buildWorkflowRailNodes(task: Todo): WorkflowRailNode[] {
  const creator = String(task.username || '').trim()
  if (!creator) return []

  const root: WorkflowRailNode = {
    key: `creator:${creator}`,
    label: creator,
    tone: 'user',
    avatarUrl: task.participant_avatars?.[creator] ?? null,
    title: `Created by ${creator}`,
    subtitle: task.task_status === 'in_progress' ? 'In Progress' : task.task_status === 'todo' ? 'Acknowledged' : task.task_status === 'backlog' ? 'Pending' : task.task_status === 'done' ? 'Completed' : 'Created here',
    focusTarget: creator,
    children: [],
  }

  const childrenByKey = new Map<string, WorkflowRailNode[]>()
  childrenByKey.set(root.key, root.children!)
  const latestKeyByUser = new Map<string, string>()
  latestKeyByUser.set(creator.toLowerCase(), root.key)
  let fallbackParentKey = root.key

  const addChild = (parentKey: string, node: WorkflowRailNode) => {
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

    let parentKey = latestKeyByUser.get(actor.toLowerCase())

    // If actor is not yet in the tree (i.e. the initial assignment creator→actor was stored in
    // task.assigned_to rather than in assignment_chain), auto-insert the actor as a bridge node
    // so that the target becomes actor's child, not creator's child.
    if (!parentKey && actor && actor.toLowerCase() !== creator.toLowerCase()) {
      const autoKey = `auto-actor:${actor}`
      const isCurrentOwner = actor.toLowerCase() === (task.assigned_to || '').toLowerCase()
      const actorNode: WorkflowRailNode = {
        key: autoKey,
        label: actor,
        tone: isCurrentOwner && task.task_status === 'in_progress' ? 'active' : 'user',
        avatarUrl: task.participant_avatars?.[actor] ?? null,
        title: `Assigned to ${actor}`,
        subtitle: isCurrentOwner
          ? (task.task_status === 'in_progress' ? 'In Progress' : task.task_status === 'todo' ? 'Acknowledged' : task.task_status === 'done' ? 'Completed' : 'Active')
          : `From ${creator}`,
        focusTarget: actor,
      }
      addChild(fallbackParentKey, actorNode)
      fallbackParentKey = autoKey
      parentKey = autoKey
    }

    parentKey = parentKey ?? fallbackParentKey
    const node: WorkflowRailNode = {
      key: `step:${index}:${target}`,
      label: target,
      tone: isDepartmentStep ? 'department' : 'user',
      avatarUrl: isDepartmentStep ? null : (task.participant_avatars?.[target] ?? null),
      title: isDepartmentStep ? `${actor} routed to ${target}` : `${actor} assigned to ${target}`,
      subtitle: isDepartmentStep ? `Sent by ${actor}` : `From ${actor}`,
      focusTarget: target,
    }
    addChild(parentKey, node)
    fallbackParentKey = node.key
  })

  if (task.assigned_to && !latestKeyByUser.has(task.assigned_to.toLowerCase())) {
    addChild(root.key, {
      key: `assignee:${task.assigned_to}`,
      label: task.assigned_to,
      tone: task.task_status === 'in_progress' ? 'active' : 'user',
      avatarUrl: task.participant_avatars?.[task.assigned_to] ?? null,
      title: `Currently assigned to ${task.assigned_to}`,
      subtitle: task.task_status === 'in_progress' ? 'In Progress' : task.task_status === 'todo' ? 'Acknowledged' : task.task_status === 'done' ? 'Completed' : 'Active',
      focusTarget: task.assigned_to,
    })
  }

  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    // Multi-pass: defer child nodes until their parent user node exists.
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
        addChild(parentKey, {
          key: `multi:${index}:${entry.username}`,
          label: entry.username,
          tone: (entry.status === 'in_progress' || entry.status === 'completed') ? 'active' : 'multi',
          avatarUrl: task.participant_avatars?.[entry.username] ?? null,
          title: `Multi-assigned to ${entry.username}`,
          subtitle: MA_LABEL[entry.status ?? 'pending'] ?? 'Pending',
          focusTarget: entry.username,
        })
      }
      remaining = nextRound
    }
    for (const { entry, index } of remaining) {
      addChild(root.key, {
        key: `multi:${index}:${entry.username}`,
        label: entry.username,
        tone: 'multi',
        avatarUrl: task.participant_avatars?.[entry.username] ?? null,
        title: `Multi-assigned to ${entry.username}`,
        subtitle: MA_LABEL[entry.status ?? 'pending'] ?? 'Pending',
        focusTarget: entry.username,
      })
    }
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

type WorkflowRailRow = {
  node: WorkflowRailNode
  depth: number
  pathHasNext: boolean[]
  isLast: boolean
}

function flattenWorkflowTree(
  nodes: WorkflowRailNode[],
  depth = 0,
  pathHasNext: boolean[] = []
): (WorkflowRailRow & { isLastSib: boolean })[] {
  const rows: (WorkflowRailRow & { isLastSib: boolean })[] = []
  nodes.forEach((node, index) => {
    const isLastSib = index === nodes.length - 1
    // pathHasNext stores whether ancestors have next siblings. 
    // We add !isLastSib to pathHasNext for our children to know if we have a next sibling.
    rows.push({ node, depth, pathHasNext: [...pathHasNext, !isLastSib], isLastSib, isLast: isLastSib })
    if (node.children?.length) {
      rows.push(...flattenWorkflowTree(node.children, depth + 1, [...pathHasNext, !isLastSib]))
    }
  })
  return rows
}

function WorkflowRail({ nodes, onNodeClick }: { nodes: WorkflowRailNode[]; onNodeClick: (node: WorkflowRailNode) => void }) {
  if (nodes.length === 0) return null
  const rows = flattenWorkflowTree(nodes).slice(0, 9)
  const INDENT = 24

  function nodeCfg(tone: WorkflowRailNode['tone'], depth: number, subtitle?: string) {
    const isOwner = subtitle?.toLowerCase().includes('owner')
    if (isOwner || tone === 'active') return {
      ring:    'border-blue-500',
      glow:    '',
      dot:     'bg-blue-500',
      name:    'text-blue-600',
      av:      'bg-blue-50 text-blue-600',
    }
    if (tone === 'department') return {
      ring:    'border-emerald-400',
      glow:    '',
      dot:     'bg-emerald-400',
      name:    'text-slate-700',
      av:      'bg-emerald-50 text-emerald-600',
    }
    if (tone === 'multi') return {
      ring:    'border-cyan-400',
      glow:    '',
      dot:     'bg-cyan-400',
      name:    'text-slate-700',
      av:      'bg-cyan-50 text-cyan-600',
    }
    if (depth === 0) return {
      ring:    'border-slate-300',
      glow:    '',
      dot:     'bg-slate-400',
      name:    'text-slate-700',
      av:      'bg-slate-100 text-slate-600',
    }
    return {
      ring:    'border-cyan-400',
      glow:    '',
      dot:     'bg-cyan-400',
      name:    'text-slate-800',
      av:      'bg-cyan-50 text-cyan-600',
    }
  }

  return (
    <div className="w-full rounded-[24px] border border-slate-200/90 bg-white px-3 py-3 shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
      <div className="h-[2px] w-full rounded-full bg-blue-500" />
      <div className="pt-3">
        {rows.map(({ node, depth, pathHasNext, isLastSib }) => {
          const cfg = nodeCfg(node.tone, depth, node.subtitle)
          const indentPx = depth * INDENT

          return (
            <div key={node.key} className="relative group/n">
              {/* 1. Ancestor vertical lines passing through */}
              {depth > 0 && pathHasNext.slice(0, -1).map((hasNext, level) => hasNext ? (
                 <div
                    key={`line-${level}`}
                    className="absolute top-0 bottom-0 w-px bg-slate-200 pointer-events-none"
                    style={{ left: `${(level * INDENT) + 31}px` }} 
                 />
              ) : null)}

              {/* 2. Parent-to-child L-shape connector */}
              {depth > 0 && (
                <>
                  {/* Vertical stem from parent */}
                  <div
                    className="absolute top-0 w-px bg-slate-200 pointer-events-none"
                    style={{ 
                      left: `${((depth - 1) * INDENT) + 31}px`,
                      bottom: isLastSib ? '24px' : '0' 
                    }}
                  />
                  {/* Horizontal branch to child */}
                  <div
                    className="absolute top-1/2 h-px bg-slate-200 pointer-events-none flex items-center justify-end"
                    style={{ 
                      left: `${((depth - 1) * INDENT) + 31}px`,
                      width: `${INDENT - 8}px`,
                    }}
                  >
                    {/* Tiny arrow head */}
                    <svg width="5" height="7" viewBox="0 0 5 7" fill="none" className="-mr-[1px]">
                      <path d="M1 1L4 3.5L1 6" stroke="#d7dee9" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </>
              )}

              {/* ── Avatar row button ── */}
              <button
                type="button"
                onClick={() => onNodeClick(node)}
                title={node.title}
                className="flex w-full items-center gap-3 rounded-[16px] px-2 py-2 text-left transition-all hover:bg-slate-50/80"
                style={{ paddingLeft: `${indentPx + 10}px` }}
              >
                {/* Avatar circle */}
                <div className={cn(
                  'relative h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 bg-white transition-transform duration-150 group-hover/n:scale-105',
                  cfg.ring, cfg.glow
                )}>
                  <UserAvatar
                    username={node.label}
                    avatarUrl={node.avatarUrl}
                    size="sm"
                    className={cn('h-full w-full', cfg.av)}
                  />
                  {/* Status dot */}
                  <span className={cn(
                    'absolute -bottom-px -right-px h-2 w-2 rounded-full border-[1.5px] border-white',
                    cfg.dot
                  )} />
                </div>

                {/* Name + subtitle */}
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-[12px] font-bold leading-tight', cfg.name)}>
                    {node.label}
                  </p>
                  {node.subtitle && (
                    <p className="truncate text-[11px] leading-tight text-slate-400">{node.subtitle}</p>
                  )}
                </div>
              </button>

              {/* Hover tooltip */}
              <div className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden w-44 -translate-y-1/2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-[0_8px_28px_rgba(15,23,42,0.12)] group-hover/n:block">
                <p className="text-[11px] font-semibold text-slate-800">{node.title}</p>
                {node.subtitle && <p className="mt-0.5 text-[10px] text-slate-500">{node.subtitle}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TaskCard({
  task,
  currentUsername,
  currentUserRole,
  currentUserDept,
  currentUserTeamMembers = [],
  currentUserTeamMemberDeptKeys = [],
  teamMemberTaskSummary = {},
  enableQueueAssign = false,
  hasOtherQueuedTasks = false,
  onEdit,
  onViewDetail,
  onRefresh,
  compact = false,
}: TaskCardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showMa, setShowMa] = useState(false)
  const [taskDialog, setTaskDialog] = useState<TaskActionDialogState>(null)
  const [showHandoffDialog, setShowHandoffDialog] = useState(false)
  const [dialogValue, setDialogValue] = useState('')
  const [dialogExtraValue, setDialogExtraValue] = useState('')
  const [hallAssignPriority, setHallAssignPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [hallAssignDays, setHallAssignDays] = useState('')
  const [hallAssignHours, setHallAssignHours] = useState('')
  const [stepEditNewAssignee, setStepEditNewAssignee] = useState('')
  const [dialogFiles, setDialogFiles] = useState<File[]>([])
  const [dialogSearch, setDialogSearch] = useState('')
  const [dialogSelectedUsers, setDialogSelectedUsers] = useState<Array<{ username: string; dueDate: string }>>([])
  const [assignableUsers, setAssignableUsers] = useState<Array<{ username: string; role: string; department: string | null }>>([])
  const [expandedAssigneeNotes, setExpandedAssigneeNotes] = useState<Set<string>>(() => new Set())
  const [showRail, setShowRail] = useState(true)
  const [actionError, setActionError] = useState('')

  const isCreator = task.username === currentUsername
  const isAssignee = task.assigned_to === currentUsername
  
  // User-specific completion logic
  const isGloballyDone = task.completed || task.task_status === 'done'
  const isMySubmission = (task.completed_by || '').toLowerCase() === currentUsername.toLowerCase()
  const isCurrentlyAssignedToMe = (task.assigned_to || '').toLowerCase() === currentUsername.toLowerCase()
  
  const isCompleted = isGloballyDone || (isMySubmission && !isCurrentlyAssignedToMe)
  
  const isPendingApproval = task.approval_status === 'pending_approval'
  const pendingApprover = task.pending_approver || task.username

  const ma = task.multi_assignment
  const maEnabled = ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0
  const maAllAccepted = maEnabled && ma.assignees.every((entry) => entry.status === 'accepted')
  const maDerivedProgress = maEnabled
    ? Math.round(((ma.assignees.filter((entry) => entry.status === 'accepted' || entry.status === 'completed').length) / ma.assignees.length) * 100)
    : 0
  const maProgress = isCompleted ? 100 : (ma?.completion_percentage ?? maDerivedProgress)
  const earliestMaDue = maEnabled
    ? ma.assignees
        .map((entry) => entry.actual_due_date)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null
    : null
  const earliestMaDueOverdue =
    !!earliestMaDue &&
    maEnabled &&
    ma.assignees.some((entry) => entry.actual_due_date === earliestMaDue && !['accepted', 'completed'].includes(entry.status || 'pending')) &&
    isOverdue(earliestMaDue)
  const myMaEntry = maEnabled ? ma.assignees.find((a) => a.username.toLowerCase() === currentUsername.toLowerCase()) : undefined
  const delegatedEntry = maEnabled
    ? ma.assignees.find((entry) => Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase()))
    : undefined
  const myDelegatedEntry = delegatedEntry?.delegated_to?.find((sub) => (sub.username || '').toLowerCase() === currentUsername.toLowerCase())

  const ackNeeded = isAssignee && task.task_status === 'backlog' && !isCompleted
  // Hall-scheduled tasks auto-start when assigned (scheduler_state = 'active'), so no Start Work button needed.
  // For user_queue state they wait for auto-start — also no manual start button.
  const hallSchedulerState = (task as unknown as Record<string, unknown>).scheduler_state as string | null
  const isHallScheduledTaskForMe = isAssignee && !!task.cluster_id && task.workflow_state === 'claimed_by_department'
  const showStartBtn = isAssignee && task.task_status === 'todo' && !isCompleted && !isHallScheduledTaskForMe
  const canCreatorControlSingleFlow = isCreator && (!maEnabled || maAllAccepted)
  
  // A user can "Complete" if they are the assignee AND it's not MA
  // OR if they are a step owner whose direct assignee has been approved.
  const stepOwner = task.assigned_to ? getAssignmentStepOwner(task, task.assigned_to) : null
  const isStepOwner = (stepOwner || '').toLowerCase() === currentUsername.toLowerCase()
  const currentAssigneeApproved = (task.approval_status === 'approved' || !task.approval_status) && !!task.completed_by
  
  // Hall queue task that is waiting — user can manually activate if queued
  const showHallActivateBtn = isHallScheduledTaskForMe && hallSchedulerState === 'user_queue' && !isCompleted
  // Hall active task — user can pause it only when they have other tasks waiting in the queue
  const showHallPauseBtn = isHallScheduledTaskForMe && hallSchedulerState === 'active' && !isCompleted && hasOtherQueuedTasks

  const showCompleteBtn = !task.completed && !isPendingApproval && (
    ((isAssignee && !maEnabled) && (task.task_status === 'in_progress' || (isHallScheduledTaskForMe && hallSchedulerState === 'active'))) || 
    (isStepOwner && currentAssigneeApproved)
  )

  const showReopenBtn = isCreator && isCompleted
  const showApproveBtn = isPendingApproval && pendingApprover.toLowerCase() === currentUsername.toLowerCase()
  const queueDeptKey = canonicalDepartmentKey(task.queue_department || '')
  const userDeptKeys = splitDepartmentsCsv(currentUserDept).map((d) => canonicalDepartmentKey(d)).filter(Boolean)
  const isLeaderRole = currentUserRole === 'Manager' || currentUserRole === 'Supervisor' || currentUserRole === 'Super Manager' || currentUserRole === 'Admin'
  // Leaders (Manager/Supervisor/Super Manager/Admin) can claim any queued task regardless of dept
  const showClaimBtn = task.queue_status === 'queued' && !task.assigned_to && !isGloballyDone &&
    (isLeaderRole || !queueDeptKey || userDeptKeys.length === 0 || userDeptKeys.includes(queueDeptKey))
  const queueAssignableTeamMembers = currentUserTeamMembers.filter((member) => member && member.toLowerCase() !== currentUsername.toLowerCase())
  const teamMemberDeptKeySet = new Set(currentUserTeamMemberDeptKeys)
  // Leaders can assign any queued task to their team (no dept restriction)
  const showQueueAssignBtn = enableQueueAssign && task.queue_status === 'queued' && !task.assigned_to && !isGloballyDone &&
    queueAssignableTeamMembers.length > 0 &&
    (isLeaderRole || (queueDeptKey !== '' && (userDeptKeys.includes(queueDeptKey) || teamMemberDeptKeySet.has(queueDeptKey))))
  // Hall Queue (cluster_inbox) actions — only for leader roles in the receiving cluster
  const isHallQueueTask = task.cluster_inbox === true && !isGloballyDone
  // Task that has already been assigned out of hall inbox into the scheduler flow
  const isHallScheduledTask = !task.cluster_inbox && !!task.cluster_id && task.workflow_state === 'claimed_by_department'
  const showHallClaimBtn = isHallQueueTask && isLeaderRole
  const showHallAssignBtn = isHallQueueTask && isLeaderRole && queueAssignableTeamMembers.length > 0

  // ANY user in the chain can "Assign/Reassign" if they are the current assignee
  // (e.g., User 2 assigned to User 3. User 3 can now assign to User 4).
  // BUT not for hall-scheduled tasks — cross-hall tasks are done by the assignee only
  const showReassignBtn = !isGloballyDone && !isPendingApproval && (isAssignee || isCreator) && !!task.assigned_to && !maEnabled && !task.cluster_id
  // Hall manager re-assignment buttons (for any hall task with cluster_id)
  const showHallMgrReassignBtn = !!task.cluster_id && !task.cluster_inbox && !isGloballyDone && isLeaderRole && !isCreator

  const singleStepOwner = !maEnabled && task.assigned_to ? getAssignmentStepOwner(task, task.assigned_to) : null
  const hasSingleStepChain = !maEnabled && !!task.assigned_to && (task.assignment_chain || []).some((entry) => (entry.next_user || '').toLowerCase() === task.assigned_to!.toLowerCase())
  const canEditSingleDueDate =
    !maEnabled &&
    !isGloballyDone &&
    !isPendingApproval &&
    !!task.assigned_to &&
    hasSingleStepChain &&
    (singleStepOwner || '').toLowerCase() === currentUsername.toLowerCase() &&
    (singleStepOwner || '').toLowerCase() !== task.assigned_to.toLowerCase()
  const showSingleDueDateBtn = canEditSingleDueDate
  const showMaStartBtn = !!myMaEntry && myMaEntry.status === 'pending' && !isCompleted
  const showMaSubmitBtn = !!myMaEntry && myMaEntry.status === 'in_progress' && !isCompleted
  const showMaDelegateBtn = !!myMaEntry && !isCompleted
  const showDelegatedStartBtn = !!myDelegatedEntry && myDelegatedEntry.status === 'pending' && !isCompleted
  const showDelegatedSubmitBtn = !!myDelegatedEntry && myDelegatedEntry.status === 'in_progress' && !isCompleted

  const hasActions = ackNeeded || showStartBtn || showClaimBtn || showQueueAssignBtn || showHallClaimBtn || showHallAssignBtn || showReassignBtn || showHallMgrReassignBtn || showSingleDueDateBtn || showCompleteBtn || showApproveBtn || showMaStartBtn || showMaSubmitBtn || showMaDelegateBtn || showDelegatedStartBtn || showDelegatedSubmitBtn || showReopenBtn || showHallActivateBtn || showHallPauseBtn

  const completionTime = isCompleted && task.completed_at && task.created_at ? formatDuration(task.created_at, task.completed_at) : null
  // unread_comment_count is computed server-side in getTodos() to avoid sending full history to client
  const unreadCount = task.unread_comment_count ?? 0
  const appNames = splitTaskMeta(task.app_name)
  const packageNames = splitTaskMeta(task.package_name)
  const playPkg = packageNames.find((value) => value !== 'Others') ?? null
  const pCfg = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.medium
  const summaryText = task.notes || taskDescriptionToPlainText(task.description)
  const workflowNodes = buildWorkflowRailNodes(task)
  const completionLabel = task.completed_at && task.due_date 
    ? `Completed ${getCompletionStatusText(task.due_date, task.completed_at)}` 
    : task.completed_at 
      ? `Completed ${fmtDate(task.completed_at)}` 
      : 'Completed'
  const currentStepOwner =
    taskDialog?.type === 'step-edit'
      ? getAssignmentStepOwner(task, taskDialog.assigneeUsername)
      : null
  const existingOwnedUsers =
    maEnabled && currentStepOwner
      ? (task.multi_assignment?.assignees || []).filter(
          (entry) => (getAssignmentStepOwner(task, entry.username) || '').toLowerCase() === currentStepOwner.toLowerCase()
        )
      : []
  const existingOwnedUsernames = new Set(existingOwnedUsers.map((entry) => entry.username.toLowerCase()))
  const filteredAssignableUsers = assignableUsers.filter((entry) => {
    const lower = entry.username.toLowerCase()
    if (lower === currentUsername.toLowerCase()) return false
    if (!dialogSearch.trim()) return true
    const haystack = `${entry.username} ${entry.department || ''} ${entry.role || ''}`.toLowerCase()
    return haystack.includes(dialogSearch.trim().toLowerCase())
  })
  const dialogVisibleUsers = filteredAssignableUsers.sort((a, b) => {
    const aExisting = existingOwnedUsernames.has(a.username.toLowerCase()) ? 0 : 1
    const bExisting = existingOwnedUsernames.has(b.username.toLowerCase()) ? 0 : 1
    if (aExisting !== bExisting) return aExisting - bExisting
    return a.username.localeCompare(b.username)
  })
  const queryClient = useQueryClient()

  const prefetchTaskDetail = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.taskDetail(task.id),
      queryFn: () => getTodoDetails(task.id),
      staleTime: 30_000,
    })
  }, [queryClient, task.id])

  const doAction = (
    fn: () => Promise<{ success: boolean; error?: string }>,
    optimisticData?: Partial<Todo>
  ) => {
    setActionError('')
    
    // Optimistic Update
    if (optimisticData) {
      const queryKey = queryKeys.tasks(currentUsername)
      const previousTasks = queryClient.getQueryData<Todo[]>(queryKey)
      
      if (previousTasks) {
        queryClient.setQueryData<Todo[]>(queryKey, (old) => {
          if (!old) return old
          return old.map(t => t.id === task.id ? { ...t, ...optimisticData } : t)
        })
      }
    }

    startTransition(async () => {
      try {
        const result = await fn()
        if (result.success) {
          onRefresh()
        } else {
          // Rollback on error handled by onRefresh or manual logic if needed
          setActionError(result.error ?? 'Action failed. Please try again.')
          onRefresh() // Ensure state is synced with server
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Unexpected action error')
        onRefresh()
      }
    })
  }

  const handleWorkflowNodeClick = (node: WorkflowRailNode) => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(TASK_WORKFLOW_FOCUS_KEY, JSON.stringify({
        taskId: task.id,
        target: node.focusTarget || node.label,
      }))
    }
    onViewDetail(task)
  }

  const openTaskDialog = (dialog: NonNullable<TaskActionDialogState>) => {
    setTaskDialog(dialog)
    setDialogValue('')
    setDialogExtraValue('')
    setDialogFiles([])
    setDialogSearch('')
    setDialogSelectedUsers([])
    setHallAssignPriority('medium')
    setHallAssignDays('')
    setHallAssignHours('')
    setStepEditNewAssignee('')
    if (dialog.type === 'step-edit') {
      void getUsersForAssignment(dialog.assigneeUsername).then((users) => {
        setAssignableUsers(users)
      })
    }
  }

  const closeTaskDialog = () => {
    setTaskDialog(null)
    setDialogValue('')
    setDialogExtraValue('')
    setDialogFiles([])
    setDialogSearch('')
    setDialogSelectedUsers([])
    setHallAssignPriority('medium')
    setHallAssignDays('')
    setHallAssignHours('')
    setStepEditNewAssignee('')
  }

  const toggleDialogSelectedUser = (username: string, checked: boolean) => {
    setDialogSelectedUsers((current) => {
      if (checked) return [...current, { username, dueDate: '' }]
      return current.filter((entry) => entry.username !== username)
    })
  }

  const submitTaskDialog = () => {
    if (!taskDialog) return

    switch (taskDialog.type) {
      case 'ma-submit': {
        const note = dialogValue.trim()
        if (!note) {
          setActionError('Please provide completion feedback.')
          return
        }
        const files = dialogFiles.slice()
        closeTaskDialog()
        startTransition(async () => {
          setActionError('')
          if (files.length) {
            const supabase = createBrowserClient()
            for (const file of files) {
              const signed = await createTaskAttachmentUploadUrlAction({ todo_id: task.id, owner_username: task.username, file_name: file.name })
              if (!signed.success || !signed.path || !signed.token) { setActionError(signed.error ?? 'File upload failed'); return }
              const upload = await supabase.storage.from(signed.bucket || CMS_STORAGE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file)
              if (upload.error) { setActionError(upload.error.message); return }
              const saved = await saveTodoAttachmentAction({ todo_id: task.id, file_name: file.name, file_size: file.size, mime_type: file.type || null, storage_path: signed.path })
              if (!saved.success) { setActionError(saved.error ?? `Failed to attach ${file.name}`); return }
            }
          }
          const result = await updateMaAssigneeStatusAction(task.id, 'completed', note)
          if (result.success) onRefresh(); else setActionError(result.error ?? 'Action failed')
        })
        return
      }
      case 'complete': {
        const note = dialogValue.trim()
        if (!note) {
          setActionError('Please provide completion feedback.')
          return
        }
        const files = dialogFiles.slice()
        closeTaskDialog()
        startTransition(async () => {
          setActionError('')
          if (files.length) {
            const supabase = createBrowserClient()
            for (const file of files) {
              const signed = await createTaskAttachmentUploadUrlAction({ todo_id: task.id, owner_username: task.username, file_name: file.name })
              if (!signed.success || !signed.path || !signed.token) { setActionError(signed.error ?? 'File upload failed'); return }
              const upload = await supabase.storage.from(signed.bucket || CMS_STORAGE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file)
              if (upload.error) { setActionError(upload.error.message); return }
              const saved = await saveTodoAttachmentAction({ todo_id: task.id, file_name: file.name, file_size: file.size, mime_type: file.type || null, storage_path: signed.path })
              if (!saved.success) { setActionError(saved.error ?? `Failed to attach ${file.name}`); return }
            }
          }
          const result = await toggleTodoCompleteAction(task.id, true, note)
          if (result.success) onRefresh(); else setActionError(result.error ?? 'Action failed')
        })
        return
      }
      case 'decline-approval':
        if (!dialogValue.trim()) {
          setActionError('Please provide a reason for declining.')
          return
        }
        doAction(() => declineTodoAction(task.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'approve':
        if (!dialogValue.trim()) {
          setActionError('Please provide approval feedback.')
          return
        }
        doAction(() => approveTodoAction(task.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'single-due-date':
        if (!dialogValue.trim()) return
        doAction(() => updateSingleTaskDueDateAction(task.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'step-edit':
        startTransition(async () => {
          // If a new assignee is selected, reassign the task to them
          if (stepEditNewAssignee.trim()) {
            const res = await reassignTaskAction(task.id, stepEditNewAssignee.trim(), dialogExtraValue.trim() || undefined)
            if (!res.success) { setActionError(res.error ?? 'Failed to reassign'); return }
            closeTaskDialog()
            onRefresh()
            return
          }
          if (!dialogValue.trim()) return
          if (dialogSelectedUsers.some((entry) => !entry.dueDate.trim())) return
          const first = await updateAssignmentStepAction(task.id, taskDialog.assigneeUsername, dialogValue.trim(), dialogExtraValue.trim() || undefined)
          if (!first.success) return
          if (dialogSelectedUsers.length > 0) {
            const second = await extendMultiAssignmentStepAction(
              task.id,
              dialogSelectedUsers.map((entry) => ({ username: entry.username, actual_due_date: entry.dueDate })),
              dialogExtraValue.trim() || undefined,
            )
            if (!second.success) return
          }
          closeTaskDialog()
          onRefresh()
        })
        return
      case 'queue-assign':
        if (!dialogValue.trim()) return
        doAction(() => assignQueuedTaskToTeamMemberAction(task.id, dialogValue.trim()))
        closeTaskDialog()
        return
      case 'hall-assign': {
        if (!dialogValue.trim()) return
        const totalEstimatedHours = (parseFloat(hallAssignDays) || 0) * 8 + (parseFloat(hallAssignHours) || 0)
        if (totalEstimatedHours <= 0) { setActionError('Please enter estimated hours required.'); return }
        doAction(() => assignHallInboxTaskWithSchedulerAction(task.id, dialogValue.trim(), hallAssignPriority, totalEstimatedHours))
        closeTaskDialog()
        return
      }
      case 'delegate':
        if (!dialogValue.trim()) return
        doAction(() => delegateMaAssigneeAction(task.id, dialogValue.trim(), dialogExtraValue.trim() || undefined))
        closeTaskDialog()
        return
      case 'creator-reopen':
        {
        const reopenReason = dialogValue.trim()
        if (!reopenReason) {
          setActionError('Reopen reason is required.')
          return
        }
        doAction(() => toggleTodoCompleteAction(task.id, false, reopenReason))
        closeTaskDialog()
        return
        }
      case 'sub-submit': {
        const note = dialogValue.trim()
        if (!note) {
          setActionError('Please provide completion feedback.')
          return
        }
        const files = dialogFiles.slice()
        const delegatorUsername = taskDialog.delegatorUsername
        closeTaskDialog()
        startTransition(async () => {
          setActionError('')
          if (files.length) {
            const supabase = createBrowserClient()
            for (const file of files) {
              const signed = await createTaskAttachmentUploadUrlAction({ todo_id: task.id, owner_username: task.username, file_name: file.name })
              if (!signed.success || !signed.path || !signed.token) { setActionError(signed.error ?? 'File upload failed'); return }
              const upload = await supabase.storage.from(signed.bucket || CMS_STORAGE_BUCKET).uploadToSignedUrl(signed.path, signed.token, file)
              if (upload.error) { setActionError(upload.error.message); return }
              const saved = await saveTodoAttachmentAction({ todo_id: task.id, file_name: file.name, file_size: file.size, mime_type: file.type || null, storage_path: signed.path })
              if (!saved.success) { setActionError(saved.error ?? `Failed to attach ${file.name}`); return }
            }
          }
          const result = await updateMaSubAssigneeStatusAction(task.id, delegatorUsername, 'completed', note)
          if (result.success) onRefresh(); else setActionError(result.error ?? 'Action failed')
        })
        return
      }
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

  const toggleAssigneeNote = (username: string) => {
    setExpandedAssigneeNotes((prev) => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username)
      else next.add(username)
      return next
    })
  }

  if (compact) {
    return (
      <div
        onMouseEnter={prefetchTaskDetail}
        className={cn(
          'overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 transition-all hover:border-blue-300 hover:shadow-sm cursor-pointer',
          isPending && 'pointer-events-none opacity-60',
          isCompleted && 'border-green-200 bg-green-50 opacity-80'
        )}
        onClick={() => onViewDetail(task)}
      >
        <div className={cn('mb-3 -mx-3.5 -mt-3.5 h-0.5 rounded-t-xl', pCfg.stripe)} />
        <div className="mb-2 flex items-start justify-between gap-2">
          <StatusDot status={isCompleted ? 'done' : task.task_status} approvalStatus={task.approval_status} ackNeeded={ackNeeded} />
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
        {isCompleted && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-green-700">
            <CircleCheckBig size={11} />
            Done
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    <div 
      onMouseEnter={prefetchTaskDetail}
      className={cn(
      'group/row relative flex overflow-hidden rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-[0_12px_28px_rgba(15,23,42,0.06)] transition-all',
      'flex-col md:flex-row',
      isPending && 'pointer-events-none opacity-60',
      isCompleted
        ? 'border-green-200 bg-green-50/40 shadow-[0_12px_28px_rgba(15,23,42,0.06)]'
        : 'hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.08)]'
    )}>
      <div className={cn('w-1.5 shrink-0 self-stretch', pCfg.stripe)} />

      <div className="flex min-w-0 flex-1 flex-col gap-0 px-3 py-4 sm:px-5 sm:py-5 md:flex-row md:gap-3">
        {workflowNodes.length > 0 && (
          <div className="hidden w-[208px] shrink-0 self-start md:block">
            <button
              type="button"
              onClick={() => setShowRail((v) => !v)}
              className="mb-3 flex w-full items-center justify-between rounded-full border border-slate-200 bg-white px-4 py-2 text-left shadow-[0_2px_10px_rgba(15,23,42,0.04)] transition-all hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-slate-400 opacity-80">
                  <svg width="6" height="12" viewBox="0 0 6 12" fill="none">
                    <circle cx="3" cy="2" r="1.25" fill="currentColor"/>
                    <line x1="3" y1="4" x2="3" y2="8" stroke="currentColor" strokeWidth="1" strokeOpacity="0.45"/>
                    <circle cx="3" cy="10" r="1.25" fill="currentColor"/>
                  </svg>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Queue Task Chain</span>
              </div>
              {showRail
                ? <ChevronUp size={13} className="text-slate-400" />
                : <ChevronDown size={13} className="text-slate-400" />}
            </button>
            {showRail && <WorkflowRail nodes={workflowNodes} onNodeClick={handleWorkflowNodeClick} />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* Row 1: App names + KPI type + Task title */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {appNames.map((appName, idx) => {
              const pkg = packageNames[idx] || packageNames[0]
              const isPlay = pkg && pkg !== 'Others'
              return isPlay ? (
                <a
                  key={appName}
                  href={`https://play.google.com/store/apps/details?id=${pkg}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-300 hover:text-blue-600"
                >
                  <ExternalLink size={10} className="opacity-60" />
                  {appName}
                </a>
              ) : (
                <span key={appName} className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">
                  {appName}
                </span>
              )
            })}
            {task.kpi_type && (
              <span className="rounded-full border border-violet-100 bg-violet-50/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-400">
                {task.kpi_type}
              </span>
            )}
            <button
              onClick={() => onViewDetail(task)}
              className={cn(
                'text-left text-base sm:text-[20px] font-bold leading-tight tracking-[-0.02em]',
                isCompleted ? 'line-through text-slate-400' : 'text-slate-800 hover:text-blue-600'
              )}
            >
              {task.title}
            </button>
          </div>

          {/* Row 2: Status dot + Priority badge only */}
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusDot status={isCompleted ? 'done' : task.task_status} approvalStatus={task.approval_status} ackNeeded={ackNeeded} />
            <Badge label={pCfg.longLabel} cls={pCfg.cls} />
          </div>

          {summaryText && (
            <p className="mt-2.5 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-500">
              {summaryText}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {task.approval_status === 'pending_approval' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600">
                Waiting for {pendingApprover}
              </span>
            )}
          </div>

          {hasActions && (
            <div className="mt-4 flex flex-wrap gap-2">
              {ackNeeded && <ActBtn onClick={() => doAction(() => acknowledgeTaskAction(task.id), { task_status: 'todo' })} color="amber" disabled={isPending}>Acknowledge</ActBtn>}
              {showStartBtn && <ActBtn onClick={() => doAction(() => startTaskAction(task.id), { task_status: 'in_progress' })} color="blue" disabled={isPending}>Start Work</ActBtn>}
              {showHallActivateBtn && <ActBtn onClick={() => doAction(() => activateHallTaskAction(task.id), { task_status: 'in_progress', scheduler_state: 'active' })} color="blue" disabled={isPending}>Start Task</ActBtn>}
              {showHallPauseBtn && <ActBtn onClick={() => doAction(() => pauseHallTaskAction(task.id), { scheduler_state: 'paused' })} color="amber" disabled={isPending}>Pause</ActBtn>}
              {showClaimBtn && <ActBtn onClick={() => doAction(() => claimQueuedTaskAction(task.id), { assigned_to: currentUsername, queue_status: 'claimed', task_status: 'todo' })} color="violet" disabled={isPending}>Pick Task</ActBtn>}
              {showHallClaimBtn && <ActBtn onClick={() => doAction(() => claimClusterInboxTaskAction(task.id), { assigned_to: currentUsername, cluster_inbox: false, queue_status: 'claimed', task_status: 'todo' })} color="violet" disabled={isPending}>Pick Task</ActBtn>}
              {showHallAssignBtn && (
                <ActBtn onClick={() => router.push(`/dashboard/tasks/hall-assign/${task.id}`)} color="indigo" disabled={isPending}>Assign to Team</ActBtn>
              )}
              {showReassignBtn && (
                <ActBtn
                  onClick={() => {
                    setShowHandoffDialog(true)
                  }}
                  color="indigo"
                  disabled={isPending}
                >
                  Assign To Next
                </ActBtn>
              )}
              {showHallMgrReassignBtn && (
                <ActBtn
                  onClick={() => router.push(`/dashboard/tasks/hall-assign/${task.id}`)}
                  color="indigo"
                  disabled={isPending}
                >
                  Assign to Team Member
                </ActBtn>
              )}
              {showHallMgrReassignBtn && (
                <ActBtn
                  onClick={() => router.push(`/dashboard/tasks/route-cluster/${task.id}`)}
                  color="violet"
                  disabled={isPending}
                >
                  Assign to Other Department
                </ActBtn>
              )}
              {showSingleDueDateBtn && (
                <ActBtn
                  onClick={() => router.push(`/dashboard/tasks/edit-assignee/${task.id}`)}
                  color="teal"
                  disabled={isPending}
                >
                  Edit Assignee
                </ActBtn>
              )}
              {showQueueAssignBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'queue-assign' })
                  }}
                  color="indigo"
                  disabled={isPending}
                >
                  Assign to Team
                </ActBtn>
              )}
              {showMaStartBtn && <ActBtn onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'in_progress'))} color="indigo" disabled={isPending}>MA: Start</ActBtn>}
              {showMaSubmitBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'ma-submit' })
                  }}
                  color="teal"
                  disabled={isPending}
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
                  disabled={isPending}
                >
                  Delegate
                </ActBtn>
              )}
              {showDelegatedStartBtn && <ActBtn onClick={() => doAction(() => updateMaSubAssigneeStatusAction(task.id, delegatedEntry!.username, 'in_progress'))} color="indigo" disabled={isPending}>Sub: Start</ActBtn>}
              {showDelegatedSubmitBtn && (
                <ActBtn
                  onClick={() => {
                    openTaskDialog({ type: 'sub-submit', delegatorUsername: delegatedEntry!.username })
                  }}
                  color="teal"
                  disabled={isPending}
                >
                  Sub: Submit
                </ActBtn>
              )}
              {showCompleteBtn && (
                <ActBtn
                  onClick={() => {
                    if (isCreator) {
                      openTaskDialog({ type: 'complete' })
                      return
                    }
                    openTaskDialog({ type: 'complete' })
                  }}
                  color="green"
                  disabled={isPending}
                >
                  Complete
                </ActBtn>
              )}
              {showReopenBtn && (
                <ActBtn
                  onClick={() => setShowCreatorReopenConfirm(true)}
                  color="blue"
                  disabled={isPending}
                >
                  Reopen Task
                </ActBtn>
              )}
              {showApproveBtn && (
                <>
                  <ActBtn onClick={() => openTaskDialog({ type: 'approve' })} color="green" disabled={isPending}>Approve</ActBtn>
                  <ActBtn onClick={() => openTaskDialog({ type: 'decline-approval' })} color="red" disabled={isPending}>Decline</ActBtn>
                </>
              )}
            </div>
          )}

          {actionError && (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
              {actionError}
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
                    <span className={cn('text-xs font-semibold uppercase tracking-[0.14em]', isCompleted ? 'text-green-700' : 'text-slate-400')}>Multi Assignment</span>
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
                    const assigneeStepOwner = (getAssignmentStepOwner(task, assignee.username) || '').toLowerCase()
                    const assigneeNote = getAssignmentStepNote(task, assignee.username)
                    const noteExpanded = expandedAssigneeNotes.has(assignee.username)
                    const canReviewAssignee = assigneeStepOwner === currentUsername.toLowerCase() || isCreator
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
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border', MA_STATUS[status] ?? MA_STATUS.pending)}>
                              {MA_LABEL[status] ?? status}
                            </span>
                            {assigneeDueDate && (
                              <span className={cn('text-[11px] font-medium', assigneeOverdue ? 'text-red-500' : 'text-slate-400')}>
                                Due {fmtShort(assigneeDueDate)}
                              </span>
                            )}
                          </div>
                          {/* Individual progress bar */}
                          <div className="mt-2">
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  status === 'accepted' || status === 'completed' ? 'bg-emerald-500' :
                                  status === 'in_progress' ? 'bg-[linear-gradient(90deg,#38bdf8,#2563eb)]' :
                                  'bg-slate-300'
                                )}
                                style={{
                                  width: status === 'accepted' ? '100%' :
                                         status === 'completed' ? '75%' :
                                         status === 'in_progress' ? '40%' : '0%'
                                }}
                              />
                            </div>
                            <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                              {status === 'accepted' ? '100% done' :
                               status === 'completed' ? 'Submitted' :
                               status === 'in_progress' ? 'In progress' : 'Not started'}
                            </p>
                          </div>
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

          <div className={cn('mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]', isCompleted ? 'text-slate-500' : 'text-slate-400')}>
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
            {task.due_date && (
              <span className={cn('flex items-center gap-1', isOverdue(task.due_date) && !isCompleted ? 'font-semibold text-red-500' : '')}>
                <Calendar size={10} className="shrink-0" />
                Expected: {fmtShort(task.due_date)}
              </span>
            )}
          </div>
        </div>

        <div className={cn(
          'hidden md:flex shrink-0 flex-row items-stretch justify-between rounded-[16px] border p-3 sm:p-4 md:min-w-[198px] md:flex-col md:items-stretch md:justify-between',
          isCompleted ? 'border-green-200 bg-green-50/80' : 'border-slate-200 bg-slate-50/80'
        )}>
          {!maEnabled && (
            <div className="text-left md:text-right">
              <div className={cn('text-[10px] font-bold uppercase tracking-[0.18em]', isCompleted ? 'text-green-700' : 'text-slate-400')}>
                {isCompleted ? 'Finished' : 'Expected'}
              </div>
              {(() => {
                // For hall-scheduled tasks, prefer effective_due_at (computed within office hours)
                const displayDate = (task.scheduler_state && task.effective_due_at) ? task.effective_due_at : task.due_date
                return (
                  <>
                    <div className={cn('mt-1 text-base font-bold', isOverdue(task.due_date) && !isCompleted ? 'text-[#e6555f]' : isCompleted ? 'text-green-700' : 'text-slate-700')}>
                      {displayDate ? fmtShort(displayDate) : 'No date'}
                    </div>
                    {displayDate && (
                      <div className={cn('mt-1 text-xs font-semibold', isOverdue(task.due_date) && !isCompleted ? 'text-[#e6555f]' : isCompleted ? 'text-green-700' : 'text-slate-400')}>
                        {isCompleted && task.completed_at ? (
                          getCompletionStatusText(task.due_date, task.completed_at)
                        ) : (
                          fmtTime(displayDate)
                        )}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          <div className="flex flex-col items-end gap-2 md:mt-5">
            {task.queue_status === 'queued' && (
              <Badge label={`Queued${task.queue_department ? ` · ${task.queue_department}` : ''}`} cls="bg-sky-50 text-sky-700 border-sky-200" />
            )}
            {maEnabled && (
              <Badge label={`${maProgress}% · ${ma.assignees.length} Assignees`} cls="bg-cyan-50 text-cyan-700 border-cyan-200" />
            )}
            {isPendingApproval && (
              <Badge label="Pending Approval" cls="bg-indigo-50 text-indigo-700 border-indigo-200" />
            )}
            {task.approval_status === 'declined' && (
              <Badge label="Declined" cls="bg-red-50 text-red-600 border-red-200" />
            )}
            {completionTime && (
              <Badge label={`Time ${completionTime}`} cls="bg-emerald-50 text-emerald-700 border-emerald-200" />
            )}
            {isCompleted && (
              <Badge label={completionLabel} cls="bg-green-50 text-green-700 border-green-200" />
            )}
            {showClaimBtn && (
              <button
                onClick={() => doAction(() => acknowledgeTaskAction(task.id), { task_status: 'todo' })}
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
            {showReopenBtn && (
              <button
                onClick={() => {
                  openTaskDialog({ type: 'creator-reopen' })
                }}
                className="inline-flex items-center justify-center gap-1 rounded-full bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Reopen Task
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 px-3 py-2 sm:px-4 sm:py-3 opacity-95 transition-opacity group-hover/row:opacity-100 md:border-l md:border-t-0 md:bg-slate-50/50 md:px-2 md:py-3 md:flex-col md:justify-center">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
              <span className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              {unreadCount} new
            </span>
          )}
          {unreadCount === 0 && (
            <span className="flex items-center gap-0.5 px-1 text-[10px] text-slate-400">
              <MessageCircle size={10} />
            </span>
          )}
          <button onClick={() => onViewDetail(task)} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600" title="View">
            <Eye size={14} />
          </button>
          {isCreator && (
            <button onClick={() => onEdit(task)} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800" title="Edit">
              <Edit3 size={13} />
            </button>
          )}
          <button onClick={() => doAction(() => duplicateTodoAction(task.id))} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800" title="Duplicate">
            <Copy size={13} />
          </button>
          {isCreator && !isCompleted && (
            <button onClick={() => doAction(() => deleteTodoAction(task.id))} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600" title="Delete">
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
            taskDialog.type === 'complete' ? 'Submit completion feedback' :
            taskDialog.type === 'creator-reopen' ? 'Reopen task' :
            taskDialog.type === 'decline-approval' ? 'Decline completion request' :
            taskDialog.type === 'approve' ? 'Approve completion request' :
            taskDialog.type === 'single-due-date' ? 'Set assignee due date' :
          taskDialog.type === 'step-edit' ? `Edit ${taskDialog.assigneeUsername}'s step` :
            taskDialog.type === 'queue-assign' ? 'Assign queued task' :
            taskDialog.type === 'hall-assign' ? 'Assign Hall Queue task' :
          taskDialog.type === 'delegate' ? 'Delegate task work' :
          taskDialog.type === 'remove-delegation' ? 'Remove delegation' :
          taskDialog.type === 'reopen-assignee' ? 'Reopen accepted work' :
          taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Send feedback' :
          'Add summary'
        }
          description={
            taskDialog.type === 'complete' ? 'Add a short summary before submitting this task as completed.' :
            taskDialog.type === 'creator-reopen' ? 'Explain why this task is being reopened. It will go back only to the last submitter.' :
            taskDialog.type === 'decline-approval' ? 'Explain why this completion is declined so assignee can fix it.' :
          taskDialog.type === 'approve' ? 'Add a brief note about the approved work.' :
          taskDialog.type === 'single-due-date' ? 'Set the working due date for this single-assignee task.' :
          taskDialog.type === 'step-edit' ? 'Update only this child assignee step. This will not change other users.' :
            taskDialog.type === 'queue-assign' ? 'Assign this department-queue task directly to one of your team members.' :
            taskDialog.type === 'hall-assign' ? 'Assign this Hall Queue task directly to one of your team members.' :
          taskDialog.type === 'delegate' ? 'Assign this work to another username with optional instructions.' :
          taskDialog.type === 'remove-delegation' ? 'This removes the delegated user from the task workflow.' :
          taskDialog.type === 'reopen-assignee' ? 'Explain why this accepted work should be reopened.' :
          taskDialog.type === 'reject-assignee' || taskDialog.type === 'reject-sub' ? 'Give clear feedback so the work can be corrected.' :
          'Add an optional summary for this submission.'
        }
        primaryLabel={taskDialog.type === 'remove-delegation' ? 'Remove delegation' : taskDialog.type === 'queue-assign' || taskDialog.type === 'hall-assign' ? 'Assign task' : taskDialog.type === 'complete' ? 'Submit completion' : taskDialog.type === 'creator-reopen' ? 'Reopen task' : taskDialog.type === 'decline-approval' ? 'Decline request' : taskDialog.type === 'approve' ? 'Approve & Pass' : taskDialog.type === 'single-due-date' ? 'Save changes' : taskDialog.type === 'step-edit' ? (stepEditNewAssignee.trim() ? 'Reassign task' : 'Save changes') : 'Confirm'}
        onClose={closeTaskDialog}
        onConfirm={submitTaskDialog}
        error={actionError}
      >
        {taskDialog.type === 'complete' ? (
          <div className="space-y-3">
            <DialogTextarea label="Completion Feedback" value={dialogValue} onChange={setDialogValue} placeholder="What work was completed? Add summary or handoff notes." />
            <CompletionFileInput files={dialogFiles} onChange={setDialogFiles} />
          </div>
        ) : taskDialog.type === 'creator-reopen' ? (
          <DialogTextarea
            label="Reopen Reason"
            value={dialogValue}
            onChange={setDialogValue}
            placeholder="Explain what needs to be corrected before this task can be accepted again."
          />
        ) : taskDialog.type === 'decline-approval' ? (
          <DialogTextarea label="Decline Reason" value={dialogValue} onChange={setDialogValue} placeholder="Tell assignee what to fix before re-submitting." />
        ) : taskDialog.type === 'single-due-date' ? (
          <DialogInput label="Assignee Due Date" value={dialogValue} onChange={setDialogValue} type="datetime-local" min={pakistanOfficeMinInputValue()} />
        ) : taskDialog.type === 'step-edit' ? (
          <div className="space-y-3">
            <DialogInput label="Assignee Due Date" value={dialogValue} onChange={setDialogValue} type="datetime-local" min={pakistanOfficeMinInputValue()} />
            <DialogTextarea label="Step Detail / Note" value={dialogExtraValue} onChange={setDialogExtraValue} placeholder="Add or update instructions for this assignee only" />
            {/* Reassign to a different user */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Reassign to different user <span className="normal-case font-normal text-slate-400">(optional)</span></p>
              {assignableUsers.length > 0 ? (
                <>
                  <input
                    value={stepEditNewAssignee}
                    onChange={(e) => setStepEditNewAssignee(e.target.value)}
                    placeholder="Search users..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 mb-2"
                  />
                  <div className="max-h-44 overflow-y-auto space-y-1 rounded-lg">
                    {assignableUsers
                      .filter((u) => {
                        const currentAssignee = (taskDialog as {type:'step-edit';assigneeUsername:string}).assigneeUsername
                        return u.username.toLowerCase() !== currentAssignee.toLowerCase() &&
                          (!stepEditNewAssignee.trim() || u.username.toLowerCase().includes(stepEditNewAssignee.toLowerCase()))
                      })
                      .map((u) => {
                        const summary = teamMemberTaskSummary[u.username]
                        const active = summary?.active ?? 0
                        const queued = summary?.queued ?? 0
                        const isSelected = stepEditNewAssignee === u.username
                        return (
                          <button key={u.username} type="button"
                            onClick={() => setStepEditNewAssignee(isSelected ? '' : u.username)}
                            className={cn(
                              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all',
                              isSelected ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                            )}>
                            <div className={cn('w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white')}
                              style={{ background: isSelected ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}>
                              {u.username.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-sm font-medium truncate', isSelected ? 'text-violet-700' : 'text-slate-700')}>{u.username}</p>
                              {u.department && <p className="text-[11px] text-slate-400 truncate">{u.department}</p>}
                            </div>
                            {active > 0 ? (
                              <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Already assigned ({active})</span>
                            ) : (
                              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex-shrink-0">free</span>
                            )}
                            {queued > 0 && <span className="text-[11px] text-slate-400 flex-shrink-0">{queued}q</span>}
                          </button>
                        )
                      })}
                  </div>
                  {stepEditNewAssignee.trim() && (
                    <p className="text-xs text-amber-600 mt-2">⚠ Saving will reassign this task to <strong>{stepEditNewAssignee}</strong></p>
                  )}
                </>
              ) : (
                <input
                  value={stepEditNewAssignee}
                  onChange={(e) => setStepEditNewAssignee(e.target.value)}
                  placeholder="Type username to reassign..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              )}
            </div>
            {maEnabled && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-700">Add more users</div>
                <div className="mb-3 text-xs text-slate-500">If you forgot someone, add them under your step from here.</div>
                <input
                  value={dialogSearch}
                  onChange={(e) => setDialogSearch(e.target.value)}
                  placeholder="Search users..."
                  className="mb-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
                  {dialogVisibleUsers.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-slate-400">No more users to add.</div>
                  ) : (
                    dialogVisibleUsers.map((user) => {
                      const lower = user.username.toLowerCase()
                      const selected = dialogSelectedUsers.some((entry) => entry.username === user.username)
                      const alreadyAdded = existingOwnedUsernames.has(lower)
                      return (
                        <label key={user.username} className={cn(
                          'flex items-center gap-3 rounded-xl px-3 py-3',
                          alreadyAdded ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                        )}>
                          <input
                            type="checkbox"
                            checked={alreadyAdded || selected}
                            disabled={alreadyAdded}
                            onChange={(e) => toggleDialogSelectedUser(user.username, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-700">{user.username}</span>
                            <span className="block truncate text-[11px] text-slate-400">
                              {user.department || 'No department'}{user.role ? ` · ${user.role}` : ''}
                            </span>
                          </span>
                          {alreadyAdded && (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                              Added
                            </span>
                          )}
                        </label>
                      )
                    })
                  )}
                </div>
                {dialogSelectedUsers.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {dialogSelectedUsers.map((entry) => (
                      <div key={entry.username} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{entry.username}</div>
                        <DialogInput
                          label="Due Date"
                          value={entry.dueDate}
                          onChange={(value) => setDialogSelectedUsers((current) => current.map((item) => item.username === entry.username ? { ...item, dueDate: value } : item))}
                          type="datetime-local"
                          min={pakistanOfficeMinInputValue()}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : taskDialog.type === 'queue-assign' ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Select a team member</p>
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
              {queueAssignableTeamMembers.map((member) => {
                const initials = member.slice(0, 2).toUpperCase()
                const isSelected = dialogValue === member
                return (
                  <button
                    key={member}
                    type="button"
                    onClick={() => setDialogValue(member)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all',
                      isSelected
                        ? 'border-violet-400 bg-violet-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                    )}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: isSelected ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}
                    >
                      {initials}
                    </div>
                    <span className={cn('text-sm font-medium flex-1', isSelected ? 'text-violet-700' : 'text-slate-700')}>{member}</span>
                    {isSelected && (
                      <svg className="w-4 h-4 text-violet-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ) : taskDialog.type === 'hall-assign' ? (
          <div className="space-y-4">
            {/* Team member picker */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Select a team member</p>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
              {queueAssignableTeamMembers.map((member) => {
                const initials = member.slice(0, 2).toUpperCase()
                const isSelected = dialogValue === member
                return (
                  <button
                    key={member}
                    type="button"
                    onClick={() => setDialogValue(member)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all',
                      isSelected
                        ? 'border-violet-400 bg-violet-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                    )}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: isSelected ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}
                    >
                      {initials}
                    </div>
                    <span className={cn('text-sm font-medium flex-1', isSelected ? 'text-violet-700' : 'text-slate-700')}>{member}</span>
                    {isSelected && (
                      <svg className="w-4 h-4 text-violet-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                    )}
                  </button>
                )
              })}
              </div>
            </div>
            {/* Selected user task summary */}
            {dialogValue && (() => {
              const summary = teamMemberTaskSummary[dialogValue]
              if (!summary && !teamMemberTaskSummary[dialogValue]) return null
              const active = summary?.active ?? 0
              const queued = summary?.queued ?? 0
              return (
                <div className={cn('flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-sm',
                  active > 0 ? 'border-orange-200 bg-orange-50' : 'border-emerald-200 bg-emerald-50')}>
                  <div className={cn('w-2 h-2 rounded-full flex-shrink-0', active > 0 ? 'bg-orange-400' : 'bg-emerald-400')} />
                  <span className={cn('font-medium', active > 0 ? 'text-orange-700' : 'text-emerald-700')}>
                    {active > 0
                      ? `${dialogValue} has ${active} active task${active > 1 ? 's' : ''}`
                      : `${dialogValue} has no active task — will start immediately`}
                  </span>
                  {queued > 0 && <span className="ml-auto text-xs text-slate-500">{queued} queued</span>}
                </div>
              )
            })()}
            {/* Priority */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Priority</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => {
                  const colors: Record<string, string> = { low: 'border-slate-300 text-slate-600 bg-slate-50', medium: 'border-blue-300 text-blue-700 bg-blue-50', high: 'border-orange-300 text-orange-700 bg-orange-50', urgent: 'border-red-400 text-red-700 bg-red-50' }
                  const selectedColors: Record<string, string> = { low: 'border-slate-500 bg-slate-200 text-slate-900', medium: 'border-blue-500 bg-blue-200 text-blue-900', high: 'border-orange-500 bg-orange-200 text-orange-900', urgent: 'border-red-600 bg-red-200 text-red-900' }
                  const isP = hallAssignPriority === p
                  return (
                    <button key={p} type="button" onClick={() => setHallAssignPriority(p)}
                      className={cn('px-2 py-1.5 rounded-lg border text-xs font-semibold capitalize transition-all', isP ? selectedColors[p] : colors[p])}>
                      {p}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* Estimated work time */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Estimated Work Time <span className="text-slate-300">(1 day = 8 hrs office time)</span></p>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <input type="number" min="0" step="1" placeholder="0"
                    value={hallAssignDays} onChange={(e) => setHallAssignDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 text-slate-800" />
                  <p className="text-[11px] text-slate-400 mt-0.5 text-center">Days</p>
                </div>
                <span className="text-slate-400 font-bold pb-4">+</span>
                <div className="flex-1">
                  <input type="number" min="0" max="23" step="0.5" placeholder="0"
                    value={hallAssignHours} onChange={(e) => setHallAssignHours(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 text-slate-800" />
                  <p className="text-[11px] text-slate-400 mt-0.5 text-center">Hours</p>
                </div>
              </div>
              {(parseFloat(hallAssignDays) > 0 || parseFloat(hallAssignHours) > 0) && (
                <p className="text-xs text-violet-600 mt-1.5 font-medium">
                  ≈ {((parseFloat(hallAssignDays) || 0) * 8 + (parseFloat(hallAssignHours) || 0)).toFixed(1)} office hours total
                </p>
              )}
            </div>
          </div>
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
            <DialogInput label="New Due Date" value={dialogExtraValue} onChange={setDialogExtraValue} type="datetime-local" min={pakistanOfficeMinInputValue()} />
          </div>
        ) : (
          <div className="space-y-3">
            <DialogTextarea
              label={
                taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit' ? 'Summary' :
                taskDialog.type === 'approve' ? 'Approval Note' :
                'Feedback'
              }
              value={dialogValue}
              onChange={setDialogValue}
              placeholder={
                taskDialog.type === 'ma-submit' || taskDialog.type === 'sub-submit' ? 'What work was completed?' :
                taskDialog.type === 'approve' ? 'Good job, moving to next step...' :
                'Type feedback here'
              }
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
        currentAssignee={task.assigned_to}
        onClose={() => setShowHandoffDialog(false)}
        onAssignDepartment={(department, dueDate, note) => {
          setShowHandoffDialog(false)
          doAction(() => sendTaskToDepartmentQueueAction(task.id, department, dueDate, note))
        }}
        onAssignMulti={(assignees, note) => {
          setShowHandoffDialog(false)
          doAction(() => convertTaskToMultiAssignmentAction(task.id, assignees, note))
        }}
      />
    )}
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
  error,
}: {
  title: string
  description: string
  primaryLabel: string
  onClose: () => void
  onConfirm: () => void
  children: ReactNode
  error?: string
}) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
      <div className="my-auto w-full max-w-lg rounded-[28px] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <div className="p-6 pb-0">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600">
                {error}
              </div>
            )}
            {children}
          </div>
        </div>
        <div className="flex justify-end gap-2 rounded-b-[28px] border-t border-slate-100 bg-white px-6 py-4">
          <button onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onConfirm} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
                <XIcon size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
