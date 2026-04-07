'use client'

import { useState, useTransition, useCallback, useMemo, memo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, CheckCircle2, AlertCircle, GripVertical, Trash2, Plus, Clock, ChevronDown, ChevronUp, Users, FileText,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import type { HallAssignPageData, HallAssignMemberTask, HallMultiAssignEntry } from '@/app/dashboard/tasks/actions'
import { assignHallInboxTaskMultiAction } from '@/app/dashboard/tasks/actions'
import { calculateEffectiveDueAt } from '@/lib/hall-scheduler'
import type { HallOfficeHours } from '@/lib/pakistan-time'

interface Props {
  data: HallAssignPageData
}

type MemberWithTasks = HallAssignPageData['members'][number] & {
  activeTasks: HallAssignMemberTask[]
}

interface AssignmentCard {
  id: string
  username: string
  days: number
  hours: number
  queuePosition: string
  assignmentNote: string
}

// --- Sortable queue item ---

function SortableQueueItem({
  task,
  index,
  isActive,
}: {
  task: HallAssignMemberTask & { id: string }
  index: number
  isActive: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}
      className={cn(
        'flex items-center gap-2 px-2.5 py-2.5 rounded-xl border transition-all select-none',
        isActive ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-white cursor-grab active:cursor-grabbing'
      )}
    >
      {!isActive && (
        <span {...attributes} {...listeners} className="text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0">
          <GripVertical size={14} />
        </span>
      )}
      <span className={cn('text-[10px] font-bold w-5 text-center flex-shrink-0', isActive ? 'text-blue-500' : 'text-slate-400')}>
        #{index + 1}
      </span>
      <span className="flex-1 text-xs font-medium text-slate-700 truncate">{task.title}</span>
      <span className={cn(
        'text-[10px] px-1.5 py-0.5 rounded-full border flex-shrink-0',
        isActive ? 'bg-blue-100 border-blue-200 text-blue-700' :
          task.scheduler_state === 'paused' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-100 border-slate-200 text-slate-500'
      )}>
        {isActive ? 'active' : task.scheduler_state === 'paused' ? 'paused' : 'queued'}
      </span>
    </div>
  )
}

// --- Assignment card for one user ---

