'use client'

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import {
  X,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Paperclip,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Todo } from '@/types'
import { KPI_TYPES } from '@/types'
import {
  saveTodoAction,
  getPackagesForTaskForm,
  getUsersForAssignment,
  getDepartmentsForTaskForm,
} from '@/app/dashboard/tasks/actions'

interface Package {
  id: string
  name: string
  app_name: string | null
}

interface User {
  username: string
  role: string
  department: string | null
}

type TaskRouting = 'self' | 'department' | 'manager' | 'multi'

interface MultiAssignee {
  username: string
  delegated_to?: { username: string }[]
}

interface CreateTaskModalProps {
  editTask?: Todo | null
  onClose: () => void
  onSaved: () => void
}

export function CreateTaskModal({ editTask, onClose, onSaved }: CreateTaskModalProps) {
  const isEdit = !!editTask

  // ── Form fields ──
  const [appName, setAppName] = useState(editTask?.app_name ?? '')
  const [packageName, setPackageName] = useState(editTask?.package_name ?? '')
  const [kpiType, setKpiType] = useState(editTask?.kpi_type ?? '')
  const [title, setTitle] = useState(editTask?.title ?? '')
  const [description, setDescription] = useState(editTask?.description ?? '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    editTask?.priority ?? 'medium'
  )
  const [dueDate, setDueDate] = useState(
    editTask?.due_date ? editTask.due_date.slice(0, 16) : ''
  )
  const [notes, setNotes] = useState(editTask?.notes ?? '')
  const [routing, setRouting] = useState<TaskRouting>(() => {
    if (!editTask) return 'self'
    if (editTask.multi_assignment?.enabled) return 'multi'
    if (editTask.queue_status === 'queued') return 'department'
    if (editTask.assigned_to) return 'manager'
    return 'self'
  })

  // Department routing
  const [deptRoutingDept, setDeptRoutingDept] = useState(
    editTask?.queue_department ?? ''
  )

  // Manager routing
  const [assignedManager, setAssignedManager] = useState(
    editTask?.assigned_to ?? ''
  )

  // Multi-assignment
  const [multiAssignees, setMultiAssignees] = useState<MultiAssignee[]>(
    editTask?.multi_assignment?.assignees ?? []
  )
  const [multiSearch, setMultiSearch] = useState('')
  const [multiDeptFilter, setMultiDeptFilter] = useState('')

  const goalRef = useRef<HTMLDivElement>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  // ── Data loaders ──
  const [packages, setPackages] = useState<Package[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<string[]>([])

  useEffect(() => {
    Promise.all([
      getPackagesForTaskForm(),
      getUsersForAssignment(),
      getDepartmentsForTaskForm(),
    ]).then(([pkgs, usrs, depts]) => {
      setPackages(pkgs ?? [])
      setUsers(usrs ?? [])
      setDepartments(depts ?? [])
    })
  }, [])

  // Set initial our_goal HTML
  useEffect(() => {
    if (goalRef.current && editTask?.our_goal) {
      goalRef.current.innerHTML = editTask.our_goal
    }
  }, [editTask])

  // Packages filtered by selected app_name
  const filteredPackagesByApp = appName
    ? packages.filter((p) => p.app_name === appName)
    : packages

  // Auto-fill app_name when package_name is selected
  useEffect(() => {
    if (packageName) {
      const pkg = packages.find((p) => p.name === packageName)
      if (pkg?.app_name) setAppName(pkg.app_name)
    }
  }, [packageName, packages])

  // Rich-text toolbar
  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value)
    goalRef.current?.focus()
  }

  // Multi-assignee helpers
  const filteredUsersForMulti = users.filter((u) => {
    const matchSearch =
      !multiSearch ||
      u.username.toLowerCase().includes(multiSearch.toLowerCase())
    const matchDept = !multiDeptFilter || u.department === multiDeptFilter
    return matchSearch && matchDept
  })

  const toggleMultiAssignee = (username: string) => {
    setMultiAssignees((prev) =>
      prev.some((a) => a.username === username)
        ? prev.filter((a) => a.username !== username)
        : [...prev, { username }]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !packageName || !kpiType || !dueDate) {
      setError('Please fill in all required fields.')
      return
    }
    if (routing === 'department' && !deptRoutingDept) {
      setError('Please select a department for routing.')
      return
    }
    if (routing === 'manager' && !assignedManager) {
      setError('Please select a manager to assign to.')
      return
    }
    if (routing === 'multi' && multiAssignees.length === 0) {
      setError('Please select at least one assignee for multi-assignment.')
      return
    }
    setError('')

    const ourGoalHtml = goalRef.current?.innerHTML ?? ''

    startTransition(async () => {
      const res = await saveTodoAction({
        id: editTask?.id,
        app_name: appName,
        package_name: packageName,
        kpi_type: kpiType,
        title: title.trim().slice(0, 30),
        description,
        our_goal: ourGoalHtml,
        priority,
        due_date: dueDate,
        notes,
        routing,
        queue_department: routing === 'department' ? deptRoutingDept : undefined,
        assigned_to: routing === 'manager' ? assignedManager : undefined,
        multi_assignment:
          routing === 'multi'
            ? { enabled: true, assignees: multiAssignees }
            : undefined,
      })
      if (res.success) {
        onSaved()
        onClose()
      } else {
        setError(res.error ?? 'Failed to save task.')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', WebkitBackdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {isEdit ? 'Edit Task' : 'Create New Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                {error}
              </div>
            )}

            {/* App Name + Package Name */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="App Name">
                <select
                  value={appName}
                  onChange={(e) => { setAppName(e.target.value); setPackageName('') }}
                  className={selectCls}
                >
                  <option value="">Select App</option>
                  {[...new Set(packages.map((p) => p.app_name).filter(Boolean))].map(
                    (a) => <option key={a!} value={a!}>{a}</option>
                  )}
                </select>
              </Field>
              <Field label="Package Name" required>
                <select
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  className={selectCls}
                  required
                >
                  <option value="">Select Package</option>
                  {filteredPackagesByApp.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* KPI Type */}
            <Field label="KPI Type" required>
              <select
                value={kpiType}
                onChange={(e) => setKpiType(e.target.value)}
                className={selectCls}
                required
              >
                <option value="">Select KPI Type</option>
                {KPI_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>

            {/* Title */}
            <Field label={`Title (${title.length}/30)`} required>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 30))}
                placeholder="Task title..."
                className={inputCls}
                required
              />
            </Field>

            {/* Description */}
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description..."
                rows={2}
                className={cn(inputCls, 'resize-none')}
              />
            </Field>

            {/* Our Goal — rich text */}
            <Field label="Our Goal">
              <div className="border border-slate-200 rounded-xl overflow-hidden focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                {/* toolbar */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50">
                  {[
                    { icon: <Bold size={14}/>, cmd: 'bold', title: 'Bold' },
                    { icon: <Italic size={14}/>, cmd: 'italic', title: 'Italic' },
                    { icon: <Underline size={14}/>, cmd: 'underline', title: 'Underline' },
                    { icon: <List size={14}/>, cmd: 'insertUnorderedList', title: 'Bullet List' },
                    { icon: <ListOrdered size={14}/>, cmd: 'insertOrderedList', title: 'Numbered List' },
                  ].map(({ icon, cmd, title }) => (
                    <button
                      key={cmd}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); execCmd(cmd) }}
                      className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors"
                      title={title}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <div
                  ref={goalRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="min-h-[80px] px-3 py-2.5 text-sm text-slate-700 outline-none bg-white"
                  data-placeholder="Write your goals here..."
                  onInput={() => {}}
                />
              </div>
            </Field>

            {/* Priority + Due Date */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Priority" required>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                  className={selectCls}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
              <Field label="Due Date" required>
                <input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
            </div>

            {/* Task Routing (hidden in edit mode) */}
            {!isEdit && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Task Routing
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <RoutingCard
                    selected={routing === 'self'}
                    onClick={() => setRouting('self')}
                    color="yellow"
                    emoji="📝"
                    title="Self Todo"
                    desc="Add to your own task list"
                  />
                  <RoutingCard
                    selected={routing === 'department'}
                    onClick={() => setRouting('department')}
                    color="green"
                    emoji="🏢"
                    title="Department Queue"
                    desc="Send to a department queue"
                  />
                  <RoutingCard
                    selected={routing === 'manager'}
                    onClick={() => setRouting('manager')}
                    color="purple"
                    emoji="👤"
                    title="Send to Manager"
                    desc="Directly assign to a person"
                  />
                  <RoutingCard
                    selected={routing === 'multi'}
                    onClick={() => setRouting('multi')}
                    color="cyan"
                    emoji="👥"
                    title="Multi-Assignment"
                    desc="Assign to multiple people"
                  />
                </div>

                {/* Department routing details */}
                {routing === 'department' && (
                  <div className="mt-4 p-4 bg-green-50 rounded-xl border border-green-200">
                    <label className={labelCls}>Select Department</label>
                    <select
                      value={deptRoutingDept}
                      onChange={(e) => setDeptRoutingDept(e.target.value)}
                      className={cn(selectCls, 'bg-white')}
                    >
                      <option value="">Choose department...</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Manager routing details */}
                {routing === 'manager' && (
                  <div className="mt-4 p-4 bg-purple-50 rounded-xl border border-purple-200">
                    <label className={labelCls}>Assign To</label>
                    <select
                      value={assignedManager}
                      onChange={(e) => setAssignedManager(e.target.value)}
                      className={cn(selectCls, 'bg-white')}
                    >
                      <option value="">Select person...</option>
                      {users.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.username}
                          {u.department ? ` — ${u.department}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Multi-assignment details */}
                {routing === 'multi' && (
                  <div className="mt-4 p-4 bg-cyan-50 rounded-xl border border-cyan-200">
                    <div className="flex gap-2 mb-3">
                      <input
                        type="text"
                        placeholder="Search users..."
                        value={multiSearch}
                        onChange={(e) => setMultiSearch(e.target.value)}
                        className={cn(inputCls, 'flex-1 bg-white text-sm')}
                      />
                      <select
                        value={multiDeptFilter}
                        onChange={(e) => setMultiDeptFilter(e.target.value)}
                        className={cn(selectCls, 'bg-white text-sm')}
                      >
                        <option value="">All Depts</option>
                        {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {filteredUsersForMulti.map((u) => {
                        const checked = multiAssignees.some((a) => a.username === u.username)
                        return (
                          <label
                            key={u.username}
                            className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMultiAssignee(u.username)}
                              className="rounded text-blue-600"
                            />
                            <span className="text-sm text-slate-700">
                              {u.username}
                              {u.department && (
                                <span className="text-xs text-slate-400 ml-1">({u.department})</span>
                              )}
                            </span>
                          </label>
                        )
                      })}
                      {filteredUsersForMulti.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-2">No users found</p>
                      )}
                    </div>
                    {multiAssignees.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-cyan-200">
                        <p className="text-xs text-cyan-700 font-semibold">
                          Selected: {multiAssignees.map((a) => a.username).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
                className={cn(inputCls, 'resize-none')}
              />
            </Field>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isPending ? 'Saving...' : isEdit ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Helper components ──

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function RoutingCard({
  selected,
  onClick,
  color,
  emoji,
  title,
  desc,
}: {
  selected: boolean
  onClick: () => void
  color: 'yellow' | 'green' | 'purple' | 'cyan'
  emoji: string
  title: string
  desc: string
}) {
  const colors = {
    yellow: 'border-yellow-300 bg-yellow-50',
    green: 'border-green-300 bg-green-50',
    purple: 'border-purple-300 bg-purple-50',
    cyan: 'border-cyan-300 bg-cyan-50',
  }
  const selectedBorder = {
    yellow: 'ring-2 ring-yellow-400',
    green: 'ring-2 ring-green-400',
    purple: 'ring-2 ring-purple-400',
    cyan: 'ring-2 ring-cyan-400',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'p-4 rounded-xl border-2 text-left transition-all',
        colors[color],
        selected ? selectedBorder[color] : 'border-transparent opacity-60 hover:opacity-100'
      )}
    >
      <div className="text-xl mb-1">{emoji}</div>
      <div className="text-xs font-bold text-slate-800">{title}</div>
      <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
    </button>
  )
}

const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5'
const inputCls =
  'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 transition'
const selectCls =
  'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 transition bg-white'
