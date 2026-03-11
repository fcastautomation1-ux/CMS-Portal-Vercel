'use client'

import { useState, useTransition } from 'react'
import type { Todo, HistoryEntry } from '@/types'
import {
  PriorityBadge,
  TaskStatusBadge,
  ApprovalBadge,
  UserAvatar,
  DueDateChip,
} from './task-badges'
import { cn } from '@/lib/cn'
import { MoreVertical, Edit3, Trash2, Archive, Share2, Eye, Copy, ExternalLink } from 'lucide-react'
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

const CATEGORY_ICONS: Record<string, string> = {
  technical: '⚙️',
  user_acquisition: '👤',
  creative: '🎨',
  monetization: '💰',
  marketing: '📢',
  analytics: '📊',
  operations: '🔧',
}

function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  const days = Math.floor(ms / 86_400_000)
  const hrs = Math.floor((ms % 86_400_000) / 3_600_000)
  if (days > 0) return `${days}d ${hrs}h`
  if (hrs > 0) return `${hrs}h`
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  return `${mins}m`
}

export function TaskCard({
  task,
  currentUsername,
  currentUserDept,
  onEdit,
  onViewDetail,
  onShare,
  onDecline,
  onRefresh,
  compact = false,
}: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isCreator = task.username === currentUsername
  const isAssignee = task.assigned_to === currentUsername
  const isPendingApproval = task.approval_status === 'pending_approval'
  const isCompleted = task.completed

  // Multi-assignment data
  const ma = task.multi_assignment
  const maEnabled = ma?.enabled && Array.isArray(ma.assignees)
  const myMaEntry = maEnabled ? ma!.assignees.find(
    (a) => (a.username || '').toLowerCase() === currentUsername.toLowerCase()
  ) : undefined

  // Button visibility
  const showAcknowledgeBtn = isAssignee && task.task_status === 'backlog' && !isCompleted
  const showStartBtn = isAssignee && task.task_status === 'todo' && !isCompleted
  const showCompleteBtn =
    !isCompleted && !isPendingApproval && (isAssignee || isCreator) && task.task_status === 'in_progress'
  const showApproveDeclineBtn = isCreator && isPendingApproval
  const showClaimBtn =
    task.queue_status === 'queued' &&
    !task.assigned_to &&
    !isCompleted &&
    (!task.queue_department ||
      !currentUserDept ||
      (task.queue_department || '').toLowerCase() === (currentUserDept || '').toLowerCase())
  const showMaStartBtn = !!myMaEntry && myMaEntry.status === 'pending' && !isCompleted
  const showMaSubmitBtn = !!myMaEntry && myMaEntry.status === 'in_progress' && !isCompleted

  // Completion time display
  const completionTime =
    isCompleted && task.completed_at && task.created_at
      ? formatDuration(task.created_at, task.completed_at)
      : null

  // Last comment count
  const comments = task.history.filter((h: HistoryEntry) => h.type === 'comment')
  const unreadComments = comments.filter(
    (h: HistoryEntry) => Array.isArray(h.unread_by) && h.unread_by.includes(currentUsername)
  )

  const doAction = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    startTransition(async () => {
      const res = await fn()
      if (res.success) onRefresh()
    })
  }

  const playStoreUrl =
    task.package_name && task.package_name !== 'Others'
      ? `https://play.google.com/store/apps/details?id=${task.package_name}`
      : null

  return (
    <div
      className={cn(
        'group relative rounded-xl border transition-all duration-150',
        isPending && 'opacity-60 pointer-events-none',
        isCompleted ? 'opacity-75' : 'hover:shadow-md',
        compact ? 'p-3' : 'p-4'
      )}
      style={{
        background: 'var(--color-surface)',
        borderColor: isCompleted ? 'var(--color-border)' : 'var(--color-border)',
        backdropFilter: 'blur(10px) saturate(160%)',
        WebkitBackdropFilter: 'blur(10px) saturate(160%)',
      }}
    >
      {/* ── Priority stripe ── */}
      <div
        className={cn(
          'absolute left-0 top-3 bottom-3 w-1 rounded-r-full',
          task.priority === 'urgent' ? 'bg-red-500' :
          task.priority === 'high' ? 'bg-orange-500' :
          task.priority === 'medium' ? 'bg-blue-400' : 'bg-slate-300'
        )}
      />

      <div className="pl-3">
        {/* ── App name banner (prominent, above title) ── */}
        {!compact && task.app_name && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-800 shadow-sm">
              📱 {task.app_name}
            </span>
            {task.kpi_type && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
                📈 {task.kpi_type}
              </span>
            )}
            {task.category && CATEGORY_ICONS[task.category] && (
              <span className="text-sm" title={task.category}>{CATEGORY_ICONS[task.category]}</span>
            )}
          </div>
        )}

        {/* ── Top row ── */}
        <div className="flex items-start gap-2">
          {/* Complete checkbox */}
          <button
            onClick={() => !isCompleted && showCompleteBtn && doAction(() => toggleTodoCompleteAction(task.id, true))}
            className={cn(
              'mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
              isCompleted
                ? 'bg-green-500 border-green-500'
                : 'border-slate-300 hover:border-green-400'
            )}
            title={isCompleted ? 'Completed' : 'Mark complete'}
            disabled={isCompleted || !showCompleteBtn}
          >
            {isCompleted && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <button
              className={cn(
                'text-left font-semibold text-sm leading-snug w-full',
                isCompleted ? 'line-through text-slate-400' : 'text-slate-900 hover:text-blue-600'
              )}
              onClick={() => onViewDetail(task)}
            >
              {task.title}
            </button>
            {!compact && !task.app_name && task.package_name && (
              <div className="text-xs text-slate-400 mt-0.5 truncate">{task.package_name}</div>
            )}
          </div>

          {/* Menu button */}
          <div className="relative shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-slate-100 transition-all"
            >
              <MoreVertical size={16} className="text-slate-400" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-8 rounded-xl z-50 min-w-40 py-1 animate-fade-in"
                style={{
                  background: 'var(--color-surface)',
                  backdropFilter: 'blur(20px) saturate(200%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(200%)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <MenuBtn onClick={() => { setMenuOpen(false); onViewDetail(task) }} icon={<Eye size={14}/>} label="View Details" />
                {isCreator && <MenuBtn onClick={() => { setMenuOpen(false); onEdit(task) }} icon={<Edit3 size={14}/>} label="Edit Task" />}
                <MenuBtn onClick={() => { setMenuOpen(false); onShare(task) }} icon={<Share2 size={14}/>} label="Share" />
                <MenuBtn
                  onClick={() => { setMenuOpen(false); doAction(() => duplicateTodoAction(task.id)) }}
                  icon={<Copy size={14}/>}
                  label="Duplicate"
                />
                {isCreator && !isCompleted && (
                  <MenuBtn
                    onClick={() => { setMenuOpen(false); doAction(() => archiveTodoAction(task.id)) }}
                    icon={<Archive size={14}/>}
                    label="Archive"
                  />
                )}
                {isCreator && !isCompleted && (
                  <MenuBtn
                    onClick={() => { setMenuOpen(false); doAction(() => deleteTodoAction(task.id)) }}
                    icon={<Trash2 size={14}/>}
                    label="Delete"
                    danger
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Badge row ── */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-7">
          <TaskStatusBadge status={task.task_status} />
          <PriorityBadge priority={task.priority} />
          {!task.app_name && task.kpi_type && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
              📈 {task.kpi_type}
            </span>
          )}
          {maEnabled && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-50 text-cyan-700 border border-cyan-200 rounded text-xs font-semibold">
              👥 {ma!.completion_percentage ?? 0}%
            </span>
          )}
          <ApprovalBadge status={task.approval_status} />
          {task.queue_status === 'queued' && (
            <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs font-medium">
              🗂 Queue{task.queue_department ? `: ${task.queue_department}` : ''}
            </span>
          )}
          {task.archived && (
            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs">Archived</span>
          )}
        </div>

        {/* ── Meta row ── */}
        {!compact && (
          <div className="flex flex-wrap items-center gap-3 mt-2.5 pl-7">
            {/* Assignee */}
            {task.assigned_to && (
              <div className="flex items-center gap-1.5">
                <UserAvatar username={task.assigned_to} />
                <span className="text-xs text-slate-500">{task.assigned_to}</span>
              </div>
            )}
            {/* Due date */}
            <DueDateChip dateStr={task.due_date} completed={isCompleted} />
            {/* Completion time */}
            {completionTime && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded">
                ⏱ {completionTime}
              </span>
            )}
            {/* Comments */}
            {comments.length > 0 && (
              <span className={cn('flex items-center gap-1 text-xs', unreadComments.length > 0 ? 'text-blue-600 font-semibold' : 'text-slate-400')}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M14 0H2C.9 0 0 .9 0 2v9c0 1.1.9 2 2 2h3l3 3 3-3h3c1.1 0 2-.9 2-2V2c0-1.1-.9-2-2-2z"/>
                </svg>
                {unreadComments.length > 0 ? `${unreadComments.length} new` : comments.length}
              </span>
            )}
            {/* Play Store link */}
            {playStoreUrl && (
              <a
                href={playStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={10} /> Play Store
              </a>
            )}
            {/* Shared flag */}
            {task.is_shared && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Share2 size={10} /> Shared
              </span>
            )}
          </div>
        )}

        {/* ── Action buttons ── */}
        {(showAcknowledgeBtn || showStartBtn || showClaimBtn || showApproveDeclineBtn || showMaStartBtn || showMaSubmitBtn) && (
          <div className="flex flex-wrap gap-2 mt-3 pl-7">
            {showAcknowledgeBtn && (
              <button
                onClick={() => doAction(() => acknowledgeTaskAction(task.id))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
              >
                ✅ Acknowledge
              </button>
            )}
            {showStartBtn && (
              <button
                onClick={() => doAction(() => startTaskAction(task.id))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
              >
                🚀 Start Work
              </button>
            )}
            {showClaimBtn && (
              <button
                onClick={() => doAction(() => claimQueuedTaskAction(task.id))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors"
              >
                📥 Pick Task
              </button>
            )}
            {showMaStartBtn && (
              <button
                onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'in_progress'))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
              >
                🚀 MA: Start
              </button>
            )}
            {showMaSubmitBtn && (
              <button
                onClick={() => doAction(() => updateMaAssigneeStatusAction(task.id, 'completed'))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors"
              >
                📤 MA: Submit
              </button>
            )}
            {showApproveDeclineBtn && (
              <>
                <button
                  onClick={() => doAction(() => approveTodoAction(task.id))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors"
                >
                  ✅ Approve
                </button>
                <button
                  onClick={() => onDecline(task)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs font-semibold hover:bg-red-100 transition-colors"
                >
                  ❌ Decline
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MenuBtn({
  onClick,
  icon,
  label,
  danger = false,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left hover:bg-slate-50',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
