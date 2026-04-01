'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Clock, User, CheckCircle2, AlertCircle, Zap, ListOrdered } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { HallAssignPageData, HallAssignMemberTask, PriorityNum } from '@/app/dashboard/tasks/actions'
import {
  assignHallInboxTaskWithSchedulerAction,
  updateTaskPriorityAction,
} from '@/app/dashboard/tasks/actions'
import { formatPakistanDateTime } from '@/lib/pakistan-time'
import { calculateEffectiveDueAt } from '@/lib/hall-scheduler'
import type { HallOfficeHours } from '@/lib/pakistan-time'

// Local constants (cannot live in 'use server' actions file)
const PRIORITY_NUM_MAP: Record<string, PriorityNum> = { low: 1, medium: 2, high: 3, urgent: 4 }
const NUM_PRIORITY_MAP: Record<PriorityNum, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' }

// Priority mapping
const P_LABEL: Record<PriorityNum, string> = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' }
const P_COLOR: Record<PriorityNum, string> = {
  1: 'bg-slate-100 text-slate-600 border-slate-200',
  2: 'bg-blue-50 text-blue-700 border-blue-200',
  3: 'bg-orange-50 text-orange-700 border-orange-200',
  4: 'bg-red-50 text-red-700 border-red-200',
}
const P_RING: Record<PriorityNum, string> = {
  1: 'ring-slate-300',
  2: 'ring-blue-400',
  3: 'ring-orange-400',
  4: 'ring-red-500',
}

function PriorityBadge({ num, size = 'sm', editable, taskId, onUpdated }: {
  num: PriorityNum
  size?: 'sm' | 'lg'
  editable?: boolean
  taskId?: string
  onUpdated?: (taskId: string, newNum: PriorityNum) => void
}) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  const changePriority = (n: PriorityNum) => {
    if (!taskId || !onUpdated) return
    startTransition(async () => {
      const res = await updateTaskPriorityAction(taskId, n)
      if (res.success) { onUpdated(taskId, n) }
      setEditing(false)
    })
  }

  if (editable && editing) {
    return (
      <div className="flex items-center gap-1">
        {([1, 2, 3, 4] as PriorityNum[]).map((n) => (
          <button
            key={n}
            type="button"
            disabled={pending}
            onClick={() => changePriority(n)}
            className={cn(
              'w-7 h-7 rounded-lg border text-xs font-bold flex items-center justify-center transition-all',
              n === num ? `ring-2 ${P_RING[n]} ${P_COLOR[n]}` : P_COLOR[n],
              pending && 'opacity-50'
            )}
          >
            {n}
          </button>
        ))}
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600 ml-1">✕</button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={editable ? () => setEditing(true) : undefined}
      className={cn(
        'rounded-lg border font-bold flex items-center justify-center transition-all',
        size === 'lg' ? 'w-9 h-9 text-base' : 'w-7 h-7 text-xs',
        P_COLOR[num],
        editable && 'cursor-pointer hover:ring-2 hover:ring-offset-1',
        editable && P_RING[num]
      )}
      title={editable ? `Priority ${num} — ${P_LABEL[num]} (click to change)` : `Priority ${num} — ${P_LABEL[num]}`}
    >
      {num}
    </button>
  )
}

interface Props {
  data: HallAssignPageData
}

// ── Queue insert slot ────────────────────────────────────────────────────────
function InsertSlot({ position, active, onClick }: { position: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2 py-1 group transition-all">
      <div className={cn('flex-1 h-0.5 rounded-full transition-all', active ? 'bg-violet-400' : 'bg-transparent group-hover:bg-violet-200')} />
      <span className={cn(
        'text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all whitespace-nowrap',
        active ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-transparent text-slate-300 group-hover:border-violet-200 group-hover:text-violet-500 group-hover:bg-violet-50'
      )}>
        {active ? `↑ Insert at position #${position}` : `Insert at #${position}`}
      </span>
      <div className={cn('flex-1 h-0.5 rounded-full transition-all', active ? 'bg-violet-400' : 'bg-transparent group-hover:bg-violet-200')} />
    </button>
  )
}

