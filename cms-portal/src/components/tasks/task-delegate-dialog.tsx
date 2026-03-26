'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { pakistanNowInputValue } from '@/lib/pakistan-time'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'
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

interface TaskDelegateDialogProps {
  open: boolean
  currentUsername: string
  onClose: () => void
  onDelegate: (toUsername: string, dueDate: string, instructions?: string) => void
}

export function TaskDelegateDialog({
  open,
  currentUsername,
  onClose,
  onDelegate,
}: TaskDelegateDialogProps) {
  const [departments, setDepartments] = useState<string[]>([])
  const [users, setUsers] = useState<AssignmentUser[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [instructions, setInstructions] = useState('')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([getDepartmentsForTaskForm(), getUsersForAssignment()]).then(([depts, assignableUsers]) => {
      if (cancelled) return
      setDepartments(depts)
      setUsers(assignableUsers)
    })
    return () => { cancelled = true }
  }, [open])

  const resetState = () => {
    setSelectedUser('')
    setDueDate('')
    setInstructions('')
    setSearch('')
    setDeptFilter('')
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const departmentOptions = useMemo(() => {
    const fromUsers = new Set<string>()
    users.forEach((u) => {
      splitDepartmentsCsv(u.department || '').forEach((d) => { if (d.trim()) fromUsers.add(d.trim()) })
    })
    const all = Array.from(new Set([...departments, ...Array.from(fromUsers)]))
    all.sort((a, b) => a.localeCompare(b))
    return all
  }, [departments, users])

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (user.username === currentUsername) return false
      const matchesSearch =
        !search ||
        user.username.toLowerCase().includes(search.toLowerCase()) ||
        (user.department || '').toLowerCase().includes(search.toLowerCase()) ||
        (user.role || '').toLowerCase().includes(search.toLowerCase())
      const matchesDepartment =
        !deptFilter ||
        splitDepartmentsCsv(user.department || '').some(
          (d) => canonicalDepartmentKey(d) === canonicalDepartmentKey(deptFilter)
        ) ||
        (user.department || '').toLowerCase().includes(deptFilter.toLowerCase())
      return matchesSearch && matchesDepartment
    })
  }, [currentUsername, deptFilter, search, users])

  const submit = () => {
    if (!selectedUser || !dueDate) return
    const toUsername = selectedUser
    const toDate = dueDate
    const toInstructions = instructions.trim() || undefined
    resetState()
    onDelegate(toUsername, toDate, toInstructions)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div
        className="w-full max-w-2xl flex flex-col overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_28px_80px_rgba(15,23,42,0.22)]"
        style={{ maxHeight: 'min(90vh, 720px)' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-xl font-bold tracking-[-0.02em] text-slate-900">Delegate Task Work</h3>
            <p className="mt-1 text-sm text-slate-500">Assign your portion of this task to another user with a due date and instructions.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-6 py-5">
          {/* Selected user summary */}
          {selectedUser && (
            <div className="flex items-center justify-between rounded-[20px] border border-violet-200 bg-violet-50/60 px-4 py-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-violet-600 mb-0.5">Delegating To</div>
                <div className="text-sm font-semibold text-slate-900">{selectedUser}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser('')}
                className="rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-50"
              >
                Change
              </button>
            </div>
          )}

          {/* Due date + instructions */}
          <div className="rounded-[22px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)] space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Due Date <span className="text-red-500">*</span></span>
              <input
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                type="datetime-local"
                min={pakistanNowInputValue()}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Delegation Instructions (optional)</span>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                placeholder="Explain what this person should do, what is already done, and any important context..."
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none"
              />
            </label>
          </div>

          {/* User search + filter */}
          <div className="rounded-[22px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-3">Select User to Delegate To</div>
            <div className="mb-3 grid gap-3 grid-cols-1 sm:grid-cols-[1fr_180px]">
              <label className="relative block">
                <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or department..."
                  className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                <option value="">All Departments</option>
                {departmentOptions.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            <div className="max-h-[240px] overflow-y-auto rounded-[18px] border border-slate-100">
              {filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No users match this filter.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredUsers.map((user) => {
                    const selected = selectedUser === user.username
                    return (
                      <button
                        key={user.username}
                        type="button"
                        onClick={() => setSelectedUser(user.username)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
                          selected ? 'bg-violet-50' : 'bg-white hover:bg-slate-50'
                        )}
                      >
                        <div className="min-w-0">
                          <div className={cn('text-sm font-semibold', selected ? 'text-violet-800' : 'text-slate-800')}>
                            {user.username}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {user.department || 'No department'}{user.role ? ` · ${user.role}` : ''}
                          </div>
                        </div>
                        <div
                          className={cn(
                            'h-4 w-4 rounded-full border-2 shrink-0',
                            selected ? 'border-violet-500 bg-violet-500' : 'border-slate-300 bg-white'
                          )}
                        />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
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
            disabled={!selectedUser || !dueDate}
            className={cn(
              'rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700',
              (!selectedUser || !dueDate) && 'cursor-not-allowed opacity-50'
            )}
          >
            Delegate to {selectedUser || 'User'}
          </button>
        </div>
      </div>
    </div>
  )
}
