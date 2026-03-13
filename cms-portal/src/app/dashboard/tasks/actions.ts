'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { isPastPakistanDate } from '@/lib/pakistan-time'
import { buildTaskAttachmentPath, CMS_STORAGE_BUCKET } from '@/lib/storage'
import type {
  Todo,
  TodoAttachment,
  TodoDetails,
  TodoStats,
  HistoryEntry,
  CreateTodoInput,
  MultiAssignment,
  AssignmentChainEntry,
} from '@/types'
// ── Helpers ───────────────────────────────────────────────────────────────────

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false
  return new Date(dateStr).getTime() < Date.now()
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T } catch { return fallback }
  }
  return val as T
}

async function resolveAttachmentUrl(
  supabase: ReturnType<typeof createServerClient>,
  row: TodoAttachment
): Promise<TodoAttachment> {
  const storagePath = String(row.drive_file_id || '').trim()
  if (!storagePath) return row

  const { data } = await supabase.storage
    .from(TASK_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60)

  if (!data?.signedUrl) return row

  return {
    ...row,
    file_url: data.signedUrl,
  }
}

function normalizeTodo(raw: Record<string, unknown>, username: string): Todo {
  const t = raw as unknown as Todo
  t.history = parseJson<HistoryEntry[]>(raw.history, [])
  t.assignment_chain = parseJson<AssignmentChainEntry[]>(raw.assignment_chain, [])
  t.multi_assignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
  if (!t.archived) t.archived = false
  // Assignee sees their actual_due_date; everyone else sees expected_due_date
  const isAssignee = (t.assigned_to || '').toLowerCase() === username.toLowerCase()
  if (isAssignee && t.actual_due_date) {
    t.due_date = t.actual_due_date
  } else if (!t.due_date && t.expected_due_date) {
    t.due_date = t.expected_due_date
  }
  return t
}

function isUserInManagerList(managerIdField: string | null, username: string): boolean {
  if (!managerIdField || !username) return false
  return managerIdField
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .includes(username.toLowerCase())
}

function extractMentionedUsernames(message: string, candidates: string[]): string[] {
  const candidateMap = new Map(
    candidates
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .map((candidate) => [candidate.toLowerCase(), candidate] as const)
  )

  const matches = message.match(/@([a-zA-Z0-9._-]+)/g) ?? []
  const seen = new Set<string>()
  const mentions: string[] = []

  for (const match of matches) {
    const username = match.slice(1).trim().toLowerCase()
    const resolved = candidateMap.get(username)
    if (!resolved || seen.has(resolved.toLowerCase())) continue
    seen.add(resolved.toLowerCase())
    mentions.push(resolved)
  }

  return mentions
}

// ── Get all todos (role-filtered) ─────────────────────────────────────────────