export function HallAssignPage({ data }: Props) {
  const router = useRouter()
  const [selectedMember, setSelectedMember] = useState<string>('')
  const [days, setDays] = useState(0)
  const [hours, setHours] = useState(0)
  const [priorityNum, setPriorityNum] = useState<PriorityNum>(3)
  const [insertAt, setInsertAt] = useState<number | null>(null) // null = end of queue
  const [note, setNote] = useState('')
  const [loading, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Local copy of members so we can update priorities in-place
  type MemberState = HallAssignPageData['members'][number] & { activeTasks: HallAssignMemberTask[] }
  const [members, setMembers] = useState<MemberState[]>(() =>
    data.members.map((m) => ({ ...m, activeTasks: [...m.activeTasks] }))
  )

  const selected = members.find((m) => m.username === selectedMember)

  const totalEstHours = days * 8 + hours

  // Compute estimated completion time based on cluster office hours
  const estimatedDue = totalEstHours > 0
    ? calculateEffectiveDueAt(new Date().toISOString(), Math.round(totalEstHours * 60), data.officeHours as HallOfficeHours)
    : null
  const estimatedDueLabel = estimatedDue
    ? estimatedDue.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : null

  const dayHours = (() => {
    const oh = data.officeHours
    const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
    const workMins = parseHHMM(oh.office_end) - parseHHMM(oh.office_start) - (parseHHMM(oh.break_end) - parseHHMM(oh.break_start))
    return (workMins / 60).toFixed(0)
  })()

  // Reset queue position whenever a different member is selected
  useEffect(() => { setInsertAt(null) }, [selectedMember])

  // Derived queue data for selected member
  const activeTask = selected?.activeTasks.find((t) => t.scheduler_state === 'active') ?? null
  const queuedTasks = selected?.activeTasks.filter((t) => t.scheduler_state !== 'active') ?? []
  const isUserFree = (selected?.totalTasks ?? 0) === 0
  // effectiveInsertAt is 1-based position within the queued subset
  const effectiveInsertAt = insertAt ?? (queuedTasks.length + 1)
  const newTaskPositionLabel = isUserFree
    ? 'Starts immediately (user is free)'
    : insertAt
      ? `Queue position #${insertAt + (activeTask ? 1 : 0)}`
      : `Queue position #${queuedTasks.length + 1 + (activeTask ? 1 : 0)}`

  const handlePriorityUpdated = (taskId: string, newNum: PriorityNum) => {
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        activeTasks: m.activeTasks.map((t) =>
          t.id === taskId ? { ...t, priority: NUM_PRIORITY_MAP[newNum], priorityNum: newNum } : t
        ),
        priorityCounts: m.activeTasks.reduce((acc, t2) => {
          const pn = t2.id === taskId ? newNum : t2.priorityNum
          acc[pn] = (acc[pn] ?? 0) + 1
          return acc
        }, { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<PriorityNum, number>),
      }))
    )
  }

  const handleAssign = () => {
    setError(null)
    if (!selectedMember) { setError('Please select a team member.'); return }
    if (totalEstHours <= 0) { setError('Please enter estimated work time.'); return }

    // Convert queued-list position to raw queue_rank for the server
    const rawInsertAtRank =
      insertAt && !isUserFree
        ? (activeTask?.queue_rank ?? 0) + insertAt
        : undefined

    startTransition(async () => {
      const res = await assignHallInboxTaskWithSchedulerAction(
        data.task.id,
        selectedMember,
        NUM_PRIORITY_MAP[priorityNum],
        totalEstHours,
        note.trim() || undefined,
        rawInsertAtRank,
      )
      if (res.success) {
        setSuccess(true)
        setTimeout(() => router.push('/dashboard/team?scope=tasks_queue'), 1200)
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
        <p className="text-lg font-semibold text-slate-800">Task assigned successfully!</p>
        <p className="text-sm text-slate-500">Redirecting back to Hall Queue…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft size={18} className="text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-slate-900 truncate">Assign Hall Queue Task</h1>
          <p className="text-sm text-slate-500 truncate">{data.clusterName} — {data.task.title}</p>
        </div>
        {data.task.requested_due_at && (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
            <Clock size={12} />
            <span>Due: {formatPakistanDateTime(data.task.requested_due_at)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row flex-1 gap-0 lg:gap-6 p-4 lg:p-6 min-h-0">
        {/* LEFT — Member List */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Select Team Member</p>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {members.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">No team members found in this hall.</p>
            )}
            {members.map((m) => {
              const isSelected = selectedMember === m.username
              return (
                <button
                  key={m.username}
                  type="button"
                  onClick={() => setSelectedMember(m.username)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                    isSelected
                      ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  )}
                >
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: isSelected ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}
                  >
                    {m.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold truncate', isSelected ? 'text-violet-800' : 'text-slate-800')}>
                      {m.username}
                    </p>
                    {m.department && <p className="text-xs text-slate-400 truncate">{m.department}</p>}
                  </div>
                  {/* Priority count pills */}
                  <div className="flex flex-col items-end gap-0.5">
                    {([4, 3, 2, 1] as PriorityNum[]).map((n) => m.priorityCounts[n] > 0 && (
                      <span key={n} className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border leading-none', P_COLOR[n])}>
                        {m.priorityCounts[n]}×{n}
                      </span>
                    ))}
                    {m.totalTasks === 0 && (
                      <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">free</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* RIGHT — Member detail + assign form */}
        <div className="flex-1 min-w-0 mt-4 lg:mt-0 space-y-5">
          {!selectedMember ? (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl py-16 gap-3">
              <User size={32} className="text-slate-300" />
              <p className="text-slate-400 text-sm">Select a team member to see their tasks and assign</p>
            </div>
          ) : (
            <>
              {/* Queue state banner */}
              {isUserFree ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50">
                  <Zap size={16} className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">{selectedMember} is free — task will start immediately</p>
                    <p className="text-xs text-emerald-600">No pending tasks. This task becomes active at priority position #1.</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                    <ListOrdered size={14} className="text-slate-400" />
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {selectedMember}&apos;s Task Queue
                      <span className="ml-2 normal-case font-normal text-slate-400">— click priority number to change urgency</span>
                    </p>
                  </div>
                  <div className="p-3 space-y-0.5 max-h-64 overflow-y-auto">
                    {/* Active task (not movable) */}
                    {activeTask && (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 mb-2">
                        <span className="text-[10px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded-full flex-shrink-0">ACTIVE</span>
                        <PriorityBadge num={activeTask.priorityNum} editable taskId={activeTask.id} onUpdated={handlePriorityUpdated} />
                        <p className="text-sm font-medium text-blue-900 truncate flex-1">{activeTask.title}</p>
                      </div>
                    )}

                    {/* Insert-at-position 1 slot */}
                    {queuedTasks.length > 0 && (
                      <InsertSlot
                        position={1 + (activeTask ? 1 : 0)}
                        active={effectiveInsertAt === 1}
                        onClick={() => setInsertAt(effectiveInsertAt === 1 ? null : 1)}
                      />
                    )}

                    {queuedTasks.map((t, idx) => {
                      const qPos = idx + 1 // 1-based in queued subset
                      const displayPos = qPos + (activeTask ? 1 : 0)
                      return (
                        <div key={t.id}>
                          <div className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all',
                            effectiveInsertAt === qPos ? 'border-violet-200 bg-violet-50/50' : 'border-slate-100 bg-slate-50'
                          )}>
                            <span className="text-[10px] font-bold text-slate-400 w-5 text-center flex-shrink-0">#{displayPos}</span>
                            <PriorityBadge num={t.priorityNum} editable taskId={t.id} onUpdated={handlePriorityUpdated} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-700 truncate">{t.title}</p>
                            </div>
                            <span className={cn(
                              'text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0',
                              t.scheduler_state === 'paused' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-100 border-slate-200 text-slate-500'
                            )}>
                              {t.scheduler_state === 'paused' ? 'paused' : 'queued'}
                            </span>
                          </div>
                          <InsertSlot
                            position={qPos + 1 + (activeTask ? 1 : 0)}
                            active={effectiveInsertAt === qPos + 1}
                            onClick={() => setInsertAt(effectiveInsertAt === qPos + 1 ? null : qPos + 1)}
                          />
                        </div>
                      )
                    })}

                    {/* Summary */}
                    <div className="mt-1 pt-2 border-t border-slate-100 flex items-center gap-2 px-1">
                      <div className="w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">N</div>
                      <p className="text-xs text-violet-700 font-medium">{newTaskPositionLabel}</p>
                      {insertAt && (
                        <button type="button" onClick={() => setInsertAt(null)} className="ml-auto text-xs text-slate-400 hover:text-slate-600">Reset to end</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Assign form */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
                <h2 className="font-semibold text-slate-800 text-base">Assign to {selectedMember}</h2>

                {/* Priority */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Priority <span className="normal-case font-normal">(1 = Low · 2 = Medium · 3 = High · 4 = Urgent)</span>
                  </p>
                  <div className="flex items-center gap-2">
                    {([1, 2, 3, 4] as PriorityNum[]).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPriorityNum(n)}
                        className={cn(
                          'w-12 h-12 rounded-xl border text-lg font-bold transition-all',
                          priorityNum === n
                            ? `ring-2 ring-offset-1 ${P_RING[n]} ${P_COLOR[n]}`
                            : `${P_COLOR[n]} opacity-60 hover:opacity-100`
                        )}
                        title={`${P_LABEL[n]}`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-sm text-slate-500 ml-2">{P_LABEL[priorityNum]}</span>
                  </div>
                </div>

                {/* Estimated work time */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Estimated Work Time
                    <span className="ml-2 normal-case font-normal text-slate-400">
                      (1 day = {dayHours}h office time · {data.officeHours.office_start}–{data.officeHours.office_end})
                    </span>
                  </p>
                  <div className="flex gap-3 items-start">
                    <div className="flex-1">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="0"
                        value={days || ''}
                        onChange={(e) => setDays(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                      <p className="text-[11px] text-slate-400 mt-1 text-center">Days</p>
                    </div>
                    <span className="text-slate-400 font-bold mt-2.5">+</span>
                    <div className="flex-1">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        step={0.5}
                        placeholder="0"
                        value={hours || ''}
                        onChange={(e) => setHours(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                      <p className="text-[11px] text-slate-400 mt-1 text-center">Hours</p>
                    </div>
                  </div>
                  {totalEstHours > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-violet-600 font-medium">≈ {totalEstHours.toFixed(1)} office hours total</p>
                      {estimatedDueLabel && (
                        <p className="text-xs text-slate-500">
                          <span className="font-medium text-slate-700">Est. completion:</span> {estimatedDueLabel} PKT
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Note */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Note <span className="normal-case font-normal">(optional)</span>
                  </p>
                  <textarea
                    rows={2}
                    placeholder="Any context for the assignee…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
                    <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                  >
                    {loading ? 'Assigning…' : 'Assign Task'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
