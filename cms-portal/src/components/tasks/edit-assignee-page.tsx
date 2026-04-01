'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Clock, CheckCircle2, AlertCircle, AlertTriangle, UserX, ChevronDown, X } from 'lucide-react'
import type { EditAssigneePageData } from '@/app/dashboard/tasks/actions'
import {
  updateAssignmentStepAction,
  reassignTaskAction,
  removeHallTaskAssigneeAction,
} from '@/app/dashboard/tasks/actions'
import { calculateEffectiveDueAt, getWorkMinutesInRange } from '@/lib/hall-scheduler'
import type { HallOfficeHours } from '@/lib/pakistan-time'

function formatPKT(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

interface Props { data: EditAssigneePageData }

function initDaysHours(actualDueDate: string | null, oh: HallOfficeHours): { days: number; hours: number } {
  if (!actualDueDate) return { days: 0, hours: 0 }
  const now = new Date().toISOString()
  const due = new Date(actualDueDate)
  if (due <= new Date(now)) return { days: 0, hours: 0 }
  const dayH = Math.round(
    (parseHHMM(oh.office_end) - parseHHMM(oh.office_start) - (parseHHMM(oh.break_end) - parseHHMM(oh.break_start))) / 60
  )
  const totalWorkMins = getWorkMinutesInRange(now, actualDueDate, oh)
  const d = Math.floor(totalWorkMins / (dayH * 60))
  const h = Math.round((totalWorkMins % (dayH * 60)) / 60)
  return { days: d, hours: h }
}

export function EditAssigneePage({ data }: Props) {
  const router = useRouter()

  // Pre-populate days/hours from existing due date
  const oh = data.officeHours as HallOfficeHours
  const dayHours = Math.round(
    (parseHHMM(oh.office_end) - parseHHMM(oh.office_start) - (parseHHMM(oh.break_end) - parseHHMM(oh.break_start))) / 60
  )
  const fridayHours = Math.round(
    (parseHHMM(oh.office_end) - parseHHMM(oh.office_start) - (parseHHMM(oh.friday_break_end) - parseHHMM(oh.friday_break_start))) / 60
  )

  const initialDH = initDaysHours(data.actualDueDate, oh)
  const [days, setDays] = useState(initialDH.days)
  const [hours, setHours] = useState(initialDH.hours)

  const [note, setNote] = useState(data.stepNote ?? '')

  // Reassign dropdown state
  const [reassignSearch, setReassignSearch] = useState('')
  const [reassignTo, setReassignTo] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [removing, startRemove] = useTransition()

  const totalEstMins = (days * dayHours + hours) * 60
  const estimatedDue = totalEstMins > 0
    ? calculateEffectiveDueAt(new Date().toISOString(), totalEstMins, oh)
    : null

  // Filtered users list for dropdown
  const filteredUsers = useMemo(() => {
    const q = reassignSearch.toLowerCase()
    return data.availableUsers.filter(
      (u) =>
        u.username !== data.assignedTo &&
        (q === '' || u.username.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q))
    )
  }, [reassignSearch, data.availableUsers, data.assignedTo])

  const handleSave = () => {
    setError(null)
    if (totalEstMins <= 0 && !reassignTo) {
      setError('Please enter estimated work time (days and/or hours).')
      return
    }

    const dueIso = estimatedDue
      ? estimatedDue.toISOString()
      : new Date(Date.now() + dayHours * 3600_000).toISOString()

    if (reassignTo.trim()) {
      startSave(async () => {
        const res = await reassignTaskAction(data.taskId, reassignTo.trim(), note.trim() || undefined)
        if (res.success) { setSuccess('Task reassigned successfully.'); setTimeout(() => router.back(), 1400) }
        else setError(res.error ?? 'Failed to reassign.')
      })
    } else {
      startSave(async () => {
        const res = await updateAssignmentStepAction(data.taskId, data.assignedTo, dueIso, note.trim() || undefined)
        if (res.success) { setSuccess('Assignee step updated.'); setTimeout(() => router.back(), 1400) }
        else setError(res.error ?? 'Failed to update.')
      })
    }
  }

  const handleRemove = () => {
    setError(null)
    startRemove(async () => {
      const res = await removeHallTaskAssigneeAction(data.taskId)
      if (res.success) { setSuccess('Assignee removed. Task returned to inbox.'); setTimeout(() => router.back(), 1500) }
      else setError(res.error ?? 'Failed to remove assignee.')
    })
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <p className="text-lg font-semibold text-slate-800">{success}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
        <button type="button" onClick={() => router.back()}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
          <ArrowLeft size={18} className="text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">Edit Assignee Step</h1>
          <p className="text-sm text-slate-500 truncate">{data.title}</p>
        </div>
        {data.isHallTask && (
          <span className="hidden sm:block text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">
            Hall Queue Task
          </span>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 p-4 lg:p-6 max-w-3xl mx-auto w-full">
        {/* Main edit form */}
        <div className="flex-1 space-y-4">
          {/* Current assignee info */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Current Assignee</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {data.assignedTo.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-slate-800">{data.assignedTo}</p>
                {data.actualDueDate && (
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <Clock size={11} />
                    Current due: {formatPKT(data.actualDueDate)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Office hours info */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
            <p className="text-xs font-semibold text-blue-700 mb-1">Hall Office Hours</p>
            <p className="text-xs text-blue-600">
              Mon–Thu: {oh.office_start}–{oh.office_end} ({dayHours}h working) · Break: {oh.break_start}–{oh.break_end}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              Fri: {oh.office_start}–{oh.office_end} ({fridayHours}h working) · Break: {oh.friday_break_start}–{oh.friday_break_end}
            </p>
          </div>

          {/* Edit form */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="font-semibold text-slate-800">Update Step Details</h2>

            {/* Days + Hours input */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                Estimated Work Time <span className="text-slate-300 normal-case font-normal">(1 day = {dayHours}h · {oh.office_start}–{oh.office_end})</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Days</label>
                  <input
                    type="number" min={0} max={60} value={days}
                    onChange={(e) => setDays(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 text-center"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Hours</label>
                  <input
                    type="number" min={0} max={23} value={hours}
                    onChange={(e) => setHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 text-center"
                  />
                </div>
              </div>
              {estimatedDue && (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200">
                  <Clock size={13} className="text-emerald-600 flex-shrink-0" />
                  <p className="text-xs text-emerald-700 font-medium">Est. completion: {formatPKT(estimatedDue.toISOString())}</p>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
                Step Note <span className="text-slate-300 normal-case font-normal">(optional)</span>
              </label>
              <textarea rows={3} placeholder="Instructions or context for this assignee only…"
                value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
              />
            </div>

            {/* Reassign to different user — dropdown */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Reassign to Different User <span className="normal-case font-normal text-slate-400">(optional)</span>
              </p>
              <div className="relative">
                {reassignTo ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-300 bg-violet-50">
                    <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {reassignTo.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm font-medium text-violet-800">{reassignTo}</span>
                    <button type="button" onClick={() => { setReassignTo(''); setReassignSearch('') }}
                      className="p-0.5 rounded hover:bg-violet-200 transition-colors">
                      <X size={13} className="text-violet-600" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search user to reassign…"
                      value={reassignSearch}
                      onChange={(e) => { setReassignSearch(e.target.value); setDropdownOpen(true) }}
                      onFocus={() => setDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    {dropdownOpen && filteredUsers.length > 0 && (
                      <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {filteredUsers.map((u) => (
                          <button key={u.username} type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { setReassignTo(u.username); setReassignSearch(u.username); setDropdownOpen(false) }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {u.username.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{u.username}</p>
                              {u.department && <p className="text-xs text-slate-400 truncate">{u.department}</p>}
                            </div>
                            <span className="text-xs text-slate-400 flex-shrink-0">{u.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {reassignTo && (
                <p className="text-xs text-amber-700 mt-2 font-medium">⚠ Saving will reassign this task to <strong>{reassignTo}</strong></p>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => router.back()}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors">
                {saving ? 'Saving…' : reassignTo ? 'Reassign Task' : 'Save Changes'}
              </button>
            </div>
          </div>

          {/* Remove Assignee — danger zone */}
          <div className="rounded-2xl border border-red-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <UserX size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800 text-sm">Remove Assignee</p>
                <p className="text-xs text-red-600 mt-1">
                  {data.isHallTask
                    ? 'This will unassign the task and return it to the Hall inbox for re-assignment.'
                    : 'This will unassign the task from the current user.'}
                </p>
              </div>
            </div>
            {!confirmRemove ? (
              <button type="button" onClick={() => setConfirmRemove(true)}
                className="mt-4 w-full py-2.5 rounded-xl border border-red-300 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors">
                Remove {data.assignedTo} from this task
              </button>
            ) : (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
                  <p className="text-xs text-amber-700 font-medium">Are you sure? This cannot be undone.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmRemove(false)}
                    className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button type="button" onClick={handleRemove} disabled={removing}
                    className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors">
                    {removing ? 'Removing…' : 'Yes, Remove'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
