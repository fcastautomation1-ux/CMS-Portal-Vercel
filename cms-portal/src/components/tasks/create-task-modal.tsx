'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  Bold,
  ChevronDown,
  FileText,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Underline,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { createBrowserClient } from '@/lib/supabase/client'
import type { MultiAssignmentEntry, Todo } from '@/types'
import { KPI_TYPES } from '@/types'
import {
  getDepartmentsForTaskForm,
  getPackagesForTaskForm,
  getUsersForAssignment,
  saveTodoAction,
  saveTodoAttachmentAction,
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

type PendingAttachment = {
  file: File
  id: string
}

type TemplateKey = 'meeting' | 'project' | 'followup'

type DraftPayload = {
  appName: string
  packageName: string
  kpiType: string
  title: string
  description: string
  ourGoal: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate: string
  notes: string
  routing: TaskRouting
  deptRoutingDept: string
  assignedManager: string
  multiAssignees: MultiAssignmentEntry[]
}

const DRAFT_STORAGE_PREFIX = 'task-modal-draft-v3'
const TASK_ATTACHMENTS_BUCKET = 'task-attachments'

const TEMPLATES: Record<TemplateKey, Partial<DraftPayload>> = {
  meeting: {
    title: 'Team Meeting',
    description: 'Discuss project progress and next steps',
    priority: 'high',
  },
  project: {
    title: 'New Project',
    description: 'Project description and requirements',
    priority: 'medium',
  },
  followup: {
    title: 'Follow-up Task',
    description: 'Follow up on previous conversation',
    priority: 'medium',
  },
}

interface CreateTaskModalProps {
  editTask?: Todo | null
  onClose: () => void
  onSaved: () => void
}

export function CreateTaskModal({ editTask, onClose, onSaved }: CreateTaskModalProps) {
  const isEdit = !!editTask
  const draftKey = `${DRAFT_STORAGE_PREFIX}:${editTask?.id ?? 'new'}`
  const initialDraft = readDraft(draftKey)
  const goalRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()

  const [appName, setAppName] = useState(initialDraft?.appName ?? editTask?.app_name ?? '')
  const [packageName, setPackageName] = useState(initialDraft?.packageName ?? editTask?.package_name ?? '')
  const [kpiType, setKpiType] = useState(initialDraft?.kpiType ?? editTask?.kpi_type ?? '')
  const [title, setTitle] = useState(initialDraft?.title ?? editTask?.title ?? '')
  const [description, setDescription] = useState(initialDraft?.description ?? editTask?.description ?? '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    initialDraft?.priority ?? editTask?.priority ?? 'medium'
  )
  const [dueDate, setDueDate] = useState(
    initialDraft?.dueDate ??
      (editTask?.expected_due_date
        ? editTask.expected_due_date.slice(0, 16)
        : editTask?.due_date
          ? editTask.due_date.slice(0, 16)
          : '')
  )
  const [notes, setNotes] = useState(initialDraft?.notes ?? editTask?.notes ?? '')
  const [routing, setRouting] = useState<TaskRouting>(() => {
    if (initialDraft?.routing) return initialDraft.routing
    if (!editTask) return 'self'
    if (editTask.multi_assignment?.enabled) return 'multi'
    if (editTask.queue_status === 'queued') return 'department'
    if (editTask.assigned_to) return 'manager'
    return 'self'
  })
  const [deptRoutingDept, setDeptRoutingDept] = useState(initialDraft?.deptRoutingDept ?? editTask?.queue_department ?? '')
  const [assignedManager, setAssignedManager] = useState(initialDraft?.assignedManager ?? editTask?.assigned_to ?? '')
  const [multiAssignees, setMultiAssignees] = useState<MultiAssignmentEntry[]>(
    initialDraft?.multiAssignees ?? editTask?.multi_assignment?.assignees ?? []
  )
  const [multiSearch, setMultiSearch] = useState('')
  const [multiDeptFilter, setMultiDeptFilter] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [error, setError] = useState('')

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

  useEffect(() => {
    if (!goalRef.current) return
    goalRef.current.innerHTML = initialDraft?.ourGoal ?? editTask?.our_goal ?? ''
  }, [editTask, initialDraft?.ourGoal])

  useEffect(() => {
    const snapshot: DraftPayload = {
      appName,
      packageName,
      kpiType,
      title,
      description,
      ourGoal: goalRef.current?.innerHTML ?? '',
      priority,
      dueDate,
      notes,
      routing,
      deptRoutingDept,
      assignedManager,
      multiAssignees,
    }
    window.localStorage.setItem(draftKey, JSON.stringify(snapshot))
  }, [
    appName,
    assignedManager,
    deptRoutingDept,
    description,
    draftKey,
    dueDate,
    kpiType,
    multiAssignees,
    notes,
    packageName,
    priority,
    routing,
    title,
  ])

  const managerUsers = useMemo(
    () =>
      users.filter((user) =>
        ['Admin', 'Super Manager', 'Manager', 'Supervisor'].includes(user.role)
      ),
    [users]
  )

  const availableApps = useMemo(
    () =>
      [...new Set(packages.map((item) => item.app_name).filter(Boolean))].sort() as string[],
    [packages]
  )

  const filteredPackagesByApp = useMemo(
    () => (appName ? packages.filter((item) => item.app_name === appName) : packages),
    [appName, packages]
  )

  const filteredUsersForMulti = useMemo(
    () =>
      users.filter((user) => {
        const matchSearch =
          !multiSearch ||
          user.username.toLowerCase().includes(multiSearch.toLowerCase())
        const matchDept = !multiDeptFilter || user.department === multiDeptFilter
        return matchSearch && matchDept
      }),
    [multiDeptFilter, multiSearch, users]
  )

  const execCmd = (cmd: string) => {
    document.execCommand(cmd, false)
    goalRef.current?.focus()
  }

  const toggleMultiAssignee = (user: User) => {
    setMultiAssignees((current) => {
      const exists = current.some((entry) => entry.username === user.username)
      if (exists) {
        return current.filter((entry) => entry.username !== user.username)
      }
      return [
        ...current,
        {
          username: user.username,
          status: 'pending',
          actual_due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        },
      ]
    })
  }

  const setMultiAssigneeDueDate = (username: string, value: string) => {
    setMultiAssignees((current) =>
      current.map((entry) =>
        entry.username === username
          ? {
              ...entry,
              actual_due_date: value ? new Date(value).toISOString() : undefined,
            }
          : entry
      )
    )
  }

  const applyTemplate = (templateKey: TemplateKey) => {
    const template = TEMPLATES[templateKey]
    if (!template) return
    setTitle(template.title ?? '')
    setDescription(template.description ?? '')
    setPriority(template.priority ?? 'medium')
    if (goalRef.current) {
      goalRef.current.innerHTML = template.ourGoal ?? ''
    }
    setTemplatesOpen(false)
  }

  const onAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        id: `${file.name}-${file.size}-${file.lastModified}`,
      })),
    ])
    event.target.value = ''
  }

  const uploadAttachments = async (todoId: string) => {
    if (!pendingAttachments.length) return

    const supabase = createBrowserClient()
    for (const attachment of pendingAttachments) {
      const ext = attachment.file.name.includes('.')
        ? attachment.file.name.split('.').pop()
        : undefined
      const storagePath = `todos/${todoId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
      const upload = await supabase.storage
        .from(TASK_ATTACHMENTS_BUCKET)
        .upload(storagePath, attachment.file, { upsert: false })

      if (upload.error) {
        throw new Error(`Attachment upload failed for ${attachment.file.name}: ${upload.error.message}`)
      }

      const saveAttachment = await saveTodoAttachmentAction({
        todo_id: todoId,
        file_name: attachment.file.name,
        file_size: attachment.file.size,
        mime_type: attachment.file.type || null,
        storage_path: storagePath,
      })

      if (!saveAttachment.success) {
        throw new Error(saveAttachment.error ?? `Failed to link ${attachment.file.name}`)
      }
    }
  }

  const validate = () => {
    if (!kpiType) return 'Please select a KPI type.'
    if (!title.trim()) return 'Please enter a task title.'
    if (title.trim().length < 3) return 'Title must be at least 3 characters.'
    if (!packageName) return 'Please select a package.'
    if (routing !== 'self' && routing !== 'multi' && !dueDate) {
      return 'Please set a due date for this task.'
    }
    if (routing === 'department' && !deptRoutingDept) {
      return 'Please select a department for routing.'
    }
    if (routing === 'manager' && !assignedManager) {
      return 'Please select a manager.'
    }
    if (routing === 'multi' && multiAssignees.length === 0) {
      return 'Please select at least one user for multi-assignment.'
    }
    if (routing === 'multi') {
      const missing = multiAssignees.filter((entry) => !entry.actual_due_date)
      if (missing.length) {
        return `Please set an individual deadline for: ${missing.map((entry) => entry.username).join(', ')}`
      }
    }
    return ''
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextError = validate()
    if (nextError) {
      setError(nextError)
      return
    }

    setError('')
    const ourGoalHtml = goalRef.current?.innerHTML ?? ''

    startTransition(async () => {
      const result = await saveTodoAction({
        id: editTask?.id,
        app_name: appName,
        package_name: packageName || 'Others',
        kpi_type: kpiType,
        title: title.trim().slice(0, 30),
        description,
        our_goal: ourGoalHtml,
        priority,
        due_date: routing === 'multi' ? undefined : dueDate || undefined,
        notes,
        routing,
        queue_department: routing === 'department' ? deptRoutingDept : undefined,
        assigned_to: routing === 'manager' ? assignedManager : undefined,
        manager_id: routing === 'manager' ? assignedManager : undefined,
        multi_assignment:
          routing === 'multi'
            ? {
                enabled: true,
                created_by: editTask?.username,
                assignees: multiAssignees,
              }
            : undefined,
      })

      if (!result.success || !result.id) {
        setError(result.error ?? 'Failed to save task.')
        return
      }

      try {
        await uploadAttachments(result.id)
      } catch (attachmentError) {
        setError(
          attachmentError instanceof Error
            ? attachmentError.message
            : 'Task saved but attachment upload failed.'
        )
        return
      }

      window.localStorage.removeItem(draftKey)
      setPendingAttachments([])
      onSaved()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] px-4 py-6 backdrop-blur-[4px]">
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(18px) saturate(180%)',
          WebkitBackdropFilter: 'blur(18px) saturate(180%)',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 24px 70px rgba(15,23,42,0.14)',
        }}
      >
        <div className="h-1.5 w-full bg-[linear-gradient(90deg,var(--blue-500),#7c93ff)]" />
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="pr-4">
            <h2 className="text-xl font-bold tracking-[-0.02em] text-slate-900">
              {isEdit ? 'Edit Task' : 'Create New Task'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Create work in the same routing flow used across the portal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isEdit && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTemplatesOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <FileText size={14} />
                  Templates
                  <ChevronDown size={14} />
                </button>
                {templatesOpen && (
                  <div className="absolute right-0 top-12 z-10 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    <TemplateOption title="Team Meeting" onClick={() => applyTemplate('meeting')} />
                    <TemplateOption title="New Project" onClick={() => applyTemplate('project')} />
                    <TemplateOption title="Follow-up Task" onClick={() => applyTemplate('followup')} />
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto bg-slate-50/60">
          <div className="space-y-5 px-6 py-5">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <SectionCard
              title="Task Basics"
              description="Core task details, package binding, and the shared goal text."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="App Name">
                  <select
                    value={appName}
                    onChange={(event) => {
                      setAppName(event.target.value)
                      setPackageName('')
                    }}
                    className={selectCls}
                  >
                    <option value="">Select App</option>
                    {availableApps.map((app) => (
                      <option key={app} value={app}>
                        {app}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Package Name" required>
                  <select
                    value={packageName}
                    onChange={(event) => {
                      const nextPackage = event.target.value
                      setPackageName(nextPackage)
                      const pkg = packages.find((item) => item.name === nextPackage)
                      if (pkg?.app_name) setAppName(pkg.app_name)
                    }}
                    className={selectCls}
                  >
                    <option value="">Select Package</option>
                    {filteredPackagesByApp.map((pkg) => (
                      <option key={pkg.id} value={pkg.name}>
                        {pkg.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="KPI Type" required>
                <select
                  value={kpiType}
                  onChange={(event) => setKpiType(event.target.value)}
                  className={selectCls}
                >
                  <option value="">Select KPI Type</option>
                  {KPI_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={`Title (${title.length}/30)`} required>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value.slice(0, 30))}
                  placeholder="What needs to be done?"
                  className={inputCls}
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="Add more details..."
                  className={cn(inputCls, 'resize-none')}
                />
              </Field>

              <Field label="Our Goal">
                <div className="overflow-hidden rounded-xl border border-slate-200 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                  <div className="flex items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2">
                    {[
                      { icon: <Bold size={14} />, cmd: 'bold', title: 'Bold' },
                      { icon: <Italic size={14} />, cmd: 'italic', title: 'Italic' },
                      { icon: <Underline size={14} />, cmd: 'underline', title: 'Underline' },
                      { icon: <List size={14} />, cmd: 'insertUnorderedList', title: 'Bullet List' },
                      { icon: <ListOrdered size={14} />, cmd: 'insertOrderedList', title: 'Numbered List' },
                    ].map(({ icon, cmd, title }) => (
                      <button
                        key={cmd}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          execCmd(cmd)
                        }}
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-slate-800"
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
                    className="min-h-32 bg-white px-3 py-3 text-sm text-slate-700 outline-none"
                  />
                </div>
              </Field>
            </SectionCard>

            <SectionCard
              title="Timing & Routing"
              description="Choose urgency and decide where the task should flow next."
            >
              <div className={cn('grid gap-4', routing === 'multi' ? 'md:grid-cols-1' : 'md:grid-cols-2')}>
                <Field label="Priority">
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as typeof priority)}
                    className={selectCls}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Field>

                {routing !== 'multi' && (
                  <Field label={`Due Date${routing === 'self' ? '' : ' *'}`}>
                    <input
                      type="datetime-local"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>

              <div>
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Task Routing
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <RoutingCard
                    selected={routing === 'self'}
                    onClick={() => setRouting('self')}
                    color="yellow"
                    emoji="Self"
                    title="Self Todo"
                    desc="Create this task for yourself"
                  />
                  <RoutingCard
                    selected={routing === 'department'}
                    onClick={() => setRouting('department')}
                    color="green"
                    emoji="Dept"
                    title="Department Queue"
                    desc="Route to a department queue"
                  />
                  <RoutingCard
                    selected={routing === 'manager'}
                    onClick={() => setRouting('manager')}
                    color="purple"
                    emoji="Mgr"
                    title="Send to Manager"
                    desc="Assign directly to a manager"
                  />
                  <RoutingCard
                    selected={routing === 'multi'}
                    onClick={() => setRouting('multi')}
                    color="cyan"
                    emoji="Team"
                    title="Multi-Assignment"
                    desc="Assign to multiple users with individual deadlines"
                  />
                </div>

                {routing === 'department' && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <Field label="Department">
                    <select
                      value={deptRoutingDept}
                      onChange={(event) => setDeptRoutingDept(event.target.value)}
                      className={cn(selectCls, 'bg-white')}
                    >
                      <option value="">Choose department...</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </Field>
                  </div>
                )}

                {routing === 'manager' && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <Field label="Assign To">
                    <select
                      value={assignedManager}
                      onChange={(event) => setAssignedManager(event.target.value)}
                      className={cn(selectCls, 'bg-white')}
                    >
                      <option value="">Select manager...</option>
                      {managerUsers.map((user) => (
                        <option key={user.username} value={user.username}>
                          {user.username}
                          {user.department ? ` - ${user.department}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  </div>
                )}

                {routing === 'multi' && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row">
                    <input
                      value={multiSearch}
                      onChange={(event) => setMultiSearch(event.target.value)}
                      placeholder="Search users..."
                      className={cn(inputCls, 'bg-white')}
                    />
                    <select
                      value={multiDeptFilter}
                      onChange={(event) => setMultiDeptFilter(event.target.value)}
                      className={cn(selectCls, 'bg-white md:w-56')}
                    >
                      <option value="">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                    {filteredUsersForMulti.map((user) => {
                      const checked = multiAssignees.some((entry) => entry.username === user.username)
                      return (
                        <label
                          key={user.username}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMultiAssignee(user)}
                            className="rounded text-cyan-600"
                          />
                          <span className="text-sm text-slate-700">
                            {user.username}
                            {user.department ? (
                              <span className="ml-1 text-xs text-slate-400">({user.department})</span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>

                  {multiAssignees.length > 0 && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Individual Deadlines
                      </p>
                      <div className="space-y-2">
                        {multiAssignees.map((entry) => (
                          <div
                            key={entry.username}
                            className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_220px]"
                          >
                            <div className="text-sm font-semibold text-slate-800">{entry.username}</div>
                            <input
                              type="datetime-local"
                              value={toInputDate(entry.actual_due_date)}
                              onChange={(event) =>
                                setMultiAssigneeDueDate(entry.username, event.target.value)
                              }
                              className={inputCls}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Notes & Files"
              description="Context, references, and upload items that should travel with the task."
            >
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  placeholder="Additional notes..."
                  className={cn(inputCls, 'resize-none')}
                />
              </Field>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Attachments</h3>
                  <p className="text-xs text-slate-500">
                    Select files now. They will upload once the task is saved.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <Paperclip size={14} />
                  Add Files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={onAttachmentChange}
                  className="hidden"
                />
              </div>
              <div className="space-y-2">
                {pendingAttachments.length === 0 && (
                  <p className="text-sm text-slate-400">No attachments selected yet.</p>
                )}
                {pendingAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{attachment.file.name}</p>
                      <p className="text-xs text-slate-400">
                        {(attachment.file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((current) =>
                          current.filter((item) => item.id !== attachment.id)
                        )
                      }
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            </SectionCard>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
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
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
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
  const palette = {
    yellow: {
      badge: 'bg-amber-50 text-amber-700',
      selected: 'border-amber-300 bg-amber-50/60 ring-2 ring-amber-200',
    },
    green: {
      badge: 'bg-emerald-50 text-emerald-700',
      selected: 'border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-200',
    },
    purple: {
      badge: 'bg-violet-50 text-violet-700',
      selected: 'border-violet-300 bg-violet-50/60 ring-2 ring-violet-200',
    },
    cyan: {
      badge: 'bg-cyan-50 text-cyan-700',
      selected: 'border-cyan-300 bg-cyan-50/60 ring-2 ring-cyan-200',
    },
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border p-4 text-left transition-all',
        selected
          ? palette[color].selected
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cn('inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em]', palette[color].badge)}>
            {emoji}
          </div>
          <div className="mt-3 text-sm font-bold text-slate-800">{title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{desc}</div>
        </div>
        {selected && <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-500" />}
      </div>
    </button>
  )
}

function TemplateOption({
  title,
  onClick,
}: {
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
    >
      {title}
    </button>
  )
}

function toInputDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16)
}

function readDraft(key: string): DraftPayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as DraftPayload) : null
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500'
const inputCls =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400'
const selectCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400'
