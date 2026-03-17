'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, Search, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  getDepartmentsForTaskForm,
  getUsersForAssignment,
} from '@/app/dashboard/tasks/actions'

type AssignmentUser = {
  username: string
  role: string
  department: string | null
  avatar_data: string | null
}

type HandoffMode = 'department' | 'multi'

interface TaskHandoffDialogProps {
  open: boolean
  currentUsername: string
  currentAssignee?: string | null
  onClose: () => void
  onAssignDepartment: (department: string, dueDate: string, reason?: string) => void
  onAssignMulti: (assignees: Array<{ username: string; actual_due_date: string }>) => void
}

export function TaskHandoffDialog({
  open,
  currentUsername,
  currentAssignee,
  onClose,
  onAssignDepartment,
  onAssignMulti,
}: TaskHandoffDialogProps) {
  const [mode, setMode] = useState<HandoffMode>('department')
  const [departments, setDepartments] = useState<string[]>([])
  const [users, setUsers] = useState<AssignmentUser[]>([])
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [userDueDates, setUserDueDates] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([getDepartmentsForTaskForm(), getUsersForAssignment()]).then(([depts, assignableUsers]) => {
      if (cancelled) return
      setDepartments(depts)
      setUsers(assignableUsers)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const resetState = () => {
    setMode('department')
    setSelectedDepartment('')
    setDueDate('')
    setReason('')
    setSearch('')
    setDeptFilter('')
    setSelectedUsers([])
    setUserDueDates({})
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (user.username === currentUsername) return false
      if (currentAssignee && user.username === currentAssignee) return false
      const matchesSearch =
        !search ||
        user.username.toLowerCase().includes(search.toLowerCase()) ||
        (user.department || '').toLowerCase().includes(search.toLowerCase()) ||
        (user.role || '').toLowerCase().includes(search.toLowerCase())
      const matchesDepartment = !deptFilter || user.department === deptFilter
      return matchesSearch && matchesDepartment
    })
  }, [currentAssignee, currentUsername, deptFilter, search, users])

  const toggleUser = (username: string) => {
    setSelectedUsers((current) => {
      if (current.includes(username)) {
        setUserDueDates((existing) => {
          const next = { ...existing }
          delete next[username]
          return next
        })
        return current.filter((item) => item !== username)
      }

      setUserDueDates((existing) => ({
        ...existing,
        [username]: existing[username] || dueDate || '',
      }))
      return [...current, username]
    })
  }

  const updateUserDueDate = (username: string, value: string) => {
    setUserDueDates((current) => ({
      ...current,
      [username]: value,
    }))
  }

  const submit = () => {
    if (mode === 'department') {
      if (!selectedDepartment || !dueDate) return
      resetState()
      onAssignDepartment(selectedDepartment, dueDate, reason.trim() || undefined)
      return
    }
    if (selectedUsers.length === 0) return
    const assignees = selectedUsers.map((username) => ({
      username,
      actual_due_date: userDueDates[username] || '',
    }))
    if (assignees.some((entry) => !entry.actual_due_date)) return
    resetState()
    onAssignMulti(assignees)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
        <div className="border-b border-slate-100 px-6 py-5">
          <h3 className="text-xl font-bold tracking-[-0.02em] text-slate-900">Assign To Next</h3>
          <p className="mt-1 text-sm text-slate-500">Choose how this task should move forward in the workflow.</p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('department')}
              className={cn(
                'rounded-[22px] border px-5 py-5 text-left transition-all',
                mode === 'department'
                  ? 'border-emerald-300 bg-emerald-50/70 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.18)]'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              )}
            >
              <div className="mb-3 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                Dept
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-900">Assign to Department</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Send this task into a department queue so someone from that department can pick it.</p>
                </div>
                <Building2 size={18} className={cn(mode === 'department' ? 'text-emerald-600' : 'text-slate-300')} />
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode('multi')}
              className={cn(
                'rounded-[22px] border px-5 py-5 text-left transition-all',
                mode === 'multi'
                  ? 'border-cyan-300 bg-cyan-50/70 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.18)]'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              )}
            >
              <div className="mb-3 inline-flex rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-700">
                Team
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-900">Multi-User Assign</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Assign this task to multiple users and show them together in the task card workflow.</p>
                </div>
                <Users size={18} className={cn(mode === 'multi' ? 'text-cyan-600' : 'text-slate-300')} />
              </div>
            </button>
          </div>

          {mode === 'department' ? (
            <div className="rounded-[24px] border border-emerald-100 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="grid gap-4 md:grid-cols-[1.05fr_0.95fr]">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Department Queue</span>
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Due Date</span>
                  <input
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    type="datetime-local"
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Reason (optional)</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={4}
                    placeholder="Add routing notes for the next department..."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="rounded-[24px] border border-cyan-100 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
                <label className="relative block flex-1">
                  <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search users..."
                    className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  />
                </label>
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 md:w-64"
                >
                  <option value="">All Departments</option>
                  {departments.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </div>

              {selectedUsers.length > 0 && (
                <div className="mb-4 space-y-3 rounded-[20px] border border-cyan-100 bg-cyan-50/50 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Selected Assignees</div>
                  {selectedUsers.map((username) => (
                    <div key={username} className="grid gap-3 rounded-2xl border border-cyan-100 bg-white p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{username}</div>
                        <div className="mt-1 text-xs text-slate-500">Set an individual due date for this assignee.</div>
                      </div>
                      <input
                        value={userDueDates[username] || ''}
                        onChange={(e) => updateUserDueDate(username, e.target.value)}
                        type="datetime-local"
                        min={new Date().toISOString().slice(0, 16)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                      />
                      <button
                        type="button"
                        onClick={() => toggleUser(username)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="max-h-[320px] overflow-y-auto rounded-[20px] border border-slate-200">
                {filteredUsers.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">No users match this filter.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredUsers.map((user) => {
                      const selected = selectedUsers.includes(user.username)
                      return (
                        <button
                          key={user.username}
                          type="button"
                          onClick={() => toggleUser(user.username)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
                            selected ? 'bg-cyan-50' : 'bg-white hover:bg-slate-50'
                          )}
                        >
                          <div className="min-w-0">
                            <div className={cn('text-sm font-semibold', selected ? 'text-cyan-800' : 'text-slate-800')}>{user.username}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {user.department || 'No department'}{user.role ? ` (${user.role})` : ''}
                            </div>
                          </div>
                          <div className={cn('h-5 w-5 rounded-md border', selected ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300 bg-white')} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mode === 'department' ? (!selectedDepartment || !dueDate) : (selectedUsers.length === 0 || selectedUsers.some((username) => !userDueDates[username]))}
            className={cn(
              'rounded-2xl px-5 py-2.5 text-sm font-semibold text-white transition',
              mode === 'department' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-cyan-600 hover:bg-cyan-700',
              (mode === 'department' ? (!selectedDepartment || !dueDate) : (selectedUsers.length === 0 || selectedUsers.some((username) => !userDueDates[username]))) && 'cursor-not-allowed opacity-50'
            )}
          >
            {mode === 'department' ? 'Send to Department' : `Assign ${selectedUsers.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}