export async function getTodos(): Promise<Todo[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const isAdminOrSM =
    user.role === 'Admin' || user.role === 'Super Manager'

  // Fetch all users for department map
  const { data: allUsers } = await supabase
    .from('users')
    .select('username,manager_id,team_members,department')

  const userDeptMap: Record<string, string> = {}
  ;(allUsers || []).forEach((u: Record<string, unknown>) => {
    if (u.username && u.department) {
      userDeptMap[String(u.username).toLowerCase()] = String(u.department)
    }
  })

  if (isAdminOrSM) {
    const { data, error } = await supabase.from('todos').select('*')
    if (error) { console.error('getTodos error:', error); return [] }
    const { data: sharedData } = await supabase
      .from('todo_shares')
      .select('todo_id')
      .eq('shared_with', user.username)
    const sharedIds = new Set((sharedData || []).map((s: Record<string, unknown>) => s.todo_id as string))
    return (data || []).map((raw: Record<string, unknown>) => {
      const t = normalizeTodo(raw, user.username)
      t.is_shared = sharedIds.has(t.id) || undefined
      t.creator_department = userDeptMap[t.username?.toLowerCase()] || null
      t.assignee_department = userDeptMap[(t.assigned_to || '').toLowerCase()] || null
      return t
    })
  }

  // Build team usernames
  const myTeamUsernames: string[] = []
  ;(allUsers || []).forEach((u: Record<string, unknown>) => {
    if (!u.manager_id) return
    const managers = String(u.manager_id)
      .split(',')
      .map((m) => m.trim().toLowerCase())
    if (managers.includes(user.username.toLowerCase())) {
      myTeamUsernames.push(String(u.username))
    }
  })
  const myRow = (allUsers || []).find(
    (u: Record<string, unknown>) => String(u.username).toLowerCase() === user.username.toLowerCase()
  ) as Record<string, unknown> | undefined
  const explicitTeam = String(myRow?.team_members || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  explicitTeam.forEach((m) => {
    if (m && !myTeamUsernames.includes(m)) myTeamUsernames.push(m)
  })

  // Parallel queries
  const [ownedRes, assignedRes, completedByRes, sharedRes, deptQueueRes] = await Promise.all([
    supabase.from('todos').select('*').eq('username', user.username),
    supabase.from('todos').select('*').eq('assigned_to', user.username),
    supabase.from('todos').select('*').eq('completed_by', user.username),
    supabase.from('todo_shares').select('todo_id').eq('shared_with', user.username),
    user.department
      ? supabase
          .from('todos')
          .select('*')
          .eq('queue_status', 'queued')
          .or('assigned_to.is.null,assigned_to.eq.')
          .ilike('queue_department', user.department)
      : Promise.resolve({ data: [] }),
  ])

  // Tasks where I'm manager_id
  const { data: managedData } = await supabase
    .from('todos')
    .select('*')
    .ilike('manager_id', `%${user.username}%`)

  const allTasks: Todo[] = []
  const taskIds = new Set<string>()

  const addTask = (raw: Record<string, unknown>, flags: Partial<Todo> = {}) => {
    const t = normalizeTodo(raw, user.username)
    if (!taskIds.has(t.id)) {
      Object.assign(t, flags)
      t.creator_department = userDeptMap[t.username?.toLowerCase()] || null
      t.assignee_department = userDeptMap[(t.assigned_to || '').toLowerCase()] || null
      allTasks.push(t)
      taskIds.add(t.id)
    }
  }

  ;(ownedRes.data || []).forEach((r: Record<string, unknown>) => addTask(r))
  ;(assignedRes.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_assigned_to_me: true }))
  ;(completedByRes.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_completed_by_me: true }))
  ;((deptQueueRes as { data: Record<string, unknown>[] | null }).data || []).forEach((r) => addTask(r, { is_department_queue: true }))

  ;(managedData || []).forEach((r: Record<string, unknown>) => {
    const managers = String(r.manager_id || '').split(',').map((m) => m.trim().toLowerCase())
    if (managers.includes(user.username.toLowerCase())) {
      addTask(r, { is_managed: true })
    }
  })

  // Team tasks
  if (myTeamUsernames.length > 0) {
    const [teamCreated, teamAssigned] = await Promise.all([
      supabase.from('todos').select('*').in('username', myTeamUsernames),
      supabase.from('todos').select('*').in('assigned_to', myTeamUsernames),
    ])
    ;(teamCreated.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_team_task: true }))
    ;(teamAssigned.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_team_task: true }))
  }

  // Shared tasks
  const sharedIds = (sharedRes.data || [])
    .map((s: Record<string, unknown>) => s.todo_id as string)
    .filter((id: string) => !taskIds.has(id))
  if (sharedIds.length > 0) {
    const { data: sharedTasks } = await supabase.from('todos').select('*').in('id', sharedIds)
    ;(sharedTasks || []).forEach((r: Record<string, unknown>) => addTask(r, { is_shared: true }))
  }

  // Multi-assignment tasks
  const { data: maTasks } = await supabase.from('todos').select('*').not('multi_assignment', 'is', null)
  ;(maTasks || []).forEach((r: Record<string, unknown>) => {
    const ma = parseJson<MultiAssignment | null>(r.multi_assignment, null)
    if (ma?.enabled && Array.isArray(ma.assignees)) {
      const isAssignee = ma.assignees.some(
        (a) => (a.username || '').toLowerCase() === user.username.toLowerCase()
      )
      const isDelegated =
        !isAssignee &&
        ma.assignees.some((a) =>
          Array.isArray(a.delegated_to) &&
          a.delegated_to.some((sub) => (sub.username || '').toLowerCase() === user.username.toLowerCase())
        )
      if (isAssignee || isDelegated) {
        addTask(r, { is_multi_assigned: true, is_delegated_to_me: isDelegated })
      }
    }
  })

  allTasks.sort((a, b) => {
    const pa = a.position || 0
    const pb = b.position || 0
    if (pa !== pb) return pa - pb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return allTasks
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getTodoStats(): Promise<TodoStats> {
  const user = await getSession()
  if (!user) return { total: 0, completed: 0, pending: 0, overdue: 0, highPriority: 0, dueToday: 0, shared: 0 }
  const todos = await getTodos()
  return {
    total: todos.length,
    completed: todos.filter((t) => t.completed).length,
    pending: todos.filter((t) => !t.completed).length,
    overdue: todos.filter((t) => !t.completed && isOverdue(t.due_date)).length,
    highPriority: todos.filter((t) => !t.completed && (t.priority === 'high' || t.priority === 'urgent')).length,
    dueToday: todos.filter((t) => !t.completed && isToday(t.due_date)).length,
    shared: todos.filter((t) => t.is_shared).length,
  }
}

// ── Get packages for task form ────────────────────────────────────────────────

export async function getPackagesForTaskForm(): Promise<Array<{ id: string; name: string; app_name: string | null }>> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()

  const activeResult = await supabase
    .from('packages')
    .select('id,name,app_name')
    .eq('is_active', true)
    .order('name')

  if (!activeResult.error) {
    return (activeResult.data || []) as Array<{ id: string; name: string; app_name: string | null }>
  }

  console.error('getPackagesForTaskForm active query failed:', activeResult.error)

  const fallbackResult = await supabase
    .from('packages')
    .select('id,name,app_name')
    .order('name')

  if (fallbackResult.error) {
    console.error('getPackagesForTaskForm fallback query failed:', fallbackResult.error)
    return []
  }

  return (fallbackResult.data || []) as Array<{ id: string; name: string; app_name: string | null }>
}

// ── Get users for assignment dropdown ────────────────────────────────────────

export async function getUsersForAssignment(): Promise<Array<{ username: string; role: string; department: string | null }>> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('username,role,department')
    .order('username')
  return (data || []).filter((u: Record<string, unknown>) => u.username !== user.username) as Array<{
    username: string
    role: string
    department: string | null
  }>
}

// ── Get departments ───────────────────────────────────────────────────────────

export async function getDepartmentsForTaskForm(): Promise<string[]> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()
  const { data } = await supabase.from('departments').select('name').order('name')
  return (data || []).map((d: Record<string, unknown>) => String(d.name))
}

function toGoogleSheetCsvUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/pub\?.*output=csv/i.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)(?:\/.*)?$/i)
  if (!match) return null

  const url = new URL(trimmed)
  const gid = url.searchParams.get('gid') || '0'
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`
}

export async function importGoogleSheetCsvAction(
  sheetUrl: string
): Promise<{ success: boolean; csv?: string; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const csvUrl = toGoogleSheetCsvUrl(sheetUrl)
  if (!csvUrl) {
    return {
      success: false,
      error: 'Please enter a valid public Google Sheet URL.',
    }
  }

  try {
    const response = await fetch(csvUrl, {
      cache: 'no-store',
      headers: {
        accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      return {
        success: false,
        error: `Google Sheet import failed (${response.status}). Make sure the sheet is public.`,
      }
    }

    const csv = await response.text()
    if (!csv.trim()) {
      return { success: false, error: 'The Google Sheet is empty.' }
    }

    return { success: true, csv }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to import the Google Sheet.',
    }
  }
}

// ── Create / Update todo ──────────────────────────────────────────────────────

export async function saveTodoAction(
  input: CreateTodoInput & { id?: string }
): Promise<{ success: boolean; error?: string; id?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  if (!input.kpi_type) return { success: false, error: "KPI type is required." }
  if (!input.title?.trim()) return { success: false, error: 'Title is required.' }
  if (input.title.trim().length > 30) return { success: false, error: 'Title must be 30 characters or less.' }
  if (input.due_date && isPastPakistanDate(input.due_date)) {
    return { success: false, error: 'Due date must be an upcoming Pakistan time.' }
  }
  if (input.multi_assignment?.enabled && input.multi_assignment.assignees.some((entry) => entry.actual_due_date && isPastPakistanDate(entry.actual_due_date))) {
    return { success: false, error: 'Each assignee due date must be an upcoming Pakistan time.' }
  }

  const supabase = createServerClient()
  const now = new Date().toISOString()
  const id = input.id || crypto.randomUUID()

  if (input.id) {
    // Edit — only creator can edit
    const { data: existing } = await supabase
      .from('todos')
      .select('username,task_status,history,actual_due_date,expected_due_date')
      .eq('id', input.id)
      .single()
    if (!existing) return { success: false, error: 'Task not found.' }
    const task = existing as Record<string, unknown>
    if ((task.username as string) !== user.username) {
      return { success: false, error: 'Only the task creator can edit this task.' }
    }

    const changes: string[] = []
    // Track field changes in history
    const payload: Record<string, unknown> = {
      title: input.title.trim(),
      description: input.description || null,
      our_goal: input.our_goal || null,
      priority: input.priority,
      kpi_type: input.kpi_type,
      package_name: input.package_name || null,
      app_name: input.app_name || null,
      notes: input.notes || null,
      category: input.category || null,
      due_date: input.due_date || null,
      expected_due_date: input.due_date || null,
      updated_at: now,
    }
    if (
      input.due_date &&
      (
        !(task.actual_due_date) ||
        (task.actual_due_date as string) === (task.expected_due_date as string)
      )
    ) {
      payload.actual_due_date = input.due_date
    }

    const nextAssignedTo =
      input.routing === 'manager' ? (input.assigned_to || null) : null
    const nextManagerId =
      input.routing === 'manager'
        ? (input.manager_id || input.assigned_to || null)
        : null
    const nextQueueDept =
      input.routing === 'department'
        ? (input.queue_department || user.department || null)
        : null
    const nextQueueStatus = input.routing === 'department' ? 'queued' : null
    const nextMultiAssignment =
      input.routing === 'multi' && input.multi_assignment?.enabled
        ? input.multi_assignment
        : null

    payload.assigned_to = nextAssignedTo
    payload.manager_id = nextManagerId
    payload.queue_department = nextQueueDept
    payload.queue_status = nextQueueStatus
    payload.multi_assignment = nextMultiAssignment
      ? JSON.stringify(nextMultiAssignment)
      : null
    payload.category =
      input.category || (input.routing === 'department' ? nextQueueDept : null)

    const oldHistory = parseJson<HistoryEntry[]>(task.history, [])
    if (changes.length > 0 || true) {
      oldHistory.push({
        type: 'edit',
        user: user.username,
        details: 'Task updated',
        timestamp: now,
        icon: '✏️',
        title: 'Task Edited',
      })
    }
    payload.history = JSON.stringify(oldHistory)

    const { error } = await supabase.from('todos').update(payload).eq('id', input.id)
    if (error) return { success: false, error: error.message }
  } else {
    // Create new
    const taskStatus =
      input.routing === 'manager' || input.routing === 'department' || input.routing === 'multi'
        ? 'backlog'
        : 'todo'

    const assignedTo =
      input.routing === 'manager' ? (input.assigned_to || null) :
      input.routing === 'multi' ? null : // multi uses multi_assignment
      null

    const managerId = input.routing === 'manager' ? (input.manager_id || input.assigned_to || null) : null

    const queueDept = input.routing === 'department' ? (input.queue_department || user.department || null) : null
    const queueStatus = input.routing === 'department' ? 'queued' : null

    const multiAssignment: MultiAssignment | null =
      input.routing === 'multi' && input.multi_assignment?.enabled
        ? input.multi_assignment
        : null

    const assignmentChain: AssignmentChainEntry[] = []
    if (assignedTo) {
      assignmentChain.push({
        user: assignedTo,
        role: 'assignee',
        assignedAt: now,
      })
    }
    if (managerId && managerId !== assignedTo) {
      assignmentChain.push({
        user: managerId,
        role: 'manager',
        assignedAt: now,
      })
    }

    const history: HistoryEntry[] = [
      {
        type: 'created',
        user: user.username,
        details: 'Task created',
        timestamp: now,
        icon: '✨',
        title: 'Task Created',
      },
    ]
    if (assignedTo && assignedTo !== user.username) {
      history.push({
        type: 'assigned',
        user: user.username,
        details: `Task assigned to ${assignedTo}`,
        timestamp: now,
        icon: '👤',
        title: 'Task Assigned',
      })
    }

    const payload: Record<string, unknown> = {
      id,
      username: user.username,
      title: input.title.trim(),
      description: input.description || null,
      our_goal: input.our_goal || null,
      completed: false,
      task_status: taskStatus,
      priority: input.priority,
      category: input.category || (input.routing === 'department' ? queueDept : null),
      kpi_type: input.kpi_type,
      due_date: input.due_date || null,
      expected_due_date: input.due_date || null,
      actual_due_date: input.due_date || null,
      notes: input.notes || null,
      package_name: input.package_name || null,
      app_name: input.app_name || null,
      position: 0,
      archived: false,
      queue_department: queueDept,
      queue_status: queueStatus,
      multi_assignment: multiAssignment ? JSON.stringify(multiAssignment) : null,
      assigned_to: assignedTo,
      manager_id: managerId,
      completed_by: null,
      completed_at: null,
      approval_status: 'approved',
      approved_at: null,
      approved_by: null,
      declined_at: null,
      declined_by: null,
      decline_reason: null,
      assignment_chain: JSON.stringify(assignmentChain),
      history: JSON.stringify(history),
      created_at: now,
      updated_at: now,
    }

    const { error } = await supabase.from('todos').insert(payload)
    if (error) return { success: false, error: error.message }

    // Notify assigned user if different from creator
    if (assignedTo && assignedTo !== user.username) {
      await createNotification(supabase, {
        userId: assignedTo,
        type: 'task_assigned',
        title: 'New Task Assigned to You',
        body: `${user.username} assigned you a task: "${input.title.trim()}"`,
        relatedId: id,
      })
    }
    // Notify multi-assignment assignees
    if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
      for (const a of multiAssignment.assignees) {
        if (a.username && a.username !== user.username) {
          await createNotification(supabase, {
            userId: a.username,
            type: 'task_assigned',
            title: 'New Task Assigned to You',
            body: `${user.username} assigned you a task: "${input.title.trim()}"`,
            relatedId: id,
          })
        }
      }
    }
  }

  revalidatePath('/dashboard/tasks')
  return { success: true, id }
}

// ── Delete todo ───────────────────────────────────────────────────────────────

export async function deleteTodoAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,completed')
    .eq('id', todoId)
    .single()

  if (!existing) return { success: false, error: 'Task not found.' }
  const t = existing as Record<string, unknown>
  if ((t.username as string) !== user.username) return { success: false, error: 'Cannot delete this task — not yours.' }
  if (t.completed === true) return { success: false, error: 'Completed tasks cannot be deleted.' }

  await supabase.from('todos').delete().eq('id', todoId)
  await supabase.from('todo_shares').delete().eq('todo_id', todoId)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Archive todo ──────────────────────────────────────────────────────────────

export async function archiveTodoAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase.from('todos').select('username').eq('id', todoId).single()
  if (!existing) return { success: false, error: 'Task not found.' }
  if ((existing as Record<string, unknown>).username !== user.username) return { success: false, error: 'Cannot archive this task — not yours.' }

  await supabase.from('todos').update({ archived: true, updated_at: new Date().toISOString() }).eq('id', todoId)
  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Start work (assignee) ─────────────────────────────────────────────────────

export async function startTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.assigned_to as string) !== user.username) return { success: false, error: 'Only the assignee can start this task.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'started',
    user: user.username,
    details: `${user.username} started working on this task`,
    timestamp: now,
    icon: '🚀',
    title: 'Task In Progress',
  })

  await supabase.from('todos').update({
    task_status: 'in_progress',
    completed: false,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  // Notify creator
  if ((task.username as string) && (task.username as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.username as string,
      type: 'task_assigned',
      title: 'Task Started',
      body: `${user.username} started working on "${task.title}"`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Toggle complete ───────────────────────────────────────────────────────────

export async function toggleTodoCompleteAction(
  todoId: string,
  completed: boolean
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,manager_id,title,history,approval_status,completed,completed_by')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isOwner = (task.username as string) === user.username
  const isAssignee = (task.assigned_to as string) === user.username
  const isTaskManager = isUserInManagerList(task.manager_id as string, user.username)
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isOwner && !isAssignee && !isTaskManager && !isAdmin) {
    // Check share
    const { data: share } = await supabase
      .from('todo_shares')
      .select('can_edit')
      .eq('todo_id', todoId)
      .eq('shared_with', user.username)
      .single()
    if (!share || !(share as Record<string, unknown>).can_edit) {
      return { success: false, error: 'No permission to modify this task.' }
    }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  let updateData: Record<string, unknown> = { updated_at: now }

  if (completed) {
    if (isOwner) {
      updateData = {
        ...updateData,
        completed: true,
        completed_at: now,
        completed_by: user.username,
        task_status: 'done',
        approval_status: 'approved',
      }
      history.push({
        type: 'completed',
        user: user.username,
        details: `Task marked as completed by ${user.username}`,
        timestamp: now,
        icon: '✅',
        title: 'Task Completed',
      })
    } else {
      updateData = {
        ...updateData,
        completed: false,
        approval_status: 'pending_approval',
        completed_by: user.username,
        task_status: 'done',
      }
      history.push({
        type: 'completion_submitted',
        user: user.username,
        details: `${user.username} submitted task for completion — awaiting creator approval`,
        timestamp: now,
        icon: '⏳',
        title: 'Completion Submitted',
      })
      // Notify creator
      await createNotification(supabase, {
        userId: task.username as string,
        type: 'task_assigned',
        title: 'Task Completion Needs Approval',
        body: `${user.username} completed "${task.title}" and needs your approval.`,
        relatedId: todoId,
      })
    }
  } else {
    if (!isOwner) return { success: false, error: 'Only the task creator can reopen a completed task.' }
    updateData = {
      ...updateData,
      completed: false,
      completed_at: null,
      completed_by: null,
      task_status: 'in_progress',
      approval_status: 'approved',
    }
    history.push({
      type: 'uncompleted',
      user: user.username,
      details: `Task reopened by ${user.username}`,
      timestamp: now,
      icon: '↩️',
      title: 'Task Reopened',
    })
  }

  updateData.history = JSON.stringify(history)
  await supabase.from('todos').update(updateData).eq('id', todoId)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Approve completion ────────────────────────────────────────────────────────

export async function approveTodoAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,completed_by,assigned_to,title,history,approval_status,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.username as string) !== user.username) return { success: false, error: 'Only the task creator can approve completion.' }
  if ((task.approval_status as string) !== 'pending_approval') return { success: false, error: 'Task is not pending approval.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'approved',
    user: user.username,
    details: `Task completion approved by ${user.username}`,
    timestamp: now,
    icon: '✅',
    title: 'Completion Approved',
  })

  await supabase.from('todos').update({
    completed: true,
    completed_at: now,
    approval_status: 'approved',
    approved_at: now,
    approved_by: user.username,
    task_status: 'done',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  // Notify all involved users
  const notifySet = new Set<string>()
  if (task.completed_by && (task.completed_by as string) !== user.username) notifySet.add(task.completed_by as string)
  if (task.assigned_to && (task.assigned_to as string) !== user.username) notifySet.add(task.assigned_to as string)

  for (const targetUser of notifySet) {
    await createNotification(supabase, {
      userId: targetUser,
      type: 'task_assigned',
      title: 'Task Approved!',
      body: `${user.username} approved completion of "${task.title}". Task is now complete.`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Decline completion ────────────────────────────────────────────────────────

export async function declineTodoAction(todoId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,completed_by,assigned_to,title,history,approval_status')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.username as string) !== user.username) return { success: false, error: 'Only the task creator can decline completion.' }
  if ((task.approval_status as string) !== 'pending_approval') return { success: false, error: 'Task is not pending approval.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'declined',
    user: user.username,
    details: `Task completion declined by ${user.username}${reason ? ': ' + reason : ''}`,
    timestamp: now,
    icon: '❌',
    title: 'Completion Declined',
  })

  const previousAssignee = (task.completed_by as string) || (task.assigned_to as string)
  await supabase.from('todos').update({
    completed: false,
    approval_status: 'declined',
    declined_at: now,
    declined_by: user.username,
    decline_reason: reason || null,
    completed_by: null,
    assigned_to: previousAssignee || (task.assigned_to as string),
    task_status: 'in_progress',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  if (task.completed_by && (task.completed_by as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.completed_by as string,
      type: 'task_assigned',
      title: 'Task Completion Declined',
      body: `${user.username} declined your completion of "${task.title}".${reason ? ' Reason: ' + reason : ''}`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Add comment ───────────────────────────────────────────────────────────────

export async function addCommentAction(
  todoId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!message.trim()) return { success: false, error: 'Comment cannot be empty.' }

  const supabase = createServerClient()
  const [existingRes, sharesRes] = await Promise.all([
    supabase
      .from('todos')
      .select('username,assigned_to,manager_id,history,title,multi_assignment')
      .eq('id', todoId)
      .single(),
    supabase.from('todo_shares').select('shared_with').eq('todo_id', todoId),
  ])
  const existing = existingRes.data
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isCreator = (task.username as string) === user.username
  const isAssignee = (task.assigned_to as string) === user.username
  const isManager = isUserInManagerList(task.manager_id as string, user.username)
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isCreator && !isAssignee && !isManager && !isAdmin) {
    const { data: share } = await supabase
      .from('todo_shares')
      .select('can_edit')
      .eq('todo_id', todoId)
      .eq('shared_with', user.username)
      .single()
    if (!share) return { success: false, error: 'No permission to comment on this task.' }
  }

  const now = new Date().toISOString()
  const unreadBy: string[] = []
  if ((task.username as string) && (task.username as string) !== user.username) unreadBy.push(task.username as string)
  if ((task.assigned_to as string) && (task.assigned_to as string) !== user.username && !unreadBy.includes(task.assigned_to as string)) {
    unreadBy.push(task.assigned_to as string)
  }
  if (task.manager_id) {
    const managers = String(task.manager_id).split(',').map((m) => m.trim()).filter((m) => m && m !== user.username && !unreadBy.includes(m))
    unreadBy.push(...managers)
  }

  const candidateMentions = new Set<string>()
  if (task.username) candidateMentions.add(String(task.username))
  if (task.assigned_to) candidateMentions.add(String(task.assigned_to))
  if (task.manager_id) {
    String(task.manager_id)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => candidateMentions.add(value))
  }
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  multiAssignment?.assignees?.forEach((assignee) => {
    if (assignee.username) candidateMentions.add(assignee.username)
  })
  ;(sharesRes.data || []).forEach((share: Record<string, unknown>) => {
    if (share.shared_with) candidateMentions.add(String(share.shared_with))
  })

  const mentionUsers = extractMentionedUsernames(message, Array.from(candidateMentions))
  mentionUsers.forEach((username) => {
    if (username !== user.username && !unreadBy.includes(username)) unreadBy.push(username)
  })

  const history = parseJson<HistoryEntry[]>(task.history, [])
  const newComment: HistoryEntry = {
    type: 'comment',
    user: user.username,
    details: message.trim(),
    timestamp: now,
    icon: '💬',
    title: 'Comment',
    unread_by: unreadBy,
    read_by: [user.username],
    message_id: crypto.randomUUID(),
    mention_users: mentionUsers,
  }
  history.push(newComment)
  if (history.length > 100) history.splice(0, history.length - 100)

  await supabase.from('todos').update({
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  // Notify assignee/creator if different
  const notifyUsers = new Set<string>(unreadBy.slice(0, 3))
  for (const u of notifyUsers) {
    await createNotification(supabase, {
      userId: u,
      type: 'task_assigned',
      title: 'New Comment on Task',
      body: `${user.username} commented on "${task.title}": ${message.trim().slice(0, 80)}`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Share task ────────────────────────────────────────────────────────────────

export async function shareTodoAction(
  todoId: string,
  sharedWithUsername: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase.from('todos').select('username,title').eq('id', todoId).single()
  if (!existing) return { success: false, error: 'Task not found.' }
  const task = existing as Record<string, unknown>
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if ((task.username as string) !== user.username && !isAdmin) {
    return { success: false, error: 'Only the task creator can share this task.' }
  }

  // Upsert share (view only)
  const { error } = await supabase.from('todo_shares').upsert(
    {
      todo_id: todoId,
      shared_by: user.username,
      shared_with: sharedWithUsername,
      can_edit: false,
    },
    { onConflict: 'todo_id,shared_with' }
  )
  if (error) return { success: false, error: error.message }

  await createNotification(supabase, {
    userId: sharedWithUsername,
    type: 'task_assigned',
    title: 'Task Shared With You',
    body: `${user.username} shared a task with you: "${task.title}"`,
    relatedId: todoId,
  })

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Unshare task ──────────────────────────────────────────────────────────────

export async function unshareTodoAction(
  todoId: string,
  sharedWithUsername: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  await supabase
    .from('todo_shares')
    .delete()
    .eq('todo_id', todoId)
    .eq('shared_with', sharedWithUsername)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Get full task detail ───────────────────────────────────────────────────────

export async function saveTodoAttachmentAction(input: {
  todo_id: string
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  file_url?: string | null
  storage_path?: string | null
}): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const [existingRes, sharesRes] = await Promise.all([
    supabase
      .from('todos')
      .select('id,username,assigned_to,manager_id,multi_assignment')
      .eq('id', input.todo_id)
      .single(),
    supabase.from('todo_shares').select('shared_with').eq('todo_id', input.todo_id),
  ])
  const existing = existingRes.data

  if (!existing) return { success: false, error: 'Task not found.' }
  if ((input.file_size ?? 0) > 1024 * 1024 * 1024) {
    return { success: false, error: 'Each file must be smaller than 1 GB.' }
  }

  const task = existing as Record<string, unknown>
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const isMultiAssignee = multiAssignment?.assignees?.some(
    (assignee) => (assignee.username || '').toLowerCase() === user.username.toLowerCase()
  ) ?? false
  const isSharedUser = (sharesRes.data || []).some(
    (share: Record<string, unknown>) => String(share.shared_with || '').toLowerCase() === user.username.toLowerCase()
  )
  const canAttach =
    (task.username as string) === user.username ||
    (task.assigned_to as string | null) === user.username ||
    isMultiAssignee ||
    isSharedUser ||
    isUserInManagerList((task.manager_id as string | null) ?? null, user.username) ||
    user.role === 'Admin' ||
    user.role === 'Super Manager'

  if (!canAttach) {
    return { success: false, error: 'No permission to attach files.' }
  }

  const { error } = await supabase.from('todo_attachments').insert({
    todo_id: input.todo_id,
    file_name: input.file_name,
    file_size: input.file_size ?? null,
    mime_type: input.mime_type ?? null,
    file_url: input.file_url || input.storage_path || '',
    drive_file_id: input.storage_path || null,
    uploaded_by: user.username,
  })

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function createTaskAttachmentUploadUrlAction(input: {
  todo_id: string
  owner_username: string
  file_name: string
}): Promise<{ success: boolean; path?: string; token?: string; bucket?: string; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const [existingRes, sharesRes] = await Promise.all([
    supabase
      .from('todos')
      .select('id,username,assigned_to,manager_id,multi_assignment')
      .eq('id', input.todo_id)
      .single(),
    supabase.from('todo_shares').select('shared_with').eq('todo_id', input.todo_id),
  ])

  const existing = existingRes.data
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const isMultiAssignee = multiAssignment?.assignees?.some(
    (assignee) => (assignee.username || '').toLowerCase() === user.username.toLowerCase()
  ) ?? false
  const isSharedUser = (sharesRes.data || []).some(
    (share: Record<string, unknown>) => String(share.shared_with || '').toLowerCase() === user.username.toLowerCase()
  )

  const canAttach =
    (task.username as string) === user.username ||
    (task.assigned_to as string | null) === user.username ||
    isMultiAssignee ||
    isSharedUser ||
    isUserInManagerList((task.manager_id as string | null) ?? null, user.username) ||
    user.role === 'Admin' ||
    user.role === 'Super Manager'

  if (!canAttach) {
    return { success: false, error: 'No permission to attach files.' }
  }

  const path = buildTaskAttachmentPath({
    ownerUsername: input.owner_username,
    taskId: input.todo_id,
    fileName: input.file_name,
  })

  const { data, error } = await supabase.storage
    .from(CMS_STORAGE_BUCKET)
    .createSignedUploadUrl(path)

  if (error || !data?.token) {
    return { success: false, error: error?.message ?? 'Unable to create upload URL.' }
  }

  return {
    success: true,
    bucket: CMS_STORAGE_BUCKET,
    path,
    token: data.token,
  }
}

export async function getTodoDetails(todoId: string): Promise<TodoDetails | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = createServerClient()
  const [taskRes, sharesRes, attachmentsRes, usersRes] = await Promise.all([
    supabase.from('todos').select('*').eq('id', todoId).single(),
    supabase.from('todo_shares').select('*').eq('todo_id', todoId),
    supabase.from('todo_attachments').select('*').eq('todo_id', todoId).order('created_at', { ascending: false }),
    supabase.from('users').select('username,department'),
  ])

  if (!taskRes.data) return null

  const task = normalizeTodo(taskRes.data as Record<string, unknown>, user.username)
  const userDeptMap: Record<string, string> = {}
  ;(usersRes.data || []).forEach((row: Record<string, unknown>) => {
    if (!row.username || !row.department) return
    userDeptMap[String(row.username).toLowerCase()] = String(row.department)
  })
  task.creator_department = userDeptMap[(task.username || '').toLowerCase()] || null
  task.assignee_department = userDeptMap[(task.assigned_to || '').toLowerCase()] || null

  const isCreator = task.username === user.username
  const isAssignee = task.assigned_to === user.username
  const isAssigneeManager = isUserInManagerList(task.manager_id, user.username)
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager' || user.role === 'Manager'
  let isMultiAssignee = false
  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    isMultiAssignee = task.multi_assignment.assignees.some(
      (a) => (a.username || '').toLowerCase() === user.username.toLowerCase()
    )
  }

  let isChainMember = false
  if (Array.isArray(task.assignment_chain)) {
    isChainMember = task.assignment_chain.some(
      (e) => e.user && e.user.toLowerCase() === user.username.toLowerCase()
    )
  }

  const canEdit =
    isAdmin || isCreator || isAssignee || isMultiAssignee || isAssigneeManager || isChainMember

  const attachments: TodoAttachment[] = await Promise.all(
    ((attachmentsRes.data || []) as TodoAttachment[]).map((row) =>
      resolveAttachmentUrl(supabase, row)
    )
  )

  return {
    ...task,
    shares: (sharesRes.data || []) as import('@/types').TodoShare[],
    attachments,
    current_user_can_edit: canEdit,
    current_user_share_can_edit: !!(
      (sharesRes.data || []).find((s: Record<string, unknown>) => s.shared_with === user.username) as Record<string, unknown> | undefined
    )?.can_edit,
  }
}

// ── Update task status (kanban drag or action modal) ──────────────────────────

export async function updateTaskStatusAction(
  todoId: string,
  newStatus: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,manager_id,history,task_status')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isCreator = (task.username as string) === user.username
  const isAssignee = (task.assigned_to as string) === user.username
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isCreator && !isAssignee && !isAdmin) {
    return { success: false, error: 'No permission to update this task status.' }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'status_change',
    user: user.username,
    details: `Status changed from ${task.task_status} to ${newStatus}`,
    from: task.task_status as string,
    to: newStatus,
    timestamp: now,
    icon: '🔄',
    title: 'Status Updated',
  })

  const updatePayload: Record<string, unknown> = {
    task_status: newStatus,
    history: JSON.stringify(history),
    updated_at: now,
  }
  if (newStatus === 'done') {
    updatePayload.completed = true
    updatePayload.completed_at = now
    updatePayload.completed_by = user.username
    if (isCreator) updatePayload.approval_status = 'approved'
    else updatePayload.approval_status = 'pending_approval'
  } else if (newStatus === 'in_progress') {
    updatePayload.completed = false
    updatePayload.completed_at = null
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)
  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Acknowledge task assignment (backlog → todo) ───────────────────────────────

export async function acknowledgeTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.assigned_to as string) !== user.username)
    return { success: false, error: 'Only the assignee can acknowledge this task.' }
  if ((task.task_status as string) !== 'backlog')
    return { success: false, error: 'Task is not waiting for acknowledgement.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'acknowledged',
    user: user.username,
    details: `${user.username} acknowledged the task assignment`,
    timestamp: now,
    icon: '✅',
    title: 'Task Acknowledged',
  })

  await supabase.from('todos').update({
    task_status: 'todo',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  if ((task.username as string) && (task.username as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.username as string,
      type: 'task_assigned',
      title: 'Task Acknowledged',
      body: `${user.username} acknowledged task "${task.title}"`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Duplicate todo ────────────────────────────────────────────────────────────

export async function duplicateTodoAction(todoId: string): Promise<{ success: boolean; error?: string; id?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase.from('todos').select('*').eq('id', todoId).single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const original = existing as Record<string, unknown>
  const now = new Date().toISOString()
  const newId = crypto.randomUUID()

  const history: HistoryEntry[] = [{
    type: 'created',
    user: user.username,
    details: `Duplicated from task "${original.title}"`,
    timestamp: now,
    icon: '📋',
    title: 'Task Duplicated',
  }]

  const payload: Record<string, unknown> = {
    id: newId,
    username: user.username,
    title: `${String(original.title || '').slice(0, 27)} (Copy)`,
    description: original.description || null,
    our_goal: original.our_goal || null,
    completed: false,
    task_status: 'todo',
    priority: original.priority || 'medium',
    category: original.category || null,
    kpi_type: original.kpi_type || null,
    due_date: original.due_date || null,
    expected_due_date: original.expected_due_date || null,
    actual_due_date: original.actual_due_date || null,
    notes: original.notes || null,
    package_name: original.package_name || null,
    app_name: original.app_name || null,
    position: 0,
    archived: false,
    queue_department: null,
    queue_status: null,
    multi_assignment: null,
    assigned_to: null,
    manager_id: null,
    completed_by: null,
    completed_at: null,
    approval_status: 'approved',
    approved_at: null,
    approved_by: null,
    declined_at: null,
    declined_by: null,
    decline_reason: null,
    assignment_chain: JSON.stringify([]),
    history: JSON.stringify(history),
    created_at: now,
    updated_at: now,
  }

  const { error } = await supabase.from('todos').insert(payload)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/tasks')
  return { success: true, id: newId }
}

// ── Claim queued task (dept queue pick) ──────────────────────────────────────

export async function claimQueuedTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,queue_status,queue_department,task_status,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.queue_status as string) !== 'queued')
    return { success: false, error: 'Task is not in the queue.' }
  if (task.assigned_to)
    return { success: false, error: 'Task has already been claimed.' }

  // Check dept match
  const taskDept = ((task.queue_department as string) || '').toLowerCase().trim()
  const userDept = (user.department || '').toLowerCase().trim()
  if (taskDept && userDept && taskDept !== userDept)
    return { success: false, error: 'This task is for a different department.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} claimed this task from the ${task.queue_department} queue`,
    timestamp: now,
    icon: '📥',
    title: 'Task Claimed',
  })

  await supabase.from('todos').update({
    assigned_to: user.username,
    queue_status: 'claimed',
    task_status: 'todo',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  if ((task.username as string) && (task.username as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.username as string,
      type: 'task_assigned',
      title: 'Task Claimed from Queue',
      body: `${user.username} claimed your queued task "${task.title}"`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Update multi-assignment per-assignee status ───────────────────────────────

export async function updateMaAssigneeStatusAction(
  todoId: string,
  newStatus: 'in_progress' | 'completed',
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled || !Array.isArray(ma.assignees))
    return { success: false, error: 'Not a multi-assignment task.' }

  const assigneeIdx = ma.assignees.findIndex(
    (a) => (a.username || '').toLowerCase() === user.username.toLowerCase()
  )
  if (assigneeIdx === -1)
    return { success: false, error: 'You are not an assignee of this task.' }

  const now = new Date().toISOString()
  ma.assignees[assigneeIdx] = {
    ...ma.assignees[assigneeIdx],
    status: newStatus,
    ...(newStatus === 'completed' ? { completed_at: now, notes: notes || undefined } : {}),
  }

  // Recalculate completion percentage
  const total = ma.assignees.length
  const done = ma.assignees.filter((a) => a.status === 'accepted' || a.status === 'completed').length
  ma.completion_percentage = total > 0 ? Math.round((done / total) * 100) : 0

  const history = parseJson<HistoryEntry[]>(task.history, [])
  const statusLabels: Record<string, string> = { in_progress: 'In Progress', completed: 'Submitted' }
  history.push({
    type: newStatus === 'completed' ? 'completion_submitted' : 'started',
    user: user.username,
    details: `[Multi-Assignment] ${user.username} updated status to ${statusLabels[newStatus] ?? newStatus}${notes ? `: ${notes}` : ''}`,
    timestamp: now,
    icon: newStatus === 'completed' ? '📤' : '🚀',
    title: newStatus === 'completed' ? 'Work Submitted' : 'Work Started',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  // Notify task creator if submitted
  if (newStatus === 'completed' && (task.username as string) && (task.username as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.username as string,
      type: 'task_assigned',
      title: 'MA: Work Submitted for Review',
      body: `${user.username} submitted their work for task "${task.title}"`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Accept/reject multi-assignment sub-assignee ───────────────────────────────

export async function acceptMaAssigneeAction(
  todoId: string,
  assigneeUsername: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.username as string) !== user.username)
    return { success: false, error: 'Only the task creator can accept work.' }

  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const idx = ma.assignees.findIndex((a) => (a.username || '').toLowerCase() === assigneeUsername.toLowerCase())
  if (idx === -1) return { success: false, error: 'Assignee not found.' }

  const now = new Date().toISOString()
  ma.assignees[idx] = { ...ma.assignees[idx], status: 'accepted', completed_at: now }
  const done = ma.assignees.filter((a) => a.status === 'accepted').length
  ma.completion_percentage = Math.round((done / ma.assignees.length) * 100)

  const allAccepted = ma.assignees.every((a) => a.status === 'accepted')
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'completed',
    user: user.username,
    details: `${user.username} accepted work from ${assigneeUsername}`,
    timestamp: now,
    icon: '✅',
    title: 'Work Accepted',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    ...(allAccepted ? { completed: true, completed_at: now, task_status: 'done', approval_status: 'approved' } : {}),
    updated_at: now,
  }).eq('id', todoId)

  await createNotification(supabase, {
    userId: assigneeUsername,
    type: 'task_completed',
    title: 'Your Work Was Accepted',
    body: `${user.username} accepted your work on "${task.title}"`,
    relatedId: todoId,
  })

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Delegate multi-assignment slot to another user ────────────────────────────

export async function delegateMaAssigneeAction(
  todoId: string,
  toUsername: string,
  instructions?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const myIdx = ma.assignees.findIndex(
    (a) => (a.username || '').toLowerCase() === user.username.toLowerCase()
  )
  if (myIdx === -1) return { success: false, error: 'You are not a multi-assignee on this task.' }

  const existing_delegates = ma.assignees[myIdx].delegated_to || []
  const alreadyDelegated = existing_delegates.some(
    (d) => (d.username || '').toLowerCase() === toUsername.toLowerCase()
  )
  if (alreadyDelegated) return { success: false, error: 'Already delegated to that user.' }

  const now = new Date().toISOString()
  ma.assignees[myIdx].delegated_to = [
    ...existing_delegates,
    { username: toUsername, status: 'pending', delegation_instructions: instructions || undefined },
  ]

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} delegated their assignment to ${toUsername}${instructions ? `: "${instructions}"` : ''}`,
    timestamp: now,
    icon: '🔄',
    title: 'Task Delegated',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await createNotification(supabase, {
    userId: toUsername,
    type: 'task_assigned',
    title: 'Task Delegated to You',
    body: `${user.username} delegated their part of "${task.title}" to you`,
    relatedId: todoId,
  })

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Internal: create notification ────────────────────────────────────────────

async function createNotification(
  supabase: ReturnType<typeof createServerClient>,
  opts: { userId: string; type: string; title: string; body: string; relatedId: string }
) {
  try {
    await supabase.from('notifications').insert({
      user_id: opts.userId,
      title: opts.title,
      body: opts.body,
      type: opts.type,
      related_id: opts.relatedId,
      is_read: false,
      created_at: new Date().toISOString(),
    })
  } catch { /* silent */ }
}
