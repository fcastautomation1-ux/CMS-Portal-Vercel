'use client'

import { useState } from 'react'
import { X, User, Clock, AlertTriangle } from 'lucide-react'
import type { Todo, ClusterSettings } from '@/types'
import { assignHallInboxTaskWithSchedulerAction } from '@/app/dashboard/tasks/actions'
import { formatPakistanDateTime } from '@/lib/pakistan-time'

interface UserOption {
  username: string
  role: string
  department: string | null
  avatar_data: string | null
}

interface AssignHallTaskModalProps {
  task: Todo
  users: UserOption[]
  hallSettings: ClusterSettings
  onClose: () => void
  onSuccess: () => void
  /** Scoped departments for supervisor callers; null/undefined = no restriction */
  supervisorScopedDepts?: string[] | null
}

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', color: 'text-red-600' },
  { value: 'high',   label: 'High',   color: 'text-orange-500' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
  { value: 'low',    label: 'Low',    color: 'text-green-600' },
]

export function AssignHallTaskModal({
  task,
  users,
  hallSettings,
  onClose,
  onSuccess,
  supervisorScopedDepts,
}: AssignHallTaskModalProps) {
  const [assignee, setAssignee]           = useState('')
  const [priority, setPriority]           = useState<string>(task.priority ?? 'medium')
  const [estimatedHours, setEstimatedHours] = useState<string>('')
  const [note, setNote]                   = useState('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  // Filter users by supervisor scope if applicable
  const availableUsers = supervisorScopedDepts && supervisorScopedDepts.length > 0
    ? users.filter((u) => {
        if (!u.department) return false
        return u.department
          .split(',')
          .some((d) => supervisorScopedDepts.includes(d.trim()))
      })
    : users

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!assignee)             return setError('Please select an assignee.')
    const hrs = parseFloat(estimatedHours)
    if (!estimatedHours || isNaN(hrs) || hrs <= 0) return setError('Estimated hours must be a positive number.')
    if (hrs > 500)             return setError('Estimated hours cannot exceed 500.')

    setLoading(true)
    const res = await assignHallInboxTaskWithSchedulerAction(
      task.id,
      assignee,
      priority,
      hrs,
      note.trim() || undefined,
    )
    setLoading(false)

    if (res.success) {
      onSuccess()
    } else {
      setError(res.error ?? 'Assignment failed.')
    }
  }

  const requestedDueAt = task.requested_due_at ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Assign Hall Task</h2>
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{task.title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Info strip */}
        {requestedDueAt && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
            <Clock className="h-4 w-4 text-blue-500 shrink-0" />
            <span className="text-blue-700 dark:text-blue-300">
              <strong>Sender deadline:</strong> {formatPakistanDateTime(requestedDueAt)}
            </span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Assignee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Assignee <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select team member…</option>
                {availableUsers.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username} {u.department ? `— ${u.department}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {supervisorScopedDepts && supervisorScopedDepts.length > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                Showing users in your scoped departments: {supervisorScopedDepts.join(', ')}
              </p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Priority <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPriority(opt.value)}
                  className={`py-2 rounded-lg text-sm font-medium border transition-all ${
                    priority === opt.value
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Estimated Hours */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Estimated work hours <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="number"
                min="0.25"
                max="500"
                step="0.25"
                placeholder="e.g. 4 or 1.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Work estimate is separate from the sender&apos;s deadline. Time counts only during office hours.
            </p>
          </div>

          {/* Queue behaviour notice */}
          {hallSettings.single_active_task_per_user && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <strong>Single-task mode active.</strong> If the assignee already has an active task,
                this task will enter their queue and auto-start when the current one completes.
              </p>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Note <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="Any context for the assignee…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            {loading ? 'Assigning…' : 'Assign Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
