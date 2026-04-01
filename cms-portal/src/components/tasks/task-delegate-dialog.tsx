'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { OfficeDateTimePicker } from '@/components/ui/office-datetime-picker'
import { pakistanOfficeMinInputValue, validatePakistanOfficeDueDate } from '@/lib/pakistan-time'
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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastFocusedElementRef = useRef<HTMLElement | null>(null)
  const [departments, setDepartments] = useState<string[]>([])
  const [users, setUsers] = useState<AssignmentUser[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [instructions, setInstructions] = useState('')
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const loadAssignments = async () => {
      setIsLoading(true)
      setLoadError('')

      try {
        const [depts, assignableUsers] = await Promise.all([
          getDepartmentsForTaskForm(),
          getUsersForAssignment(),
        ])
        if (cancelled) return
        setDepartments(depts)
        setUsers(assignableUsers)
      } catch {
        if (cancelled) return
        setDepartments([])
        setUsers([])
        setLoadError('Unable to load assignable users right now.')
      } finally {
        if (cancelled) return
        setIsLoading(false)
      }
    }

    void loadAssignments()

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (open) return
    lastFocusedElementRef.current?.focus()
  }, [open])

  const resetState = () => {
    setSelectedUser('')
    setDueDate('')
    setInstructions('')
    setSearch('')
    setDeptFilter('')
    setLoadError('')
    setSubmitError('')
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        resetState()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      )

      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const departmentOptions = useMemo(() => {
    const fromUsers = new Set<string>()
    users.forEach((u) => {
      splitDepartmentsCsv(u.department || '').forEach((d) => {
        if (d.trim()) fromUsers.add(d.trim())
      })
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
      // deptFilter holds the canonical key (set as option value), so compare directly
      const matchesDepartment =
        !deptFilter ||
        splitDepartmentsCsv(user.department || '').some(
          (d) => canonicalDepartmentKey(d) === deptFilter
        )
      return matchesSearch && matchesDepartment
    })
  }, [currentUsername, deptFilter, search, users])

  const minimumDueDate = useMemo(() => {
    if (!open) return ''
    return pakistanOfficeMinInputValue()
  }, [open])

  const dueDateValidationError = dueDate ? validatePakistanOfficeDueDate(dueDate) : null
  const isDueDateValid = Boolean(dueDate) && !dueDateValidationError && dueDate >= minimumDueDate
  const canSubmit = Boolean(selectedUser) && isDueDateValid

  const submit = () => {
    if (!selectedUser) {
      setSubmitError('Select a user to continue.')
      return
    }
    if (selectedUser.toLowerCase() === currentUsername.toLowerCase()) {
      setSubmitError('You cannot delegate work to yourself.')
      return
    }
    if (!dueDate) {
      setSubmitError('Choose a due date to continue.')
      return
    }
    if (!isDueDateValid) {
      setSubmitError(dueDateValidationError || 'Choose a valid due date.')
      return
    }

    const toUsername = selectedUser
    const toDate = dueDate
    const toInstructions = instructions.trim() || undefined
    resetState()
    onDelegate(toUsername, toDate, toInstructions)
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delegate-task-title"
        aria-describedby="delegate-task-description"
        className="flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_28px_80px_rgba(15,23,42,0.22)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 id="delegate-task-title" className="text-xl font-bold tracking-[-0.02em] text-slate-900">
              Delegate Task Work
            </h3>
            <p id="delegate-task-description" className="mt-1 text-sm text-slate-500">
              Assign your portion of this task to another user with a due date and instructions.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label="Close delegation dialog"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {selectedUser ? (
            <div className="flex items-center justify-between rounded-[20px] border border-violet-200 bg-violet-50/60 px-4 py-3">
              <div>
                <div className="mb-0.5 text-xs font-bold uppercase tracking-[0.14em] text-violet-600">
                  Delegating To
                </div>
                <div className="text-sm font-semibold text-slate-900">{selectedUser}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedUser('')
                  setSubmitError('')
                }}
                className="rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-50"
              >
                Change
              </button>
            </div>
          ) : null}

          {submitError ? (
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {submitError}
            </div>
          ) : null}

          <div className="space-y-3 rounded-[22px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Due Date <span className="text-red-500">*</span>
              </span>
              <OfficeDateTimePicker
                value={dueDate}
                onChange={(v) => {
                  setDueDate(v)
                  setSubmitError('')
                }}
                min={minimumDueDate}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              {dueDate && !isDueDateValid ? (
                <span className="mt-1.5 block text-xs font-medium text-rose-600">
                  {dueDateValidationError || 'Due date must be in the future.'}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Delegation Instructions (optional)
              </span>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                placeholder="Explain what this person should do, what is already done, and any important context..."
                className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
          </div>

          <div className="rounded-[22px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Select User to Delegate To
            </div>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
              <label className="relative block">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
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
                  <option key={dept} value={canonicalDepartmentKey(dept)}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-[240px] overflow-y-auto rounded-[18px] border border-slate-100">
              {isLoading ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">Loading users...</div>
              ) : loadError ? (
                <div className="px-4 py-8 text-center text-sm font-medium text-rose-600">{loadError}</div>
              ) : filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No users match this filter.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredUsers.map((user) => {
                    const selected = selectedUser === user.username
                    return (
                      <button
                        key={user.username}
                        type="button"
                        onClick={() => {
                          setSelectedUser(user.username)
                          setSubmitError('')
                        }}
                        aria-pressed={selected}
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
                            {user.department || 'No department'}
                            {user.role ? ` | ${user.role}` : ''}
                          </div>
                        </div>
                        <div
                          className={cn(
                            'h-4 w-4 shrink-0 rounded-full border-2',
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

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-6 py-4">
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
            disabled={!canSubmit}
            className={cn(
              'rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700',
              !canSubmit && 'cursor-not-allowed opacity-50'
            )}
          >
            Delegate to {selectedUser || 'User'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
