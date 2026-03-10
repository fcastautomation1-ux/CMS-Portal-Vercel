import { cn } from '@/lib/cn'
import type { TaskStatus, TaskPriority, ApprovalStatus } from '@/types'

// ── Priority Badge ─────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<TaskPriority, { bg: string; text: string; dot: string; label: string }> = {
  urgent: { bg: 'bg-red-50',    text: 'text-red-700',   dot: 'bg-red-500',   label: 'Urgent' },
  high:   { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', label: 'High' },
  medium: { bg: 'bg-blue-50',   text: 'text-blue-600',  dot: 'bg-blue-500',  label: 'Medium' },
  low:    { bg: 'bg-slate-50',  text: 'text-slate-500', dot: 'bg-slate-400', label: 'Low' },
}

export function PriorityBadge({ priority }: { priority: TaskPriority | string }) {
  const s = PRIORITY_STYLES[priority as TaskPriority] || PRIORITY_STYLES.medium
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold', s.bg, s.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', s.dot)} />
      {s.label}
    </span>
  )
}

// ── Task Status Badge ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  backlog:     { bg: 'bg-slate-50',  text: 'text-slate-600', border: 'border-slate-200', label: 'Backlog' },
  todo:        { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', label: 'To Do' },
  in_progress: { bg: 'bg-blue-50',  text: 'text-blue-700',  border: 'border-blue-200',  label: 'In Progress' },
  done:        { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'Done' },
}

export function TaskStatusBadge({ status }: { status: TaskStatus | string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.todo
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border', s.bg, s.text, s.border)}>
      {s.label}
    </span>
  )
}

// ── Approval Status Badge ──────────────────────────────────────────────────────

const APPROVAL_STYLES: Record<ApprovalStatus, { bg: string; text: string; label: string }> = {
  approved:        { bg: 'bg-green-50',  text: 'text-green-700',  label: 'Approved' },
  pending_approval:{ bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Pending Approval' },
  declined:        { bg: 'bg-red-50',    text: 'text-red-700',    label: 'Declined' },
}

export function ApprovalBadge({ status }: { status: ApprovalStatus | string }) {
  const s = APPROVAL_STYLES[status as ApprovalStatus] || APPROVAL_STYLES.approved
  if (status === 'approved') return null // Don't show default approved state
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold', s.bg, s.text)}>
      {s.label}
    </span>
  )
}

// ── Avatar chip ───────────────────────────────────────────────────────────────

export function UserAvatar({ username, size = 'sm' }: { username: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'w-9 h-9 text-sm' : size === 'md' ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-xs'
  const initial = (username || '?').charAt(0).toUpperCase()
  // Generate consistent color from username
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500']
  const colorIdx = username.charCodeAt(0) % colors.length
  return (
    <div
      className={cn('rounded-full flex items-center justify-center text-white font-bold shrink-0', sizeClass, colors[colorIdx])}
      title={username}
    >
      {initial}
    </div>
  )
}

// ── Due date display ──────────────────────────────────────────────────────────

export function DueDateChip({ dateStr, completed }: { dateStr: string | null; completed: boolean }) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  const isOverdue = !completed && d.getTime() < now.getTime()
  const isToday = d.toDateString() === now.toDateString()
  const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString()

  let label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  let className = 'bg-slate-50 text-slate-500'

  if (completed) {
    className = 'bg-green-50 text-green-600'
  } else if (isOverdue) {
    label = `⚠ ${label}`
    className = 'bg-red-50 text-red-600 font-semibold'
  } else if (isToday) {
    label = `Today`
    className = 'bg-amber-50 text-amber-700 font-semibold'
  } else if (isTomorrow) {
    label = `Tomorrow`
    className = 'bg-blue-50 text-blue-600'
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs', className)}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14 2h-1V0h-2v2H5V0H3v2H2C.9 2 0 2.9 0 4v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H2V6h12v8z"/>
      </svg>
      {label}
    </span>
  )
}
