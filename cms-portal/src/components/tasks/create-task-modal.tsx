'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import * as XLSX from 'xlsx'
import {
  Bold,
  ChevronDown,
  FileSpreadsheet,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Table2,
  Underline,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { isPastPakistanDate, pakistanNowInputValue } from '@/lib/pakistan-time'
import { createBrowserClient } from '@/lib/supabase/client'
import { normalizeTaskDescription, sanitizeTaskDescriptionHtml } from '@/lib/task-description'
import { CMS_STORAGE_BUCKET } from '@/lib/storage'
import { joinTaskMeta, splitTaskMeta } from '@/lib/task-metadata'
import type { MultiAssignmentEntry, Todo } from '@/types'
import { KPI_TYPES } from '@/types'
import {
  getDepartmentsForTaskForm,
  getPackagesForTaskForm,
  getUsersForAssignment,
  importGoogleSheetCsvAction,
  createTaskAttachmentUploadUrlAction,
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
  avatar_data: string | null
}

type TaskRouting = 'self' | 'department' | 'manager' | 'multi'

type PendingAttachment = {
  file: File
  id: string
}

type DraftPayload = {
  appNames: string[]
  packageNames: string[]
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

type ImportProgress = {
  active: boolean
  label: string
  progress: number
}

const DRAFT_STORAGE_PREFIX = 'task-modal-draft-v3'
const MAX_ATTACHMENT_SIZE = 1024 * 1024 * 1024
const MAX_PARALLEL_UPLOADS = 3
const EMPTY_TABLE_HTML = '<table><tbody><tr><th>Column 1</th><th>Column 2</th></tr><tr><td></td><td></td></tr></tbody></table>'

interface CreateTaskModalProps {
  editTask?: Todo | null
  ownerUsername?: string
  onClose: () => void
  onSaved: () => void
}

export function CreateTaskModal({ editTask, ownerUsername, onClose, onSaved }: CreateTaskModalProps) {
  const isEdit = !!editTask
  const draftKey = `${DRAFT_STORAGE_PREFIX}:${editTask?.id ?? 'new'}`
  const initialDraft = readDraft(draftKey)
  const descriptionRef = useRef<HTMLDivElement>(null)
  const lastDescriptionRangeRef = useRef<Range | null>(null)
  const goalRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()

  const [appNames, setAppNames] = useState<string[]>(
    initialDraft?.appNames ?? splitTaskMeta(editTask?.app_name)
  )
  const [packageNames, setPackageNames] = useState<string[]>(
    initialDraft?.packageNames ?? splitTaskMeta(editTask?.package_name)
  )
  const [kpiType, setKpiType] = useState(initialDraft?.kpiType ?? editTask?.kpi_type ?? '')
  const [title, setTitle] = useState(initialDraft?.title ?? editTask?.title ?? '')
  const [description, setDescription] = useState(
    normalizeTaskDescription(initialDraft?.description ?? editTask?.description ?? '')
  )
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
  const [appSearch, setAppSearch] = useState('')
  const [packageSearch, setPackageSearch] = useState('')
  const [googleSheetUrl, setGoogleSheetUrl] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [descriptionImport, setDescriptionImport] = useState<ImportProgress>({
    active: false,
    label: '',
    progress: 0,
  })
  const [sheetImportPending, setSheetImportPending] = useState(false)
  const [error, setError] = useState('')
  const [showTableDialog, setShowTableDialog] = useState(false)
  const [tableRows, setTableRows] = useState('2')
  const [tableCols, setTableCols] = useState('2')
  const minDueDate = pakistanNowInputValue()

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
    if (!isPending) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [isPending])

  useEffect(() => {
    if (descriptionRef.current) {
      descriptionRef.current.innerHTML = normalizeTaskDescription(
        initialDraft?.description ?? editTask?.description ?? ''
      )
      normalizeEditableTables(descriptionRef.current)
    }
    if (goalRef.current) {
      goalRef.current.innerHTML = initialDraft?.ourGoal ?? editTask?.our_goal ?? ''
    }
  }, [editTask, initialDraft?.description, initialDraft?.ourGoal])

  useEffect(() => {
      const snapshot: DraftPayload = {
      appNames,
      packageNames,
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
    appNames,
    assignedManager,
    deptRoutingDept,
    description,
    draftKey,
    dueDate,
    kpiType,
    multiAssignees,
    notes,
    packageNames,
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

  const availableApps = useMemo(() => {
    const apps = [...new Set(packages.map((item) => item.app_name).filter(Boolean))].sort() as string[]
    return apps.includes('Others') ? apps : [...apps, 'Others']
  }, [packages])

  const filteredPackagesByApp = useMemo(() => {
    const list = appNames.length
      ? packages.filter((item) => item.app_name && appNames.includes(item.app_name))
      : packages

    if (appNames.includes('Others') && !list.some((item) => item.name === 'Others')) {
      return [{ id: 'others', name: 'Others', app_name: 'Others' }, ...list]
    }
    return list
  }, [appNames, packages])

  const filteredApps = useMemo(
    () => availableApps.filter((app) => app.toLowerCase().includes(appSearch.toLowerCase())),
    [appSearch, availableApps]
  )

  const filteredPackages = useMemo(
    () =>
      filteredPackagesByApp.filter((pkg) =>
        pkg.name.toLowerCase().includes(packageSearch.toLowerCase())
      ),
    [filteredPackagesByApp, packageSearch]
  )

  const filteredUsersForMulti = useMemo(
    () =>
      users.filter((user) => {
        const matchSearch =
          !multiSearch || user.username.toLowerCase().includes(multiSearch.toLowerCase())
        const matchDept = !multiDeptFilter || user.department === multiDeptFilter
        return matchSearch && matchDept
      }),
    [multiDeptFilter, multiSearch, users]
  )

  const syncDescription = () => {
    setDescription(descriptionRef.current?.innerHTML ?? '')
  }

  const captureDescriptionSelection = () => {
    const root = descriptionRef.current
    if (!root) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return
    lastDescriptionRangeRef.current = range.cloneRange()
  }

  const execCmd = (cmd: string, targetRef: React.RefObject<HTMLDivElement | null>) => {
    const target = targetRef.current
    if (!target) return

    ensureCaretInEditor(target)
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand(cmd, false)

    // Fallback for browsers where list command fails on a collapsed/empty selection.
    if ((cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') && !target.querySelector('ul,ol')) {
      const listTag = cmd === 'insertUnorderedList' ? 'ul' : 'ol'
      const li = document.createElement('li')
      li.innerHTML = '<br>'
      const list = document.createElement(listTag)
      list.appendChild(li)
      target.appendChild(list)
      placeCaretAtNodeStart(li)
    }

    if (targetRef.current === descriptionRef.current) {
      syncDescription()
    }
  }

  const handleEditorKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    targetRef: React.RefObject<HTMLDivElement | null>
  ) => {
    if (event.key !== 'Tab') return
    const target = targetRef.current
    if (!target) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const anchor = selection.anchorNode
    if (!anchor || !target.contains(anchor)) return
    const listItem = (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement)?.closest('li')
    if (!listItem) return

    event.preventDefault()
    document.execCommand(event.shiftKey ? 'outdent' : 'indent', false)
    if (targetRef.current === descriptionRef.current) {
      syncDescription()
    }
  }

  const toggleApp = (nextApp: string) => {
    setAppSearch('')
    setAppNames((current) => {
      const exists = current.includes(nextApp)
      const next = exists ? current.filter((item) => item !== nextApp) : [...current, nextApp]
      const autoSelectedPackages = Array.from(
        new Set([
          ...packages
            .filter((item) => item.app_name && next.includes(item.app_name))
            .map((item) => item.name),
          ...(next.includes('Others') ? ['Others'] : []),
        ])
      )
      setPackageNames(autoSelectedPackages)
      return next
    })
  }

  const togglePackage = (nextPackage: string) => {
    setPackageSearch('')
    setPackageNames((current) => {
      const exists = current.includes(nextPackage)
      return exists ? current.filter((item) => item !== nextPackage) : [...current, nextPackage]
    })
    if (nextPackage === 'Others') {
      setAppNames((current) => (current.includes('Others') ? current : [...current, 'Others']))
      return
    }
    const pkg = packages.find((item) => item.name === nextPackage)
    if (pkg?.app_name) {
      setAppNames((current) => (current.includes(pkg.app_name as string) ? current : [...current, pkg.app_name as string]))
    }
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

  const onAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    const oversized = files.find((file) => file.size > MAX_ATTACHMENT_SIZE)
    if (oversized) {
      setError(`${oversized.name} is larger than 1 GB.`)
      event.target.value = ''
      return
    }
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
    const resolvedOwner = ownerUsername || editTask?.username || 'unknown-user'
    await runWithConcurrency(pendingAttachments, MAX_PARALLEL_UPLOADS, async (attachment) => {
      const signedUpload = await createTaskAttachmentUploadUrlAction({
        todo_id: todoId,
        owner_username: resolvedOwner,
        file_name: attachment.file.name,
      })

      if (!signedUpload.success || !signedUpload.path || !signedUpload.token) {
        throw new Error(signedUpload.error ?? `Attachment upload failed for ${attachment.file.name}`)
      }

      const upload = await supabase.storage
        .from(signedUpload.bucket || CMS_STORAGE_BUCKET)
        .uploadToSignedUrl(signedUpload.path, signedUpload.token, attachment.file)

      if (upload.error) {
        throw new Error(`Attachment upload failed for ${attachment.file.name}: ${upload.error.message}`)
      }

      const saveAttachment = await saveTodoAttachmentAction({
        todo_id: todoId,
        file_name: attachment.file.name,
        file_size: attachment.file.size,
        mime_type: attachment.file.type || null,
        storage_path: signedUpload.path,
      })

      if (!saveAttachment.success) {
        throw new Error(saveAttachment.error ?? `Failed to link ${attachment.file.name}`)
      }
    })
  }

  const updateImportProgress = (label: string, progress: number) => {
    setDescriptionImport({
      active: true,
      label,
      progress,
    })
  }

  const finishImportProgress = (label: string) => {
    setDescriptionImport({
      active: true,
      label,
      progress: 100,
    })
    window.setTimeout(() => {
      setDescriptionImport({
        active: false,
        label: '',
        progress: 0,
      })
    }, 500)
  }

  const insertDescriptionHtml = (html: string, preferredRange?: Range | null) => {
    const editor = descriptionRef.current
    if (!editor) return

    editor.focus()
    const selection = window.getSelection()
    const activeRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const range = preferredRange ?? activeRange
    const isInsideEditor = !!range && editor.contains(range.commonAncestorContainer)

    if (isInsideEditor && range) {
      range.deleteContents()
      const fragment = range.createContextualFragment(html)
      range.insertNode(fragment)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    } else {
      editor.insertAdjacentHTML('beforeend', html)
    }

    normalizeEditableTables(editor)
    syncDescription()
  }

  const handleInsertTable = () => {
    captureDescriptionSelection()
    setTableCols('2')
    setTableRows('2')
    setShowTableDialog(true)
  }

  const confirmInsertTable = () => {
    const cols = clampCount(tableCols, 2)
    const rows = clampCount(tableRows, 2)
    insertDescriptionHtml(buildTableHtml(createEmptyGrid(rows, cols)), lastDescriptionRangeRef.current)
    setShowTableDialog(false)
  }

  const handleAddTableRow = () => {
    const context = getSelectedTableContext(descriptionRef.current)
    if (!context?.row) {
      setError('Place the cursor inside a description table first.')
      return
    }

    const newRow = context.row.cloneNode(true) as HTMLTableRowElement
    Array.from(newRow.cells).forEach((cell, index) => {
      const headerText = `Column ${index + 1}`
      cell.innerHTML = cell.tagName === 'TH' ? headerText : ''
    })
    context.row.insertAdjacentElement('afterend', newRow)
    normalizeEditableTables(descriptionRef.current)
    syncDescription()
  }

  const handleAddTableColumn = () => {
    const context = getSelectedTableContext(descriptionRef.current)
    if (!context?.table || !context.cell) {
      setError('Place the cursor inside a description table first.')
      return
    }

    const insertIndex = context.cell.cellIndex + 1
    Array.from(context.table.rows).forEach((row, rowIndex) => {
      const tagName = row.cells[0]?.tagName === 'TH' || rowIndex === 0 ? 'th' : 'td'
      const cell = document.createElement(tagName)
      cell.innerHTML = tagName === 'th' ? `Column ${insertIndex + 1}` : ''

      if (insertIndex >= row.cells.length) {
        row.appendChild(cell)
      } else {
        row.insertBefore(cell, row.cells[insertIndex])
      }
    })

    normalizeEditableTables(descriptionRef.current)
    syncDescription()
  }

  const importRowsIntoDescription = (rows: unknown[][], sourceLabel: string) => {
    insertDescriptionHtml(buildTableHtml(rows))
    finishImportProgress(`${sourceLabel} imported`)
  }

  const importSpreadsheetFile = async (file: File) => {
    setError('')
    updateImportProgress(`Uploading ${file.name}`, 5)

    try {
      const lowerName = file.name.toLowerCase()
      if (lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.json')) {
        const text = await file.text()
        insertDescriptionHtml(normalizeTaskDescription(text))
        finishImportProgress(`${file.name} imported`)
        return
      }

      const buffer = await readFileAsArrayBuffer(file, (progress) =>
        updateImportProgress(`Uploading ${file.name}`, progress)
      )
      updateImportProgress(`Parsing ${file.name}`, 82)
      const workbook = XLSX.read(buffer, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(firstSheet, {
        header: 1,
        raw: false,
        defval: '',
      }) as unknown[][]

      if (!rows.length) {
        throw new Error('The selected file is empty.')
      }

      importRowsIntoDescription(rows, file.name)
    } catch (importError) {
      setDescriptionImport({ active: false, label: '', progress: 0 })
      setError(importError instanceof Error ? importError.message : 'Import failed.')
    }
  }

  const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await importSpreadsheetFile(file)
    event.target.value = ''
  }

  const handleGoogleSheetImport = async () => {
    if (!googleSheetUrl.trim()) {
      setError('Paste a Google Sheet URL first.')
      return
    }

    setError('')
    setSheetImportPending(true)
    let progress = 12
    updateImportProgress('Fetching Google Sheet', progress)
    const timer = window.setInterval(() => {
      progress = Math.min(progress + 8, 88)
      updateImportProgress('Fetching Google Sheet', progress)
    }, 180)

    try {
      const result = await importGoogleSheetCsvAction(googleSheetUrl.trim())
      window.clearInterval(timer)

      if (!result.success || !result.csv) {
        throw new Error(result.error ?? 'Unable to import the Google Sheet.')
      }

      updateImportProgress('Parsing Google Sheet', 92)
      const workbook = XLSX.read(result.csv, { type: 'string' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(firstSheet, {
        header: 1,
        raw: false,
        defval: '',
      }) as unknown[][]

      if (!rows.length) {
        throw new Error('The Google Sheet is empty.')
      }

      importRowsIntoDescription(rows, 'Google Sheet')
      setGoogleSheetUrl('')
    } catch (importError) {
      window.clearInterval(timer)
      setDescriptionImport({ active: false, label: '', progress: 0 })
      setError(importError instanceof Error ? importError.message : 'Unable to import the Google Sheet.')
    } finally {
      setSheetImportPending(false)
    }
  }

  const validate = () => {
    if (!kpiType) return 'Please select a KPI type.'
    if (!title.trim()) return 'Please enter a task title.'
    if (title.trim().length < 3) return 'Title must be at least 3 characters.'
    if (packageNames.length === 0) return 'Please select at least one package.'
    if (routing !== 'self' && routing !== 'multi' && !dueDate) {
      return 'Please set a due date for this task.'
    }
    if (dueDate && isPastPakistanDate(dueDate)) {
      return 'Due date must be an upcoming Pakistan time.'
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
      const invalid = multiAssignees.find((entry) => entry.actual_due_date && isPastPakistanDate(entry.actual_due_date))
      if (invalid) {
        return `Deadline for ${invalid.username} must be an upcoming Pakistan time.`
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
    const descriptionHtml = sanitizeTaskDescriptionHtml(descriptionRef.current?.innerHTML ?? description)
    const ourGoalHtml = goalRef.current?.innerHTML ?? ''

    startTransition(async () => {
      const result = await saveTodoAction({
        id: editTask?.id,
        app_name: joinTaskMeta(appNames) ?? 'Others',
        package_name: joinTaskMeta(packageNames) ?? 'Others',
        kpi_type: kpiType,
        title: title.trim().slice(0, 30),
        description: descriptionHtml || undefined,
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
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
                  <MultiSearchableDropdown
                    values={appNames}
                    searchValue={appSearch}
                    onSearchChange={setAppSearch}
                    onToggle={toggleApp}
                    options={filteredApps.map((app) => ({ value: app, label: app }))}
                    placeholder="Select apps"
                    searchPlaceholder="Search app name..."
                  />
                </Field>
                <Field label="Package Name" required>
                  <MultiSearchableDropdown
                    values={packageNames}
                    searchValue={packageSearch}
                    onSearchChange={setPackageSearch}
                    onToggle={togglePackage}
                    options={filteredPackages.map((pkg) => ({ value: pkg.name, label: pkg.name }))}
                    placeholder="Select packages"
                    searchPlaceholder="Search package name..."
                  />
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
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
                  <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-2">
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
                          execCmd(cmd, descriptionRef)
                        }}
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-slate-800"
                        title={title}
                      >
                        {icon}
                      </button>
                    ))}
                    <Divider />
                    <ToolbarAction
                      icon={<Table2 size={14} />}
                      title="Insert Table"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        handleInsertTable()
                      }}
                    />
                    <ToolbarAction
                      icon={<Plus size={14} />}
                      title="Add Table Row"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        handleAddTableRow()
                      }}
                    />
                    <ToolbarAction
                      icon={<Plus size={14} />}
                      label="Col"
                      title="Add Table Column"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        handleAddTableColumn()
                      }}
                    />
                    <Divider />
                    <ToolbarAction
                      icon={<Upload size={14} />}
                      label="Excel/CSV"
                      title="Import Excel or CSV"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        importFileInputRef.current?.click()
                      }}
                    />
                  </div>

                  <div className="border-b border-slate-100 bg-white px-3 py-3">
                    <div className="flex flex-col gap-2 md:flex-row">
                      <div className="relative flex-1">
                        <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={googleSheetUrl}
                          onChange={(event) => setGoogleSheetUrl(event.target.value)}
                          placeholder="Paste a public Google Sheet URL..."
                          className={cn(inputCls, 'pl-9')}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleGoogleSheetImport}
                        disabled={sheetImportPending}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                      >
                        {sheetImportPending ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                        {sheetImportPending ? 'Importing...' : 'Import Sheet'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Supports bullet lists, manual tables, Excel, CSV, pasted table text, and public Google Sheets.
                    </p>

                    {descriptionImport.active && (
                      <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-blue-700">
                          <span>{descriptionImport.label}</span>
                          <span>{descriptionImport.progress}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-200"
                            style={{ width: `${descriptionImport.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    ref={descriptionRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncDescription}
                    onKeyDown={(event) => handleEditorKeyDown(event, descriptionRef)}
                    onKeyUp={captureDescriptionSelection}
                    onMouseUp={captureDescriptionSelection}
                    className={cn(
                      'min-h-40 px-3 py-3 text-sm text-slate-700 outline-none',
                      '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
                      '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
                      '[&_li]:my-1',
                      '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
                      '[&_td]:min-w-[120px] [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:whitespace-pre-wrap [&_td]:break-words',
                      '[&_th]:min-w-[120px] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:whitespace-pre-wrap [&_th]:break-words'
                    )}
                  />

                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,.txt,.md,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                  />
                </div>
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
                          execCmd(cmd, goalRef)
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
                    onKeyDown={(event) => handleEditorKeyDown(event, goalRef)}
                    className={cn(
                      'min-h-32 bg-white px-3 py-3 text-sm text-slate-700 outline-none',
                      '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
                      '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
                      '[&_li]:my-1'
                    )}
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
                      min={minDueDate}
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
                                min={minDueDate}
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
                      Select files now. They will upload once the task is saved. Max 1 GB per file.
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
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp"
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
      {showTableDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.2)]">
            <h3 className="text-base font-bold text-slate-900">Insert Table</h3>
            <p className="mt-1 text-sm text-slate-600">Choose rows and columns for the table.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Rows</label>
                <input
                  value={tableRows}
                  onChange={(event) => setTableRows(event.target.value)}
                  inputMode="numeric"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Columns</label>
                <input
                  value={tableCols}
                  onChange={(event) => setTableCols(event.target.value)}
                  inputMode="numeric"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTableDialog(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmInsertTable}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
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

function Divider() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />
}

function ToolbarAction({
  icon,
  title,
  label,
  onMouseDown,
}: {
  icon: React.ReactNode
  title: string
  label?: string
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 transition hover:bg-white hover:text-slate-800"
    >
      {icon}
      {label ? <span className="text-xs font-semibold">{label}</span> : null}
    </button>
  )
}

function MultiSearchableDropdown({
  values,
  options,
  placeholder,
  searchValue,
  onSearchChange,
  onToggle,
  searchPlaceholder,
}: {
  values: string[]
  options: Array<{ value: string; label: string }>
  placeholder: string
  searchValue: string
  onSearchChange: (value: string) => void
  onToggle: (value: string) => void
  searchPlaceholder: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const selectedLabels = values
    .map((value) => options.find((option) => option.value === value)?.label ?? value)
    .filter(Boolean)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          inputCls,
          'flex min-h-[44px] items-center justify-between gap-3 bg-white text-left',
          open && 'border-blue-400 ring-1 ring-blue-400'
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selectedLabels.length > 0 ? selectedLabels.map((label) => (
            <span key={label} className="inline-flex max-w-full items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <span className="truncate">{label}</span>
            </span>
          )) : (
            <span className="truncate text-slate-400">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_14px_32px_rgba(15,23,42,0.14)]">
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {options.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">No results found.</div>
            ) : (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onToggle(option.value)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition',
                    values.includes(option.value)
                      ? 'bg-blue-50 font-medium text-blue-700'
                      : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span>{option.label}</span>
                  {values.includes(option.value) ? <span className="text-xs font-semibold">Selected</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
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

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

function clampCount(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, 12)
}

function createEmptyGrid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) =>
      rowIndex === 0 ? `Column ${colIndex + 1}` : ''
    )
  )
}

function buildTableHtml(rows: unknown[][]): string {
  const normalized = rows
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []))
    .filter((row) => row.length > 0)

  if (!normalized.length) {
    return EMPTY_TABLE_HTML
  }

  const columnCount = Math.max(...normalized.map((row) => row.length))
  const header = normalized[0]
  const body = normalized.slice(1)

  const renderCells = (cells: string[], cellTag: 'th' | 'td') =>
    Array.from({ length: columnCount }, (_, index) => {
      const value = cells[index] ?? ''
      return `<${cellTag}>${escapeHtml(value)}</${cellTag}>`
    }).join('')

  return [
    '<table><tbody>',
    `<tr>${renderCells(header, 'th')}</tr>`,
    ...(body.length > 0
      ? body.map((row) => `<tr>${renderCells(row, 'td')}</tr>`)
      : [`<tr>${renderCells(Array.from({ length: columnCount }, () => ''), 'td')}</tr>`]),
    '</tbody></table>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getSelectedTableContext(root: HTMLDivElement | null) {
  if (!root) return null

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  let node = selection.anchorNode
  if (!node) return null
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement
  }

  if (!(node instanceof Element) || !root.contains(node)) return null

  const cell = node.closest('td, th') as HTMLTableCellElement | null
  const row = cell?.closest('tr') as HTMLTableRowElement | null
  const table = row?.closest('table') as HTMLTableElement | null

  if (!cell || !row || !table || !root.contains(table)) return null

  return { cell, row, table }
}

function ensureCaretInEditor(root: HTMLDivElement) {
  root.focus()
  const selection = window.getSelection()
  if (!selection) return
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    if (root.contains(range.commonAncestorContainer)) return
  }
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretAtNodeStart(node: Node) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function normalizeEditableTables(root: HTMLDivElement | null) {
  if (!root) return
  const cells = root.querySelectorAll('td, th')
  cells.forEach((cell) => {
    cell.setAttribute('contenteditable', 'true')
    if (!cell.textContent?.trim() && cell.childNodes.length === 0) {
      cell.appendChild(document.createElement('br'))
    }
  })
}

function readFileAsArrayBuffer(
  file: File,
  onProgress: (progress: number) => void
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onprogress = (event) => {
      if (!event.lengthComputable) return
      const progress = Math.min(78, Math.round((event.loaded / event.total) * 78))
      onProgress(progress)
    }

    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`))
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(file)
  })
}

const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500'
const inputCls =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400'
const selectCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400'
