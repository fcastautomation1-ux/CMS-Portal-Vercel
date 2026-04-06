'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, CheckCircle2, AlertCircle, Zap, ListOrdered, Plus, Trash2, ChevronUp, ChevronDown, Users, Clock
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { HallAssignPageData, HallAssignMemberTask, HallMultiAssignEntry } from '@/app/dashboard/tasks/actions'
import { assignHallInboxTaskMultiAction } from '@/app/dashboard/tasks/actions'
import { calculateEffectiveDueAt } from '@/lib/hall-scheduler'
import type { HallOfficeHours } from '@/lib/pakistan-time'

interface Props {
  data: HallAssignPageData
}

type MemberState = HallAssignPageData['members'][number] & { activeTasks: HallAssignMemberTask[] }

interface AssignmentCard {
  id: string
  username: string
  days: number
  hours: number
  priority: string
  insertAtRank: number | null // null = end of queue
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'text-slate-600 bg-slate-50 border-slate-200' },
  { value: 'medium', label: 'Medium', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { value: 'high', label: 'High', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600 bg-red-50 border-red-200' },
]

function InsertSlot({ position, active, onClick }: { position: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2 py-1 group transition-all">
      <div className={cn('flex-1 h-0.5 rounded-full transition-all', active ? 'bg-violet-400' : 'bg-transparent group-hover:bg-violet-200')} />
      <span className={cn(
        'text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all whitespace-nowrap',
        active
          ? 'border-violet-400 bg-violet-50 text-violet-700'
          : 'border-transparent text-slate-300 group-hover:border-violet-200 group-hover:text-violet-500 group-hover:bg-violet-50'
      )}>
        {active ? `↑ Insert at #${position}` : `Insert at #${position}`}
      </span>
      <div className={cn('flex-1 h-0.5 rounded-full transition-all', active ? 'bg-violet-400' : 'bg-transparent group-hover:bg-violet-200')} />
    </button>
  )
}

function AssignmentCardUI({
  card,
  member,
  officeHours,
  index,
  total,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  card: AssignmentCard
  member: MemberState | undefined
  officeHours: HallAssignPageData['officeHours']
  index: number
  total: number
  onUpdate: (id: string, patch: Partial<AssignmentCard>) => void
  onRemove: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
}) {
  const totalEstHours = card.days * 8 + card.hours

  const estimatedDue = totalEstHours > 0
    ? calculateEffectiveDueAt(new Date().toISOString(), Math.round(totalEstHours * 60), officeHours as HallOfficeHours)
    : null
  const estimatedDueLabel = estimatedDue
    ? estimatedDue.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : null

  const dayHours = (() => {
    const oh = officeHours
    const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
    const workMins = parseHHMM(oh.office_end) - parseHHMM(oh.office_start) - (parseHHMM(oh.break_end) - parseHHMM(oh.break_start))
    return (workMins / 60).toFixed(0)
  })()

  const activeTask = member?.activeTasks.find((t) => t.scheduler_state === 'active') ?? null
  const queuedTasks = member?.activeTasks.filter((t) => t.scheduler_state !== 'active') ?? []
  const isUserFree = (member?.totalTasks ?? 0) === 0
  const effectiveInsertAt = card.insertAtRank ?? (queuedTasks.length + 1)
  const newTaskPositionLabel = isUserFree
    ? 'Starts immediately (user is free)'
    : card.insertAtRank
      ? `Queue position #${card.insertAtRank + (activeTask ? 1 : 0)}`
      : `Queue position #${queuedTasks.length + 1 + (activeTask ? 1 : 0)}`

  const priorityCfg = PRIORITY_OPTIONS.find((p) => p.value === card.priority) ?? PRIORITY_OPTIONS[1]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Card Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div
          className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#7C3AED,#6D28D9)' }}
        >
          {card.username.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{card.username}</p>
          {member?.department && <p className="text-xs text-slate-400 truncate">{member.department}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMoveUp(card.id)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMoveDown(card.id)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Move down"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(card.id)}
            className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors ml-1"
            title="Remove"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Queue State */}
        {isUserFree ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50">
            <Zap size={13} className="text-emerald-500 flex-shrink-0" />
            <p className="text-xs font-medium text-emerald-700">User is free — task will start immediately</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
              <ListOrdered size={12} className="text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.username}&apos;s Queue</p>
            </div>
            <div className="p-2 space-y-0.5 max-h-40 overflow-y-auto">
              {activeTask && (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-blue-50 border border-blue-100 mb-1.5">
                  <span className="text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">ACTIVE</span>
                  <p className="text-xs font-medium text-blue-900 truncate flex-1">{activeTask.title}</p>
                </div>
              )}
              {queuedTasks.length > 0 && (
                <InsertSlot
                  position={1 + (activeTask ? 1 : 0)}
                  active={effectiveInsertAt === 1}
                  onClick={() => onUpdate(card.id, { insertAtRank: effectiveInsertAt === 1 ? null : 1 })}
                />
              )}
              {queuedTasks.map((t, idx) => {
                const qPos = idx + 1
                const displayPos = qPos + (activeTask ? 1 : 0)
                return (
                  <div key={t.id}>
                    <div className={cn(
                      'flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all',
                      effectiveInsertAt === qPos ? 'border-violet-200 bg-violet-50/50' : 'border-slate-100 bg-white'
                    )}>
                      <span className="text-[9px] font-bold text-slate-400 w-5 text-center flex-shrink-0">#{displayPos}</span>
                      <p className="text-xs font-medium text-slate-700 truncate flex-1">{t.title}</p>
                      <span className={cn(
                        'text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0',
                        t.scheduler_state === 'paused' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-100 border-slate-200 text-slate-500'
                      )}>
                        {t.scheduler_state === 'paused' ? 'paused' : 'queued'}
                      </span>
                    </div>
                    <InsertSlot
                      position={qPos + 1 + (activeTask ? 1 : 0)}
                      active={effectiveInsertAt === qPos + 1}
                      onClick={() => onUpdate(card.id, { insertAtRank: effectiveInsertAt === qPos + 1 ? null : qPos + 1 })}
                    />
                  </div>
                )
              })}
              <div className="pt-1 flex items-center gap-2 px-1">
                <div className="w-4 h-4 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">N</div>
                <p className="text-[10px] text-violet-700 font-medium">{newTaskPositionLabel}</p>
                {card.insertAtRank && (
                  <button type="button" onClick={() => onUpdate(card.id, { insertAtRank: null })} className="ml-auto text-[10px] text-slate-400 hover:text-slate-600">Reset</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Time Estimate */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Estimated Work Time
            <span className="ml-1.5 normal-case font-normal text-slate-400">(1 day = {dayHours}h)</span>
          </p>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <input
                type="number"
                min={0}
                step={1}
                placeholder="0"
                value={card.days || ''}
                onChange={(e) => onUpdate(card.id, { days: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <p className="text-[10px] text-slate-400 mt-1 text-center">Days</p>
            </div>
            <span className="text-slate-400 font-bold mt-2">+</span>
            <div className="flex-1">
              <input
                type="number"
                min={0}
                max={23}
                step={0.5}
                placeholder="0"
                value={card.hours || ''}
                onChange={(e) => onUpdate(card.id, { hours: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <p className="text-[10px] text-slate-400 mt-1 text-center">Hours</p>
            </div>
          </div>
          {totalEstHours > 0 && (
            <div className="mt-2 space-y-0.5">
              <p className="text-xs text-violet-600 font-medium">≈ {totalEstHours.toFixed(1)} office hours total</p>
              {estimatedDueLabel && (
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock size={10} />
                  Est. completion: <span className="font-medium text-slate-700">{estimatedDueLabel} PKT</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Priority */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Priority</p>
          <div className="flex gap-2 flex-wrap">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdate(card.id, { priority: opt.value })}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                  card.priority === opt.value
                    ? opt.color + ' ring-2 ring-offset-1 ring-violet-400'
                    : 'border-slate-200 text-slate-500 bg-white hover:border-slate-300'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function HallMultiAssignPage({ data }: Props) {
  const router = useRouter()
  const [cards, setCards] = useState<AssignmentCard[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [loading, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [assignedCount, setAssignedCount] = useState(0)

  const members: MemberState[] = data.members.map((m) => ({ ...m, activeTasks: [...m.activeTasks] }))

  const addedUsernames = new Set(cards.map((c) => c.username.toLowerCase()))

  const filteredMembers = members.filter((m) => {
    const q = memberSearch.trim().toLowerCase()
    if (q) {
      const haystack = `${m.username} ${m.department ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const addMember = useCallback((username: string) => {
    if (addedUsernames.has(username.toLowerCase())) return
    setCards((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        username,
        days: 0,
        hours: 0,
        priority: 'medium',
        insertAtRank: null,
      },
    ])
  }, [addedUsernames])

  const updateCard = useCallback((id: string, patch: Partial<AssignmentCard>) => {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c))
  }, [])

  const removeCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const moveUp = useCallback((id: string) => {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx <= 0) return prev
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }, [])

  const moveDown = useCallback((id: string) => {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }, [])

  // Reset insert slot for each member when cards change (new member added)
  useEffect(() => {
    // No-op: insert slots are per-card state, reset handled in addMember
  }, [cards.length])

  const handleAssign = () => {
    setError(null)
    if (cards.length === 0) { setError('Add at least one team member.'); return }
    const invalid = cards.find((c) => c.days * 8 + c.hours <= 0)
    if (invalid) { setError(`Please enter estimated work time for ${invalid.username}.`); return }

    const assignments: HallMultiAssignEntry[] = cards.map((c) => ({
      username: c.username,
      estimatedHours: c.days * 8 + c.hours,
      priority: c.priority,
      insertAtRank: c.insertAtRank ?? undefined,
    }))

    startTransition(async () => {
      const res = await assignHallInboxTaskMultiAction(data.task.id, assignments)
      if (res.success) {
        setAssignedCount(res.assignedCount ?? cards.length)
        setSuccess(true)
        setTimeout(() => router.push('/dashboard/team?scope=tasks_queue'), 1600)
      } else {
        setError(res.error ?? 'Assignment failed.')
      }
    })
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <p className="text-lg font-semibold text-slate-800">
          Task assigned to {assignedCount} member{assignedCount !== 1 ? 's' : ''}!
        </p>
        <p className="text-sm text-slate-500">Redirecting to Hall Queue…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 sm:px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={18} className="text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">Multi-User Hall Assignment</h1>
          <p className="text-xs sm:text-sm text-slate-500 truncate">{data.clusterName} — {data.task.title}</p>
        </div>
        {cards.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-700 font-medium flex-shrink-0">
            <Users size={12} />
            {cards.length} member{cards.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row flex-1 gap-0 min-h-0">
        {/* LEFT PANEL — Member Picker */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/50">
          <div className="p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Add Team Members</p>
            <input
              type="text"
              placeholder="Search members…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <div className="space-y-1.5 max-h-[40vh] lg:max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
              {filteredMembers.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8">No members found.</p>
              )}
              {filteredMembers.map((m) => {
                const isAdded = addedUsernames.has(m.username.toLowerCase())
                return (
                  <button
                    key={m.username}
                    type="button"
                    disabled={isAdded}
                    onClick={() => addMember(m.username)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all',
                      isAdded
                        ? 'border-violet-200 bg-violet-50 opacity-60 cursor-not-allowed'
                        : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer'
                    )}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: isAdded ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}
                    >
                      {m.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{m.username}</p>
                      {m.department && <p className="text-[11px] text-slate-400 truncate">{m.department}</p>}
                    </div>
                    <div className="flex-shrink-0">
                      {isAdded ? (
                        <CheckCircle2 size={14} className="text-violet-500" />
                      ) : m.totalTasks > 0 ? (
                        <span className="text-[10px] text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full">{m.totalTasks}</span>
                      ) : (
                        <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">free</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT — Assignment Cards */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 border-2 border-dashed border-slate-200 rounded-2xl">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Plus size={24} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-slate-600 font-medium">No members added yet</p>
                  <p className="text-sm text-slate-400 mt-1">Select team members from the left panel to assign this task</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {cards.length} Member{cards.length !== 1 ? 's' : ''} — set time estimate and priority for each
                </p>
                {cards.map((card, index) => {
                  const member = members.find((m) => m.username.toLowerCase() === card.username.toLowerCase())
                  return (
                    <AssignmentCardUI
                      key={card.id}
                      card={card}
                      member={member}
                      officeHours={data.officeHours}
                      index={index}
                      total={cards.length}
                      onUpdate={updateCard}
                      onRemove={removeCard}
                      onMoveUp={moveUp}
                      onMoveDown={moveDown}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* Bottom Sticky Action Bar */}
          <div className="border-t border-slate-200 bg-white px-4 sm:px-6 py-4">
            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 mb-3">
                <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            <div className="flex items-center gap-3 justify-between">
              <p className="text-sm text-slate-500">
                {cards.length === 0
                  ? 'Add members from the left panel to begin.'
                  : `Ready to assign to ${cards.length} member${cards.length !== 1 ? 's' : ''}.`}
              </p>
              <button
                type="button"
                disabled={loading || cards.length === 0}
                onClick={handleAssign}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all',
                  loading || cards.length === 0
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm active:scale-95'
                )}
              >
                <Users size={15} />
                {loading ? 'Assigning…' : `Assign to ${cards.length > 0 ? cards.length : ''} Member${cards.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