const AssignmentCardUI = memo(function AssignmentCardUI({
  card,
  member,
  officeHours,
  index,
  total,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  queueItems,
  setQueueItems,
}: {
  card: AssignmentCard
  member: MemberWithTasks | undefined
  officeHours: HallAssignPageData['officeHours']
  index: number
  total: number
  onUpdate: (id: string, patch: Partial<AssignmentCard>) => void
  onRemove: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  queueItems: Array<HallAssignMemberTask & { id: string }>
  setQueueItems: (items: Array<HallAssignMemberTask & { id: string }>) => void
}) {
  const totalEstHours = card.days * 8 + card.hours

  const dayHours = useMemo(() => {
    const oh = officeHours
    const parseHHMM = (s: string) => { const [hh, mm] = s.split(':').map(Number); return (hh || 0) * 60 + (mm || 0) }
    const workMins = parseHHMM(oh.office_end) - parseHHMM(oh.office_start) - (parseHHMM(oh.break_end) - parseHHMM(oh.break_start))
    return Math.round(workMins / 60)
  }, [officeHours])

  // Stable start time - only compute once per card mount to avoid recalculating on every keystroke
  const startTimeRef = useRef(new Date().toISOString())

  const estimatedDueLabel = useMemo(() => {
    if (totalEstHours <= 0) return null
    const due = calculateEffectiveDueAt(startTimeRef.current, Math.round(totalEstHours * 60), officeHours as HallOfficeHours)
    if (!due) return null
    return due.toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  }, [totalEstHours, officeHours])

  const queuedItems = queueItems.filter((t) => t.scheduler_state !== 'active')
  const activeItem = queueItems.find((t) => t.scheduler_state === 'active')
  const isUserFree = queueItems.length === 0
  const queueSize = queuedItems.length

  const posRaw = card.queuePosition.trim()
  const posNum = posRaw === '' ? null : parseInt(posRaw, 10)
  const effectivePos = posNum === null || isNaN(posNum) || posNum < 1
    ? queueSize + 1
    : Math.min(posNum, queueSize + 1)
  const posLabel = isUserFree
    ? 'Starts immediately (queue is empty)'
    : posNum === null || isNaN(posNum) || posNum < 1
      ? `Will be added at position #${queueSize + 1} (end of queue)`
      : posNum > queueSize
        ? `Position #${queueSize + 1} (clamped - only ${queueSize} task${queueSize !== 1 ? 's' : ''} in queue)`
        : `Will be inserted at position #${effectivePos}`

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = queuedItems.findIndex((t) => t.id === active.id)
    const newIndex = queuedItems.findIndex((t) => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(queuedItems, oldIndex, newIndex)
    setQueueItems([...(activeItem ? [activeItem] : []), ...reordered])
  }, [queuedItems, activeItem, setQueueItems])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
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
          <button type="button" disabled={index === 0} onClick={() => onMoveUp(card.id)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Move up">
            <ChevronUp size={14} />
          </button>
          <button type="button" disabled={index === total - 1} onClick={() => onMoveDown(card.id)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Move down">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={() => onRemove(card.id)}
            className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors ml-1" title="Remove">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Queue state */}
        {isUserFree ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50">
            <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
            <p className="text-xs font-medium text-emerald-700">Queue is empty - task will start immediately</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {card.username}&apos;s Queue <span className="text-slate-400 font-normal">({queueSize} task{queueSize !== 1 ? 's' : ''})</span>
              </p>
              <span className="text-[10px] text-slate-400">drag to reorder</span>
            </div>
            <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
              {activeItem && (
                <SortableQueueItem task={activeItem} index={0} isActive={true} />
              )}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={queuedItems.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  {queuedItems.map((task, idx) => (
                    <SortableQueueItem key={task.id} task={task} index={activeItem ? idx + 1 : idx} isActive={false} />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )}

        {/* Queue position */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Queue Position for New Task
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              placeholder={isUserFree ? '-' : `1 - ${queueSize + 1}`}
              disabled={isUserFree}
              value={card.queuePosition}
              onChange={(e) => onUpdate(card.id, { queuePosition: e.target.value })}
              className="w-28 px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:bg-slate-100 disabled:text-slate-400"
            />
            <span className="text-xs text-slate-400 flex-1">{posLabel}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Leave blank to add to end of queue.</p>
        </div>

        {/* Time estimate */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Estimated Work Time
            <span className="ml-1.5 normal-case font-normal">(1 day = {dayHours}h)</span>
          </p>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <input type="number" min={0} step={1} placeholder="0" value={card.days || ''}
                onChange={(e) => onUpdate(card.id, { days: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <p className="text-[10px] text-slate-400 mt-1 text-center">Days</p>
            </div>
            <span className="text-slate-400 font-bold mt-2">+</span>
            <div className="flex-1">
              <input type="number" min={0} max={23} step={0.5} placeholder="0" value={card.hours || ''}
                onChange={(e) => onUpdate(card.id, { hours: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <p className="text-[10px] text-slate-400 mt-1 text-center">Hours</p>
            </div>
          </div>
          {totalEstHours > 0 && (
            <div className="mt-2 space-y-0.5">
              <p className="text-xs text-violet-600 font-medium">~{totalEstHours.toFixed(1)} office hours total</p>
              {estimatedDueLabel && (
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock size={10} />
                  Est. completion: <span className="font-medium text-slate-700 ml-0.5">{estimatedDueLabel} PKT</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Assignment note */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <FileText size={11} />
            Assignment Note <span className="normal-case font-normal text-slate-400">(optional)</span>
          </p>
          <textarea
            rows={3}
            placeholder="Add instructions, context, or clarifications for this team member..."
            value={card.assignmentNote}
            onChange={(e) => onUpdate(card.id, { assignmentNote: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
          />
          <p className="text-[11px] text-slate-400 mt-1">This note will be saved to the task and visible to the assignee.</p>
        </div>
      </div>
    </div>
  )
})

// --- Main page ---

export function HallMultiAssignPage({ data }: Props) {
  const router = useRouter()
  const [cards, setCards] = useState<AssignmentCard[]>([])
  const [queueStates, setQueueStates] = useState<Record<string, Array<HallAssignMemberTask & { id: string }>>>(() => {
    const init: Record<string, Array<HallAssignMemberTask & { id: string }>> = {}
    for (const m of data.members) {
      init[m.username] = m.activeTasks.map((t) => ({ ...t }))
    }
    return init
  })

  const [memberSearch, setMemberSearch] = useState('')
  const [loading, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [assignedCount, setAssignedCount] = useState(0)

  // Supervisors see only their dept members (server-side already filtered, client-side safety net)
  const isSupervisor = data.currentUserRole === 'Supervisor'
  const supervisorDept = (data.currentUserDept ?? '').toLowerCase()

  const allMembers: MemberWithTasks[] = data.members.filter((m) => {
    if (!isSupervisor) return true
    const memberDept = (m.department ?? '').toLowerCase()
    return supervisorDept && memberDept.includes(supervisorDept)
  }).map((m) => ({ ...m, activeTasks: [...m.activeTasks] }))

  const filteredMembers = allMembers.filter((m) => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return true
    return `${m.username} ${m.department ?? ''}`.toLowerCase().includes(q)
  })

  const addMember = useCallback((username: string) => {
    setCards((prev) => {
      if (prev.some((c) => c.username.toLowerCase() === username.toLowerCase())) return prev
      return [...prev, { id: crypto.randomUUID(), username, days: 0, hours: 0, queuePosition: '', assignmentNote: '' }]
    })
  }, [])

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

  const handleAssign = () => {
    setError(null)
    if (cards.length === 0) { setError('Add at least one team member.'); return }
    const invalid = cards.find((c) => c.days * 8 + c.hours <= 0)
    if (invalid) { setError(`Please enter estimated work time for ${invalid.username}.`); return }

    const assignments: HallMultiAssignEntry[] = cards.map((c) => {
      const posRaw = c.queuePosition.trim()
      const posNum = posRaw === '' ? undefined : parseInt(posRaw, 10)
      return {
        username: c.username,
        estimatedHours: c.days * 8 + c.hours,
        queuePosition: posNum && !isNaN(posNum) && posNum >= 1 ? posNum : undefined,
        assignmentNote: c.assignmentNote.trim() || undefined,
      }
    })

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
        <p className="text-sm text-slate-500">Redirecting to Hall Queue...</p>
      </div>
    )
  }

  const addedUsernames = new Set(cards.map((c) => c.username.toLowerCase()))

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 sm:px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-10">
        <button type="button" onClick={() => router.back()}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors flex-shrink-0">
          <ArrowLeft size={18} className="text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">Assign to Team</h1>
          <p className="text-xs sm:text-sm text-slate-500 truncate">{data.clusterName} &mdash; {data.task.title}</p>
        </div>
        {cards.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-700 font-medium flex-shrink-0">
            <Users size={12} />
            {cards.length} member{cards.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row flex-1 gap-0 min-h-0">
        {/* LEFT - member picker */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/50">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Team Members
                <span className="ml-1.5 normal-case font-normal text-slate-400">({allMembers.length})</span>
              </p>
              {isSupervisor && (
                <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">Dept only</span>
              )}
            </div>
            <input
              type="text"
              placeholder="Search members..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <div className="space-y-1.5 max-h-[40vh] lg:max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
              {filteredMembers.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8">
                  {isSupervisor ? 'No members in your department.' : 'No members found.'}
                </p>
              )}
              {filteredMembers.map((m) => {
                const isAdded = addedUsernames.has(m.username.toLowerCase())
                return (
                  <button key={m.username} type="button" disabled={isAdded} onClick={() => addMember(m.username)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all',
                      isAdded
                        ? 'border-violet-200 bg-violet-50 opacity-60 cursor-not-allowed'
                        : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer'
                    )}>
                    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: isAdded ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}>
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
                        <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full">{m.totalTasks}</span>
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

        {/* RIGHT - assignment cards */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 border-2 border-dashed border-slate-200 rounded-2xl">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Plus size={24} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-slate-600 font-medium">No members added yet</p>
                  <p className="text-sm text-slate-400 mt-1">Select team members from the left panel</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {cards.length} Member{cards.length !== 1 ? 's' : ''} - set time, queue position, and notes
                </p>
                {cards.map((card, index) => {
                  const member = allMembers.find((m) => m.username.toLowerCase() === card.username.toLowerCase())
                  const queueItems = queueStates[card.username] ?? []
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
                      queueItems={queueItems}
                      setQueueItems={(items) => setQueueStates((prev) => ({ ...prev, [card.username]: items }))}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* Sticky bottom bar */}
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
              <button type="button" disabled={loading || cards.length === 0} onClick={handleAssign}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all',
                  loading || cards.length === 0
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm active:scale-95'
                )}>
                <Users size={15} />
                {loading ? 'Assigning...' : `Assign to ${cards.length > 0 ? cards.length : ''} Member${cards.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}