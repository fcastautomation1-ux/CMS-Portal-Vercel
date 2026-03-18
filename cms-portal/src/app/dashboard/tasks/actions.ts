'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { isPastPakistanDate } from '@/lib/pakistan-time'
import { buildTaskAttachmentPath, CMS_STORAGE_BUCKET, resolveStorageUrl } from '@/lib/storage'
import { computeTodoStatsFromTodos } from '@/lib/todo-stats'
import { canonicalDepartmentKey, mapDepartmentCsvToOfficial, splitDepartmentsCsv } from '@/lib/department-name'
import type {
  Todo,
  TodoAttachment,
  TodoDetails,
  TodoStats,
  HistoryEntry,
  CreateTodoInput,
  MultiAssignment,
  MultiAssignmentEntry,
  MultiAssignmentSubEntry,
  AssignmentChainEntry,
  ApprovalChainEntry,
} from '@/types'
// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const rawFileUrl = String(row.file_url || '').trim()
  const storagePath = getAttachmentStoragePath(row as unknown as Record<string, unknown>)

  if (!storagePath) {
    const legacyDriveId = String(row.drive_file_id || '').trim()
    if (legacyDriveId && !/^https?:\/\//i.test(legacyDriveId) && !legacyDriveId.includes('/')) {
      return {
        ...row,
        file_url: `https://drive.google.com/uc?id=${encodeURIComponent(legacyDriveId)}`,
      }
    }
    return row
  }

  const { data } = await supabase.storage
    .from(CMS_STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60)

  if (!data?.signedUrl) return row

  return {
    ...row,
    file_url: data.signedUrl,
  }
}

function getAttachmentStoragePath(row: Record<string, unknown>): string {
  const storagePath = String(row.storage_path || '').trim()
  if (storagePath && storagePath.includes('/')) return storagePath

  const driveFileId = String(row.drive_file_id || '').trim()
  if (driveFileId && driveFileId.includes('/')) return driveFileId

  const fileUrl = String(row.file_url || '').trim()
  if (!fileUrl || /^https?:\/\//i.test(fileUrl) || !fileUrl.includes('/')) return ''
  return fileUrl
}

function normalizeTodo(raw: Record<string, unknown>, username: string): Todo {
  const t = raw as unknown as Todo
  t.history = parseJson<HistoryEntry[]>(raw.history, [])
  t.assignment_chain = parseJson<AssignmentChainEntry[]>(raw.assignment_chain, [])
  t.multi_assignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
  t.approval_chain = parseJson<ApprovalChainEntry[]>(raw.approval_chain, [])
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

function addHoursIso(baseIso: string, hours: number): string {
  const base = new Date(baseIso)
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString()
}

function normalizeApprovalUser(value: unknown): string {
  return String(value || '').trim()
}

function getApprovalChainFromTask(task: Record<string, unknown>): ApprovalChainEntry[] {
  const chain = parseJson<ApprovalChainEntry[]>(task.approval_chain, [])
  return Array.isArray(chain) ? chain : []
}

function deriveApprovalUserOrder(task: Record<string, unknown>, completedBy: string): string[] {
  const completedByLower = completedBy.toLowerCase()
  const creator = normalizeApprovalUser(task.username)
  const immediateOwner = findAssignmentStepOwner(task, completedBy)
  
  // If we have an immediate owner, that owner is the ONLY approver for this submission.
  // Once they approve, they will get a "Complete" button to submit to their OWN assigner.
  if (immediateOwner) {
    const ownerLower = immediateOwner.toLowerCase()
    if (ownerLower !== completedByLower) {
      return [immediateOwner]
    }
  }

  // Fallback to creator if no owner found (initial step)
  if (creator && creator.toLowerCase() !== completedByLower) {
    return [creator]
  }

  return []
}

function buildPendingApprovalChain(task: Record<string, unknown>, completedBy: string, now: string): ApprovalChainEntry[] {
  const users = deriveApprovalUserOrder(task, completedBy)
  return users.map((user, index) => ({
    user,
    status: 'pending',
    step: index + 1,
    requested_at: now,
  }))
}

function getMaxMaDueDate(ma: MultiAssignment | null): string | null {
  if (!ma?.enabled || !Array.isArray(ma.assignees)) return null
  let maxTs = 0
  let maxIso: string | null = null
  for (const assignee of ma.assignees) {
    if (!assignee.actual_due_date) continue
    const ts = new Date(assignee.actual_due_date).getTime()
    if (Number.isNaN(ts)) continue
    if (ts > maxTs) {
      maxTs = ts
      maxIso = new Date(ts).toISOString()
    }
  }
  return maxIso
}

function normalizeChainUsername(value: unknown): string {
  return String(value || '').trim()
}

function findAssignmentStepOwner(
  task: Record<string, unknown>,
  assigneeUsername: string
): string | null {
  const target = normalizeChainUsername(assigneeUsername)
  if (!target) return null

  const targetLower = target.toLowerCase()
  const chain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const entry = chain[i]
    const nextUser = normalizeChainUsername(entry?.next_user)
    const actor = normalizeChainUsername(entry?.user)
    if (nextUser && nextUser.toLowerCase() === targetLower && actor) {
      return actor
    }
  }

  const assignedTo = normalizeChainUsername(task.assigned_to)
  if (assignedTo && assignedTo.toLowerCase() === targetLower) {
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const entry = chain[i]
      const role = normalizeChainUsername(entry?.role)
      const actor = normalizeChainUsername(entry?.user)
      if (role === 'claimed_from_department' && actor.toLowerCase() === targetLower) {
        return actor
      }
    }

    const creator = normalizeChainUsername(task.username)
    if (creator) return creator
  }

  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
    const exists = multiAssignment.assignees.some((entry) => normalizeChainUsername(entry.username).toLowerCase() === targetLower)
    if (exists && normalizeChainUsername(multiAssignment.created_by)) {
      return normalizeChainUsername(multiAssignment.created_by)
    }
  }

  return null
}

function findLatestAssignmentChainIndex(
  task: Record<string, unknown>,
  assigneeUsername: string
): number {
  const target = normalizeChainUsername(assigneeUsername).toLowerCase()
  if (!target) return -1
  const chain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (normalizeChainUsername(chain[i]?.next_user).toLowerCase() === target) {
      return i
    }
  }
  return -1
}

function isUserInManagerList(managerIdField: string | null, username: string): boolean {
  if (!managerIdField || !username) return false
  return managerIdField
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .includes(username.toLowerCase())
}

async function getManagedTeamUsernames(
  supabase: ReturnType<typeof createServerClient>,
  user: Awaited<ReturnType<typeof getSession>>
): Promise<string[]> {
  if (!user) return []

  const team = new Set(
    (user.teamMembers || [])
      .map((member) => String(member || '').trim())
      .filter(Boolean)
  )

  const { data: managedRows } = await supabase
    .from('users')
    .select('username')
    .ilike('manager_id', `%${user.username}%`)

  ;(managedRows || []).forEach((row: Record<string, unknown>) => {
    const username = String(row.username || '').trim()
    if (username) team.add(username)
  })

  return Array.from(team)
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

function collectTaskCommentParticipants(
  task: Record<string, unknown>,
  shares: Array<Record<string, unknown>>
): string[] {
  const participants = new Set<string>()

  if (task.username) participants.add(String(task.username))
  if (task.assigned_to) participants.add(String(task.assigned_to))
  if (task.manager_id) {
    String(task.manager_id)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => participants.add(value))
  }

  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  multiAssignment?.assignees?.forEach((assignee) => {
    if (assignee.username) participants.add(assignee.username)
    ;(assignee.delegated_to || []).forEach((subAssignee) => {
      if (subAssignee.username) participants.add(subAssignee.username)
    })
  })

  shares.forEach((share) => {
    if (share.shared_with) participants.add(String(share.shared_with))
  })

  return Array.from(participants)
}

const COMMENT_EDIT_WINDOW_MS = 10 * 60 * 1000

function canModifyComment(entry: HistoryEntry, username: string): boolean {
  if (entry.type !== 'comment') return false
  if ((entry.user || '').toLowerCase() !== username.toLowerCase()) return false
  if (entry.is_deleted) return false

  const sentAt = new Date(entry.timestamp).getTime()
  if (Number.isNaN(sentAt)) return false
  return Date.now() - sentAt <= COMMENT_EDIT_WINDOW_MS
}

function touchMultiAssignmentProgress(ma: MultiAssignment) {
  const assignees = Array.isArray(ma.assignees) ? ma.assignees : []
  const acceptedOrCompleted = assignees.filter((entry) => entry.status === 'accepted' || entry.status === 'completed').length
  ma.completion_percentage = assignees.length > 0 ? Math.round((acceptedOrCompleted / assignees.length) * 100) : 0
  ma.all_completed = assignees.length > 0 && assignees.every((entry) => entry.status === 'accepted')
}

function findDelegatedAssignment(
  ma: MultiAssignment,
  username: string
): { assigneeIndex: number; subIndex: number; assignee: MultiAssignmentEntry; subAssignee: MultiAssignmentSubEntry } | null {
  const target = username.toLowerCase()
  for (let assigneeIndex = 0; assigneeIndex < ma.assignees.length; assigneeIndex += 1) {
    const assignee = ma.assignees[assigneeIndex]
    const delegated = Array.isArray(assignee.delegated_to) ? assignee.delegated_to : []
    const subIndex = delegated.findIndex((entry) => (entry.username || '').toLowerCase() === target)
    if (subIndex !== -1) {
      return {
        assigneeIndex,
        subIndex,
        assignee,
        subAssignee: delegated[subIndex],
      }
    }
  }
  return null
}

async function notifyUsers(
  supabase: ReturnType<typeof createServerClient>,
  usernames: Iterable<string>,
  payload: { type: string; title: string; body: string; relatedId: string },
  skipUsername?: string
) {
  const seen = new Set<string>()
  for (const username of usernames) {
    const normalized = String(username || '').trim()
    if (!normalized) continue
    if (skipUsername && normalized.toLowerCase() === skipUsername.toLowerCase()) continue
    if (seen.has(normalized.toLowerCase())) continue
    seen.add(normalized.toLowerCase())
    await createNotification(supabase, {
      userId: normalized,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      relatedId: payload.relatedId,
    })
  }
}

// ── Get all todos (role-filtered) ─────────────────────────────────────────────

export async function getTodos(): Promise<Todo[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const isAdminOrSM =
    user.role === 'Admin' || user.role === 'Super Manager'

  // Fetch users + departments for department canonical mapping
  const [{ data: allUsers }, { data: allDepartments }] = await Promise.all([
    supabase
      .from('users')
      .select('username,manager_id,team_members,department,avatar_data'),
    supabase
      .from('departments')
      .select('name'),
  ])

  const canonicalToOfficial: Record<string, string> = {}
  ;((allDepartments ?? []) as Array<{ name: string }>).forEach((dept) => {
    const key = canonicalDepartmentKey(dept.name)
    if (key && !canonicalToOfficial[key]) canonicalToOfficial[key] = dept.name
  })

  const mapSingleDepartment = (value: string | null | undefined) => {
    const key = canonicalDepartmentKey(value)
    return (key && canonicalToOfficial[key]) || (value ? String(value).trim() : '')
  }

  const userDeptMap: Record<string, string> = {}
  const userAvatarMap: Record<string, string | null> = {}
  ;(allUsers || []).forEach((u: Record<string, unknown>) => {
    if (u.username && u.department) {
      userDeptMap[String(u.username).toLowerCase()] = mapDepartmentCsvToOfficial(String(u.department), canonicalToOfficial)
    }
    if (u.username) {
      userAvatarMap[String(u.username)] = String(u.avatar_data || '').trim() || null
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
      t.participant_avatars = Object.fromEntries(
        Object.entries(userAvatarMap).filter(([username]) => {
          const lower = username.toLowerCase()
          return lower === String(t.username || '').toLowerCase() ||
            lower === String(t.assigned_to || '').toLowerCase()
        })
      )
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
  const [ownedRes, assignedRes, completedByRes, pendingApproverRes, sharedRes, deptQueueRes] = await Promise.all([
    supabase.from('todos').select('*').eq('username', user.username),
    supabase.from('todos').select('*').eq('assigned_to', user.username),
    supabase.from('todos').select('*').eq('completed_by', user.username),
    supabase.from('todos').select('*').eq('pending_approver', user.username),
    supabase.from('todo_shares').select('todo_id').eq('shared_with', user.username),
    user.department
      ? supabase
          .from('todos')
          .select('*')
          .eq('queue_status', 'queued')
          .or('assigned_to.is.null,assigned_to.eq.')
      : Promise.resolve({ data: [] }),
  ])

  const userDeptKeys = splitDepartmentsCsv(user.department)
    .map((dept) => canonicalDepartmentKey(dept))
    .filter(Boolean)

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
      t.queue_department = mapSingleDepartment(t.queue_department || null) || null
      t.category = mapSingleDepartment(t.category || null) || t.category
      Object.assign(t, flags)
      t.creator_department = userDeptMap[t.username?.toLowerCase()] || null
      t.assignee_department = userDeptMap[(t.assigned_to || '').toLowerCase()] || null
      const participantUsernames = new Set<string>()
      if (t.username) participantUsernames.add(String(t.username))
      if (t.assigned_to) participantUsernames.add(String(t.assigned_to))
      ;(t.assignment_chain || []).forEach((entry) => {
        if (entry.user) participantUsernames.add(String(entry.user))
      })
      if (t.multi_assignment?.enabled) {
        t.multi_assignment.assignees.forEach((entry) => {
          if (entry.username) participantUsernames.add(String(entry.username))
        })
      }
      t.participant_avatars = Object.fromEntries(
        Array.from(participantUsernames).map((username) => [username, userAvatarMap[username] ?? null])
      )
      allTasks.push(t)
      taskIds.add(t.id)
    }
  }

  ;(ownedRes.data || []).forEach((r: Record<string, unknown>) => addTask(r))
  ;(assignedRes.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_assigned_to_me: true }))
  ;(completedByRes.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_completed_by_me: true }))
  ;(pendingApproverRes.data || []).forEach((r: Record<string, unknown>) => addTask(r, { is_chain_member: true }))
  ;((deptQueueRes as { data: Record<string, unknown>[] | null }).data || []).forEach((r) => {
    const queueDept = String(r.queue_department || '')
    const queueDeptKey = canonicalDepartmentKey(queueDept)
    if (userDeptKeys.length === 0 || (queueDeptKey && userDeptKeys.includes(queueDeptKey))) {
      addTask(r, { is_department_queue: true })
    }
  })

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
  return computeTodoStatsFromTodos(todos)
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

export async function getUsersForAssignment(): Promise<Array<{ username: string; role: string; department: string | null; avatar_data: string | null }>> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('username,role,department,avatar_data')
    .order('username')
  const rows = (data || []).filter((u: Record<string, unknown>) => u.username !== user.username) as Array<{
    username: string
    role: string
    department: string | null
    avatar_data: string | null
  }>
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      avatar_data: await resolveStorageUrl(supabase, row.avatar_data),
    }))
  )
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
    const rolledMaDue = getMaxMaDueDate(nextMultiAssignment)

    payload.assigned_to = nextAssignedTo
    payload.manager_id = nextManagerId
    payload.queue_department = nextQueueDept
    payload.queue_status = nextQueueStatus
    payload.multi_assignment = nextMultiAssignment
      ? JSON.stringify(nextMultiAssignment)
      : null
    if (rolledMaDue) {
      payload.due_date = rolledMaDue
      payload.expected_due_date = rolledMaDue
    }
    payload.workflow_state =
      input.routing === 'department'
        ? 'queued_department'
        : input.routing === 'multi'
          ? 'split_to_multi'
          : nextAssignedTo
            ? 'claimed_by_department'
            : 'in_progress'
    payload.pending_approver = null
    payload.approval_chain = JSON.stringify([])
    payload.approval_requested_at = null
    payload.approval_sla_due_at = null
    payload.last_handoff_at = now
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
    const rolledMaDue = getMaxMaDueDate(multiAssignment)

    const assignmentChain: AssignmentChainEntry[] = []
    if (assignedTo) {
      assignmentChain.push({
        user: user.username,
        role: 'assignee',
        assignedAt: now,
        next_user: assignedTo,
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
      expected_due_date: input.due_date || rolledMaDue || null,
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
      workflow_state:
        input.routing === 'department'
          ? 'queued_department'
          : input.routing === 'multi'
            ? 'split_to_multi'
            : assignedTo
              ? 'claimed_by_department'
              : 'in_progress',
      pending_approver: null,
      approval_chain: JSON.stringify([]),
      approval_requested_at: null,
      approval_sla_due_at: null,
      last_handoff_at: now,
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

    if (rolledMaDue) {
      payload.due_date = rolledMaDue
      payload.expected_due_date = rolledMaDue
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

  const { data: attachments } = await supabase
    .from('todo_attachments')
    .select('*')
    .eq('todo_id', todoId)

  const storagePaths = ((attachments || []) as Record<string, unknown>[])
    .map((row) => getAttachmentStoragePath(row))
    .filter(Boolean)

  if (storagePaths.length > 0) {
    await supabase.storage.from(CMS_STORAGE_BUCKET).remove(storagePaths)
  }

  await supabase.from('todo_attachments').delete().eq('todo_id', todoId)
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
    workflow_state: 'in_progress',
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
  completed: boolean,
  submissionNote?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,manager_id,title,history,approval_status,completed,completed_by,multi_assignment,assignment_chain,approval_chain,pending_approver')
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
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)

  if (completed) {
    const note = String(submissionNote || '').trim()
    if (isOwner) {
      if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
        multiAssignment.assignees = multiAssignment.assignees.map((entry) => ({
          ...entry,
          status: 'accepted',
          completed_at: entry.completed_at ?? now,
          accepted_at: now,
          accepted_by: user.username,
        }))
        touchMultiAssignmentProgress(multiAssignment)
      }
      updateData = {
        ...updateData,
        completed: true,
        completed_at: now,
        completed_by: user.username,
        task_status: 'done',
        approval_status: 'approved',
        workflow_state: 'final_approved',
        pending_approver: null,
        approval_chain: JSON.stringify([]),
        approval_requested_at: null,
        approval_sla_due_at: null,
        multi_assignment: multiAssignment ? JSON.stringify(multiAssignment) : undefined,
      }
      history.push({
        type: 'completed',
        user: user.username,
        details: note ? `Task marked as completed by ${user.username}. Summary: ${note}` : `Task marked as completed by ${user.username}`,
        timestamp: now,
        icon: '✅',
        title: 'Task Completed',
      })
    } else {
      const pendingChain = buildPendingApprovalChain(task, user.username, now)
      const nextApprover = pendingChain[0]?.user || (task.username as string)
      updateData = {
        ...updateData,
        completed: false,
        approval_status: 'pending_approval',
        completed_by: user.username,
        task_status: 'done',
        workflow_state: 'submitted_for_approval',
        pending_approver: nextApprover,
        approval_chain: JSON.stringify(pendingChain),
        approval_requested_at: now,
        approval_sla_due_at: addHoursIso(now, 48),
      }
      history.push({
        type: 'completion_submitted',
        user: user.username,
        details: note
          ? `${user.username} submitted task for completion and is awaiting approval from ${nextApprover}. Summary: ${note}`
          : `${user.username} submitted task for completion and is awaiting approval from ${nextApprover}`,
        timestamp: now,
        icon: '⏳',
        title: 'Completion Submitted',
      })
      // Notify next approver
      await createNotification(supabase, {
        userId: nextApprover,
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
      workflow_state: 'in_progress',
      pending_approver: null,
      approval_chain: JSON.stringify([]),
      approval_requested_at: null,
      approval_sla_due_at: null,
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
    .select('username,completed_by,assigned_to,title,history,approval_status,assignment_chain,multi_assignment,pending_approver,approval_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.approval_status as string) !== 'pending_approval') return { success: false, error: 'Task is not pending approval.' }

  const configuredPendingApprover = normalizeApprovalUser(task.pending_approver)
  const expectedApprover = configuredPendingApprover || normalizeApprovalUser(task.username)
  if (expectedApprover.toLowerCase() !== user.username.toLowerCase()) {
    return { success: false, error: `Only ${expectedApprover} can approve at this stage.` }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const approvalChain = getApprovalChainFromTask(task)

  const currentStepIndex = approvalChain.findIndex(
    (entry) => normalizeApprovalUser(entry.user).toLowerCase() === user.username.toLowerCase() && entry.status === 'pending',
  )
  if (currentStepIndex !== -1) {
    approvalChain[currentStepIndex] = {
      ...approvalChain[currentStepIndex],
      status: 'approved',
      acted_at: now,
      acted_by: user.username,
    }
  }

  const nextPending = approvalChain.find((entry) => entry.status === 'pending')
  history.push({
    type: 'approved',
    user: user.username,
    details: nextPending
      ? `Task completion approved by ${user.username} and forwarded to ${nextPending.user}`
      : `Task completion approved by ${user.username}`,
    timestamp: now,
    icon: '✅',
    title: nextPending ? 'Approval Forwarded' : 'Completion Approved',
  })

  if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
    multiAssignment.assignees = multiAssignment.assignees.map((entry) => {
      if ((entry.username || '').toLowerCase() !== String(task.completed_by || '').toLowerCase()) return entry
      return {
        ...entry,
        status: 'accepted',
        completed_at: entry.completed_at ?? now,
        accepted_at: now,
        accepted_by: user.username,
      }
    })
    touchMultiAssignmentProgress(multiAssignment)
  }

  const updatePayload: Record<string, unknown> = {
    task_status: 'done',
    multi_assignment: multiAssignment ? JSON.stringify(multiAssignment) : undefined,
    history: JSON.stringify(history),
    approval_chain: JSON.stringify(approvalChain),
    updated_at: now,
  }

  if (nextPending) {
    updatePayload.completed = false
    updatePayload.approval_status = 'pending_approval'
    updatePayload.pending_approver = nextPending.user
    updatePayload.approval_requested_at = now
    updatePayload.approval_sla_due_at = addHoursIso(now, 48)
    updatePayload.workflow_state = 'submitted_for_approval'
  } else {
    updatePayload.completed = true
    updatePayload.completed_at = now
    updatePayload.approval_status = 'approved'
    updatePayload.pending_approver = null
    updatePayload.approval_requested_at = null
    updatePayload.approval_sla_due_at = null
    updatePayload.approved_at = now
    updatePayload.approved_by = user.username
    updatePayload.workflow_state = 'final_approved'
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  // Notify all involved users
  const notifySet = new Set<string>()
  if (task.completed_by && (task.completed_by as string) !== user.username) notifySet.add(task.completed_by as string)
  if (task.assigned_to && (task.assigned_to as string) !== user.username) notifySet.add(task.assigned_to as string)

  for (const targetUser of notifySet) {
    await createNotification(supabase, {
      userId: targetUser,
      type: 'task_assigned',
      title: nextPending ? 'Task Approval Forwarded' : 'Task Approved!',
      body: nextPending
        ? `${user.username} approved "${task.title}" and forwarded it to ${nextPending.user}.`
        : `${user.username} approved completion of "${task.title}". Task is now complete.`,
      relatedId: todoId,
    })
  }

  if (nextPending && nextPending.user.toLowerCase() !== user.username.toLowerCase()) {
    await createNotification(supabase, {
      userId: nextPending.user,
      type: 'task_assigned',
      title: 'Approval Required',
      body: `${user.username} forwarded "${task.title}" to you for approval.`,
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
    .select('username,completed_by,assigned_to,title,history,approval_status,pending_approver,approval_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.approval_status as string) !== 'pending_approval') return { success: false, error: 'Task is not pending approval.' }

  const expectedApprover = normalizeApprovalUser(task.pending_approver) || normalizeApprovalUser(task.username)
  if (expectedApprover.toLowerCase() !== user.username.toLowerCase()) {
    return { success: false, error: `Only ${expectedApprover} can decline at this stage.` }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const approvalChain = getApprovalChainFromTask(task).map((entry) => {
    if (entry.status !== 'pending') return entry
    if (normalizeApprovalUser(entry.user).toLowerCase() !== user.username.toLowerCase()) return entry
    return {
      ...entry,
      status: 'declined',
      acted_at: now,
      acted_by: user.username,
      comment: reason || undefined,
    }
  })
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
    workflow_state: 'rework_required',
    pending_approver: null,
    approval_chain: JSON.stringify(approvalChain),
    approval_requested_at: null,
    approval_sla_due_at: null,
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
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const isMultiAssignee = multiAssignment?.assignees?.some(
    (assignee) => (assignee.username || '').toLowerCase() === user.username.toLowerCase()
  ) ?? false
  const isDelegatedSubAssignee = multiAssignment?.assignees?.some((assignee) =>
    Array.isArray(assignee.delegated_to) &&
    assignee.delegated_to.some((subAssignee) => (subAssignee.username || '').toLowerCase() === user.username.toLowerCase())
  ) ?? false

  if (!isCreator && !isAssignee && !isManager && !isAdmin && !isMultiAssignee && !isDelegatedSubAssignee) {
    const { data: share } = await supabase
      .from('todo_shares')
      .select('can_edit')
      .eq('todo_id', todoId)
      .eq('shared_with', user.username)
      .single()
    if (!share) return { success: false, error: 'No permission to comment on this task.' }
  }

  const now = new Date().toISOString()
  const participants = collectTaskCommentParticipants(task, (sharesRes.data || []) as Array<Record<string, unknown>>)
  const mentionUsers = extractMentionedUsernames(message, participants)
  const unreadBy = participants.filter((username) => username.toLowerCase() !== user.username.toLowerCase())

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

  const notifyUsers = new Set<string>(unreadBy)
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

export async function editTodoCommentAction(
  todoId: string,
  messageId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!message.trim()) return { success: false, error: 'Message cannot be empty.' }

  const supabase = createServerClient()
  const [existingRes, sharesRes] = await Promise.all([
    supabase
      .from('todos')
      .select('username,assigned_to,manager_id,history,multi_assignment')
      .eq('id', todoId)
      .single(),
    supabase.from('todo_shares').select('shared_with').eq('todo_id', todoId),
  ])

  const existing = existingRes.data
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const commentIndex = history.findIndex((entry) => entry.message_id === messageId)
  if (commentIndex === -1) return { success: false, error: 'Message not found.' }

  const currentComment = history[commentIndex]
  if (!canModifyComment(currentComment, user.username)) {
    return { success: false, error: 'You can edit your own message only within 10 minutes.' }
  }

  const participants = collectTaskCommentParticipants(task, (sharesRes.data || []) as Array<Record<string, unknown>>)
  const mentionUsers = extractMentionedUsernames(message, participants)
  const unreadBy = participants.filter((username) => username.toLowerCase() !== user.username.toLowerCase())
  const now = new Date().toISOString()

  history[commentIndex] = {
    ...currentComment,
    details: message.trim(),
    mention_users: mentionUsers,
    unread_by: unreadBy,
    read_by: Array.from(new Set([...(currentComment.read_by || []), user.username])),
    edited_at: now,
  }

  const { error } = await supabase.from('todos').update({
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function deleteTodoCommentAction(
  todoId: string,
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('history')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const history = parseJson<HistoryEntry[]>((existing as Record<string, unknown>).history, [])
  const commentIndex = history.findIndex((entry) => entry.message_id === messageId)
  if (commentIndex === -1) return { success: false, error: 'Message not found.' }

  const currentComment = history[commentIndex]
  if (!canModifyComment(currentComment, user.username)) {
    return { success: false, error: 'You can delete your own message only within 10 minutes.' }
  }

  const now = new Date().toISOString()
  history[commentIndex] = {
    ...currentComment,
    mention_users: [],
    unread_by: [],
    is_deleted: true,
    deleted_at: now,
    edited_at: undefined,
  }

  const { error } = await supabase.from('todos').update({
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)
  if (error) return { success: false, error: error.message }

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
      .select('id,username,assigned_to,manager_id,multi_assignment,completed')
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

  if (task.completed === true) {
    return { success: false, error: 'Completed tasks are locked for attachment changes.' }
  }

  if (!canAttach) {
    return { success: false, error: 'No permission to attach files.' }
  }

  const basePayload = {
    todo_id: input.todo_id,
    file_name: input.file_name,
    file_size: input.file_size ?? null,
    file_url: input.file_url || input.storage_path || '',
    storage_path: input.storage_path || null,
    uploaded_by: user.username,
  }

  const withMimePayload = {
    ...basePayload,
    mime_type: input.mime_type ?? null,
  }

  const initialInsert = await supabase.from('todo_attachments').insert(withMimePayload)
  if (initialInsert.error) {
    const message = initialInsert.error.message || ''
    const missingMimeColumn =
      message.includes("'mime_type'") &&
      message.toLowerCase().includes('schema cache')

    if (!missingMimeColumn) {
      return { success: false, error: message }
    }

    const fallbackInsert = await supabase.from('todo_attachments').insert(basePayload)
    if (fallbackInsert.error) return { success: false, error: fallbackInsert.error.message }
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function markTaskCommentsReadAction(
  todoId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('history')
    .eq('id', todoId)
    .single()

  if (!existing) return { success: false, error: 'Task not found.' }

  const history = parseJson<HistoryEntry[]>((existing as Record<string, unknown>).history, [])
  let changed = false

  const nextHistory = history.map((entry) => {
    if (entry.type !== 'comment' || entry.is_deleted) return entry

    const nextUnreadBy = Array.isArray(entry.unread_by)
      ? entry.unread_by.filter((username) => String(username).toLowerCase() !== user.username.toLowerCase())
      : []
    const nextReadBy = Array.from(new Set([...(entry.read_by || []), user.username]))

    const unreadChanged = (entry.unread_by || []).length !== nextUnreadBy.length
    const readChanged = (entry.read_by || []).length !== nextReadBy.length
    if (!unreadChanged && !readChanged) return entry

    changed = true
    return {
      ...entry,
      unread_by: nextUnreadBy,
      read_by: nextReadBy,
    }
  })

  if (!changed) return { success: true }

  const now = new Date().toISOString()
  const { error } = await supabase.from('todos').update({
    history: JSON.stringify(nextHistory),
    updated_at: now,
  }).eq('id', todoId)

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
      .select('id,username,assigned_to,manager_id,multi_assignment,completed')
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

  if (task.completed === true) {
    return { success: false, error: 'Completed tasks are locked for attachment changes.' }
  }

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

export async function deleteTodoAttachmentAction(
  todoId: string,
  attachmentId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const [taskRes, attachmentRes] = await Promise.all([
    supabase.from('todos').select('id,username,completed').eq('id', todoId).single(),
    supabase.from('todo_attachments').select('*').eq('id', attachmentId).eq('todo_id', todoId).single(),
  ])

  if (!taskRes.data) return { success: false, error: 'Task not found.' }
  if (!attachmentRes.data) return { success: false, error: 'Attachment not found.' }

  const task = taskRes.data as Record<string, unknown>
  const attachment = attachmentRes.data as Record<string, unknown>

  if (task.completed === true) {
    return { success: false, error: 'Completed tasks are locked. Attachments cannot be removed.' }
  }

  const canDelete =
    String(task.username || '') === user.username ||
    String(attachment.uploaded_by || '') === user.username ||
    user.role === 'Admin' ||
    user.role === 'Super Manager'

  if (!canDelete) {
    return { success: false, error: 'Only the uploader, task creator, or admin can remove this attachment.' }
  }

  const storagePath = getAttachmentStoragePath(attachment)
  if (storagePath) {
    await supabase.storage.from(CMS_STORAGE_BUCKET).remove([storagePath])
  }

  const { error } = await supabase.from('todo_attachments').delete().eq('id', attachmentId).eq('todo_id', todoId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function getTodoDetails(todoId: string): Promise<TodoDetails | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = createServerClient()
  const [taskRes, sharesRes, attachmentsRes] = await Promise.all([
    supabase.from('todos').select('*').eq('id', todoId).single(),
    supabase.from('todo_shares').select('*').eq('todo_id', todoId),
    supabase.from('todo_attachments').select('*').eq('todo_id', todoId).order('created_at', { ascending: false }),
  ])

  if (!taskRes.data) return null

  const task = normalizeTodo(taskRes.data as Record<string, unknown>, user.username)
  const participantUsernames = new Set<string>()
  if (task.username) participantUsernames.add(task.username)
  if (task.assigned_to) participantUsernames.add(task.assigned_to)
  if (task.manager_id) {
    String(task.manager_id)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => participantUsernames.add(value))
  }
  task.multi_assignment?.assignees?.forEach((assignee) => {
    if (assignee.username) participantUsernames.add(assignee.username)
    ;(assignee.delegated_to || []).forEach((subAssignee) => {
      if (subAssignee.username) participantUsernames.add(subAssignee.username)
    })
  })
  ;(sharesRes.data || []).forEach((share: Record<string, unknown>) => {
    if (share.shared_with) participantUsernames.add(String(share.shared_with))
  })

  const { data: usersData } = participantUsernames.size > 0
    ? await supabase.from('users').select('username,department,avatar_data').in('username', Array.from(participantUsernames))
    : { data: [] as Array<{ username: string; department: string | null; avatar_data: string | null }> }

  const userDeptMap: Record<string, string> = {}
  const participantAvatars: Record<string, string | null> = {}
  const resolvedUsers = await Promise.all(
    ((usersData || []) as Array<{ username: string; department: string | null; avatar_data: string | null }>).map(async (row) => ({
      ...row,
      avatar_data: await resolveStorageUrl(supabase, row.avatar_data),
    }))
  )
  resolvedUsers.forEach((row) => {
    if (!row.username) return
    if (row.department) {
      userDeptMap[String(row.username).toLowerCase()] = String(row.department)
    }
    participantAvatars[String(row.username)] = row.avatar_data ?? null
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
    shares: ((sharesRes.data || []) as import('@/types').TodoShare[]).map((share) => ({
      ...share,
      avatar_data: participantAvatars[share.shared_with] ?? null,
    })),
    attachments,
    current_user_can_edit: canEdit,
    current_user_share_can_edit: !!(
      (sharesRes.data || []).find((s: Record<string, unknown>) => s.shared_with === user.username) as Record<string, unknown> | undefined
    )?.can_edit,
    participant_avatars: participantAvatars,
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

  const oldStatus = String(task.task_status || '')
  if (oldStatus === 'done' && newStatus !== 'done' && !isCreator) {
    return { success: false, error: 'Only the task creator can reopen a completed task.' }
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
    if (isCreator) {
      updatePayload.approval_status = 'approved'
      updatePayload.workflow_state = 'final_approved'
      updatePayload.pending_approver = null
      updatePayload.approval_chain = JSON.stringify([])
      updatePayload.approval_requested_at = null
      updatePayload.approval_sla_due_at = null
    } else {
      const pendingChain = buildPendingApprovalChain(task, user.username, now)
      const nextApprover = pendingChain[0]?.user || (task.username as string)
      updatePayload.approval_status = 'pending_approval'
      updatePayload.workflow_state = 'submitted_for_approval'
      updatePayload.pending_approver = nextApprover
      updatePayload.approval_chain = JSON.stringify(pendingChain)
      updatePayload.approval_requested_at = now
      updatePayload.approval_sla_due_at = addHoursIso(now, 48)
    }
  } else if (newStatus === 'in_progress') {
    updatePayload.completed = false
    updatePayload.completed_at = null
    updatePayload.approval_status = 'approved'
    updatePayload.workflow_state = 'in_progress'
    updatePayload.pending_approver = null
    updatePayload.approval_chain = JSON.stringify([])
    updatePayload.approval_requested_at = null
    updatePayload.approval_sla_due_at = null
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
    workflow_state: 'claimed_by_department',
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
    .select('username,assigned_to,queue_status,queue_department,task_status,history,title,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.queue_status as string) !== 'queued')
    return { success: false, error: 'Task is not in the queue.' }
  if (task.assigned_to)
    return { success: false, error: 'Task has already been claimed.' }

  // Check dept match
  const taskDept = canonicalDepartmentKey((task.queue_department as string) || '')
  const userDepts = splitDepartmentsCsv(user.department).map((d) => canonicalDepartmentKey(d)).filter(Boolean)
  if (taskDept && userDepts.length > 0 && !userDepts.includes(taskDept))
    return { success: false, error: 'This task is for a different department.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} claimed this task from the ${task.queue_department} queue`,
    timestamp: now,
    icon: '📥',
    title: 'Task Claimed',
  })
  assignmentChain.push({
    user: user.username,
    role: 'claimed_from_department',
    assignedAt: now,
  })

  await supabase.from('todos').update({
    assigned_to: user.username,
    queue_status: 'claimed',
    task_status: 'todo',
    workflow_state: 'claimed_by_department',
    assignment_chain: JSON.stringify(assignmentChain),
    last_handoff_at: now,
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

// ── Reassign task handoff ────────────────────────────────────────────────────

export async function assignQueuedTaskToTeamMemberAction(
  todoId: string,
  toUsername: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const target = String(toUsername || '').trim()
  if (!target) return { success: false, error: 'Team member is required.' }

  const supabase = createServerClient()
  const managedTeam = await getManagedTeamUsernames(supabase, user)
  const managedTeamLower = new Set(managedTeam.map((member) => member.toLowerCase()))

  if (!managedTeamLower.has(target.toLowerCase())) {
    return { success: false, error: 'You can only assign queued tasks to your own team members.' }
  }

  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,queue_status,queue_department,task_status,history,title,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.queue_status as string) !== 'queued') {
    return { success: false, error: 'Task is not in the queue.' }
  }
  if (task.assigned_to) {
    return { success: false, error: 'Task has already been assigned.' }
  }

  const taskDept = canonicalDepartmentKey((task.queue_department as string) || '')
  const userDepts = splitDepartmentsCsv(user.department).map((d) => canonicalDepartmentKey(d)).filter(Boolean)
  if (taskDept && userDepts.length > 0 && !userDepts.includes(taskDept)) {
    return { success: false, error: 'This task is for a different department.' }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} assigned this queued task to ${target}${task.queue_department ? ` from the ${task.queue_department} queue` : ''}`,
    timestamp: now,
    icon: '📥',
    title: 'Queued Task Assigned',
  })
  assignmentChain.push({
    user: user.username,
    role: 'assigned_from_department_queue',
    assignedAt: now,
    next_user: target,
  })

  await supabase.from('todos').update({
    assigned_to: target,
    manager_id: user.username,
    queue_status: 'claimed',
    task_status: 'todo',
    workflow_state: 'assigned_from_department_queue',
    assignment_chain: JSON.stringify(assignmentChain),
    last_handoff_at: now,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(
    supabase,
    [target, task.username as string],
    {
      type: 'task_assigned',
      title: 'Queued Task Assigned',
      body: `${user.username} assigned "${task.title}" to ${target}.`,
      relatedId: todoId,
    },
    user.username,
  )

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function reassignTaskAction(
  todoId: string,
  toUsername: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const target = String(toUsername || '').trim()
  if (!target) return { success: false, error: 'Target assignee is required.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,completed,approval_status,title,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isCreator = (task.username as string) === user.username
  const isCurrentAssignee = (task.assigned_to as string) === user.username
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isCreator && !isCurrentAssignee && !isAdmin) {
    return { success: false, error: 'Only creator, current assignee, or admin can reassign this task.' }
  }
  if ((task.completed as boolean) === true) {
    return { success: false, error: 'Completed tasks cannot be reassigned.' }
  }
  if ((task.approval_status as string) === 'pending_approval') {
    return { success: false, error: 'Task is awaiting approval and cannot be reassigned.' }
  }
  if ((task.assigned_to as string) === target) {
    return { success: false, error: 'Task is already assigned to this user.' }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  const fromUser = String(task.assigned_to || user.username)

  assignmentChain.push({
    user: user.username,
    role: 'reassigned',
    assignedAt: now,
    next_user: target,
    feedback: reason?.trim() || undefined,
  })

  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} reassigned task from ${fromUser} to ${target}${reason?.trim() ? `. Reason: ${reason.trim()}` : ''}`,
    timestamp: now,
    icon: '🔁',
    title: 'Task Reassigned',
  })

  await supabase.from('todos').update({
    assigned_to: target,
    manager_id: target,
    task_status: 'todo',
    workflow_state: 'reassigned',
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    pending_approver: null,
    approval_chain: JSON.stringify([]),
    approval_requested_at: null,
    approval_sla_due_at: null,
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(
    supabase,
    [target, task.username as string],
    {
      type: 'task_assigned',
      title: 'Task Reassigned',
      body: `${user.username} reassigned "${task.title}" to ${target}.`,
      relatedId: todoId,
    },
    user.username,
  )

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Convert single task to multi-assignment ──────────────────────────────────

export async function sendTaskToDepartmentQueueAction(
  todoId: string,
  department: string,
  dueDate: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const targetDepartment = String(department || '').trim()
  if (!targetDepartment) return { success: false, error: 'Department is required.' }
  const targetDueDate = String(dueDate || '').trim()
  if (!targetDueDate) return { success: false, error: 'Due date is required.' }

  const parsedDueDate = new Date(targetDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  if (parsedDueDate.getTime() <= Date.now()) return { success: false, error: 'Due date must be in the future.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,completed,approval_status,title,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isCreator = (task.username as string) === user.username
  const isCurrentAssignee = (task.assigned_to as string) === user.username
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isCreator && !isCurrentAssignee && !isAdmin) {
    return { success: false, error: 'Only creator, current assignee, or admin can send this task to a department.' }
  }
  if ((task.completed as boolean) === true) {
    return { success: false, error: 'Completed tasks cannot be routed to a department queue.' }
  }
  if ((task.approval_status as string) === 'pending_approval') {
    return { success: false, error: 'Task is awaiting approval and cannot be routed right now.' }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  assignmentChain.push({
    user: user.username,
    role: 'routed_to_department_queue',
    assignedAt: now,
    next_user: targetDepartment,
    feedback: note?.trim() || undefined,
  })

  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} routed task to ${targetDepartment} with due date ${dueIso}${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
    timestamp: now,
    icon: '📤',
    title: 'Sent To Department Queue',
  })

  await supabase.from('todos').update({
    assigned_to: null,
    manager_id: null,
    queue_department: targetDepartment,
    queue_status: 'queued',
    task_status: 'backlog',
    workflow_state: 'queued_for_department',
    due_date: dueIso,
    expected_due_date: dueIso,
    actual_due_date: null,
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    pending_approver: null,
    approval_chain: JSON.stringify([]),
    approval_requested_at: null,
    approval_sla_due_at: null,
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  if ((task.username as string) && (task.username as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.username as string,
      type: 'task_assigned',
      title: 'Task Sent To Department Queue',
      body: `${user.username} routed "${task.title}" to ${targetDepartment} with due date ${dueIso}.`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function convertTaskToMultiAssignmentAction(
  todoId: string,
  assignees: Array<{ username: string; actual_due_date?: string | null }>,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  if (!Array.isArray(assignees) || assignees.length === 0) {
    return { success: false, error: 'At least one assignee is required.' }
  }

  const normalizedAssignees = assignees
    .map((entry) => ({
      username: String(entry.username || '').trim(),
      actual_due_date: entry.actual_due_date || null,
    }))
    .filter((entry) => Boolean(entry.username))

  if (normalizedAssignees.length === 0) {
    return { success: false, error: 'Invalid assignee payload.' }
  }
  if (normalizedAssignees.some((entry) => !entry.actual_due_date)) {
    return { success: false, error: 'Each assignee must have a due date.' }
  }
  if (normalizedAssignees.some((entry) => Number.isNaN(new Date(String(entry.actual_due_date)).getTime()))) {
    return { success: false, error: 'One or more assignee due dates are invalid.' }
  }
  if (normalizedAssignees.some((entry) => new Date(String(entry.actual_due_date)).getTime() <= Date.now())) {
    return { success: false, error: 'Assignee due dates must be in the future.' }
  }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,completed,multi_assignment,approval_status,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isCreator = (task.username as string) === user.username
  const isAssignee = (task.assigned_to as string) === user.username
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isCreator && !isAssignee && !isAdmin) {
    return { success: false, error: 'Only creator, current assignee, or admin can split into multi-assignment.' }
  }

  const existingMa = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (existingMa?.enabled) return { success: false, error: 'Task is already multi-assigned.' }
  if ((task.completed as boolean) === true) return { success: false, error: 'Completed tasks cannot be split.' }
  if ((task.approval_status as string) === 'pending_approval') return { success: false, error: 'Task is pending approval and cannot be split.' }

  const now = new Date().toISOString()
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  const nextMa: MultiAssignment = {
    enabled: true,
    created_by: user.username,
    assignees: normalizedAssignees.map((entry) => ({
      username: entry.username,
      status: 'pending',
      assigned_at: now,
      actual_due_date: entry.actual_due_date || undefined,
    })),
    completion_percentage: 0,
    all_completed: false,
  }
  touchMultiAssignmentProgress(nextMa)
  const rolledDue = getMaxMaDueDate(nextMa)
  normalizedAssignees.forEach((entry) => {
    assignmentChain.push({
      user: user.username,
      role: 'multi_assign',
      assignedAt: now,
      next_user: entry.username,
      feedback: note?.trim() || undefined,
    })
  })

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} converted task to multi-assignment (${normalizedAssignees.length} assignees)${note?.trim() ? `. Note: ${note.trim()}` : ''}.`,
    timestamp: now,
    icon: '👥',
    title: 'Split Into Multi-Assignment',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(nextMa),
    task_status: 'in_progress',
    workflow_state: 'split_to_multi',
    ...(rolledDue ? { due_date: rolledDue, expected_due_date: rolledDue } : {}),
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    pending_approver: null,
    approval_chain: JSON.stringify([]),
    approval_requested_at: null,
    approval_sla_due_at: null,
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(
    supabase,
    normalizedAssignees.map((entry) => entry.username),
    {
      type: 'task_assigned',
      title: 'You were added to a multi-assignment task',
      body: `${user.username} assigned you work in "${task.title}".`,
      relatedId: todoId,
    },
    user.username,
  )

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function updateSingleTaskDueDateAction(
  todoId: string,
  dueDate: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const nextDueDate = String(dueDate || '').trim()
  if (!nextDueDate) return { success: false, error: 'Due date is required.' }
  if (isPastPakistanDate(nextDueDate)) return { success: false, error: 'Due date must be an upcoming Pakistan time.' }

  const parsedDueDate = new Date(nextDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,title,completed,approval_status,multi_assignment,history,expected_due_date,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const stepOwner = findAssignmentStepOwner(task, String(task.assigned_to || ''))
  if (!stepOwner || stepOwner.toLowerCase() !== user.username.toLowerCase()) {
    return { success: false, error: 'Only the person who assigned this step can update its due date.' }
  }
  if ((task.completed as boolean) === true) return { success: false, error: 'Completed tasks cannot be updated.' }
  if ((task.approval_status as string) === 'pending_approval') return { success: false, error: 'Task is pending approval and cannot be updated right now.' }

  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (multiAssignment?.enabled) return { success: false, error: 'Use assignee due dates for multi-assignment tasks.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'edit',
    user: user.username,
    details: `${user.username} updated the assignee due date to ${dueIso}${task.expected_due_date ? ` (expected remains ${String(task.expected_due_date)})` : ''}`,
    timestamp: now,
    icon: '📅',
    title: 'Due Date Updated',
  })

  await supabase.from('todos').update({
    actual_due_date: dueIso,
    due_date: dueIso,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(supabase, [String(task.username || '')], {
    type: 'task_assigned',
    title: 'Task Due Date Updated',
    body: `${user.username} updated the due date for "${task.title}" to ${dueIso}.`,
    relatedId: todoId,
  }, user.username)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function updateMaAssigneeDueDateAction(
  todoId: string,
  assigneeUsername: string,
  dueDate: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const targetAssignee = String(assigneeUsername || '').trim()
  if (!targetAssignee) return { success: false, error: 'Assignee is required.' }

  const nextDueDate = String(dueDate || '').trim()
  if (!nextDueDate) return { success: false, error: 'Due date is required.' }
  if (isPastPakistanDate(nextDueDate)) return { success: false, error: 'Due date must be an upcoming Pakistan time.' }

  const parsedDueDate = new Date(nextDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,title,completed,approval_status,multi_assignment,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.completed as boolean) === true) return { success: false, error: 'Completed tasks cannot be updated.' }
  if ((task.approval_status as string) === 'pending_approval') return { success: false, error: 'Task is pending approval and cannot be updated right now.' }

  const stepOwner = findAssignmentStepOwner(task, targetAssignee)
  if (!stepOwner || stepOwner.toLowerCase() !== user.username.toLowerCase()) {
    return { success: false, error: 'Only the person who assigned this step can update its due date.' }
  }

  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!multiAssignment?.enabled || !Array.isArray(multiAssignment.assignees)) {
    return { success: false, error: 'This task is not using multi-assignment.' }
  }

  const assigneeIndex = multiAssignment.assignees.findIndex(
    (entry) => String(entry.username || '').toLowerCase() === targetAssignee.toLowerCase()
  )
  if (assigneeIndex === -1) return { success: false, error: 'Assignee not found.' }

  multiAssignment.assignees[assigneeIndex] = {
    ...multiAssignment.assignees[assigneeIndex],
    actual_due_date: dueIso,
  }
  touchMultiAssignmentProgress(multiAssignment)
  const rolledDue = getMaxMaDueDate(multiAssignment)

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'edit',
    user: user.username,
    details: `${user.username} updated ${targetAssignee}'s assignee due date to ${dueIso}`,
    timestamp: now,
    icon: '📅',
    title: 'Multi-Assignment Due Date Updated',
  })

  const updatePayload: Record<string, unknown> = {
    multi_assignment: JSON.stringify(multiAssignment),
    history: JSON.stringify(history),
    updated_at: now,
  }

  if (rolledDue) {
    updatePayload.due_date = rolledDue
    updatePayload.expected_due_date = rolledDue
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  await notifyUsers(
    supabase,
    [targetAssignee, String(task.username || '')],
    {
      type: 'task_assigned',
      title: 'Assignee Due Date Updated',
      body: `${user.username} updated ${targetAssignee}'s due date for "${task.title}" to ${dueIso}.`,
      relatedId: todoId,
    },
    user.username,
  )

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function updateAssignmentStepAction(
  todoId: string,
  assigneeUsername: string,
  dueDate: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const targetAssignee = String(assigneeUsername || '').trim()
  if (!targetAssignee) return { success: false, error: 'Assignee is required.' }

  const nextDueDate = String(dueDate || '').trim()
  if (!nextDueDate) return { success: false, error: 'Due date is required.' }
  if (isPastPakistanDate(nextDueDate)) return { success: false, error: 'Due date must be an upcoming Pakistan time.' }

  const parsedDueDate = new Date(nextDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,title,completed,approval_status,multi_assignment,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.completed as boolean) === true) return { success: false, error: 'Completed tasks cannot be updated.' }
  if ((task.approval_status as string) === 'pending_approval') return { success: false, error: 'Task is pending approval and cannot be updated right now.' }

  const stepOwner = findAssignmentStepOwner(task, targetAssignee)
  if (!stepOwner || stepOwner.toLowerCase() !== user.username.toLowerCase()) {
    return { success: false, error: 'Only the person who assigned this step can edit it.' }
  }

  const chain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  const chainIndex = findLatestAssignmentChainIndex(task, targetAssignee)
  if (chainIndex >= 0) {
    chain[chainIndex] = {
      ...chain[chainIndex],
      feedback: note?.trim() || undefined,
    }
  }

  const updatePayload: Record<string, unknown> = {
    assignment_chain: JSON.stringify(chain),
  }

  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
    const assigneeIndex = multiAssignment.assignees.findIndex(
      (entry) => String(entry.username || '').toLowerCase() === targetAssignee.toLowerCase()
    )
    if (assigneeIndex === -1) return { success: false, error: 'Assignee not found.' }

    multiAssignment.assignees[assigneeIndex] = {
      ...multiAssignment.assignees[assigneeIndex],
      actual_due_date: dueIso,
    }
    touchMultiAssignmentProgress(multiAssignment)
    updatePayload.multi_assignment = JSON.stringify(multiAssignment)
    const rolledDue = getMaxMaDueDate(multiAssignment)
    if (rolledDue) {
      updatePayload.due_date = rolledDue
      updatePayload.expected_due_date = rolledDue
    }
  } else {
    const assignedTo = normalizeChainUsername(task.assigned_to)
    if (!assignedTo || assignedTo.toLowerCase() !== targetAssignee.toLowerCase()) {
      return { success: false, error: 'This assignee step can no longer be edited here.' }
    }
    updatePayload.actual_due_date = dueIso
    updatePayload.due_date = dueIso
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'edit',
    user: user.username,
    details: `${user.username} updated ${targetAssignee}'s step${note?.trim() ? ` with note: ${note.trim()}` : ''} and due date ${dueIso}`,
    timestamp: now,
    icon: '📅',
    title: 'Assignment Step Updated',
  })
  updatePayload.history = JSON.stringify(history)
  updatePayload.updated_at = now

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  await notifyUsers(
    supabase,
    [targetAssignee, String(task.username || '')],
    {
      type: 'task_assigned',
      title: 'Assignment Step Updated',
      body: `${user.username} updated ${targetAssignee}'s step for "${task.title}".`,
      relatedId: todoId,
    },
    user.username,
  )

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function extendMultiAssignmentStepAction(
  todoId: string,
  assignees: Array<{ username: string; actual_due_date?: string | null }>,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  if (!Array.isArray(assignees) || assignees.length === 0) {
    return { success: false, error: 'Select at least one user.' }
  }

  const normalizedAssignees = assignees
    .map((entry) => ({
      username: String(entry.username || '').trim(),
      actual_due_date: entry.actual_due_date || null,
    }))
    .filter((entry) => Boolean(entry.username))

  if (normalizedAssignees.length === 0) {
    return { success: false, error: 'Invalid assignee payload.' }
  }
  if (normalizedAssignees.some((entry) => !entry.actual_due_date)) {
    return { success: false, error: 'Each added user must have a due date.' }
  }
  if (normalizedAssignees.some((entry) => Number.isNaN(new Date(String(entry.actual_due_date)).getTime()))) {
    return { success: false, error: 'One or more due dates are invalid.' }
  }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,title,completed,approval_status,multi_assignment,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.completed as boolean) === true) return { success: false, error: 'Completed tasks cannot be updated.' }
  if ((task.approval_status as string) === 'pending_approval') return { success: false, error: 'Task is pending approval and cannot be updated right now.' }

  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!multiAssignment?.enabled || !Array.isArray(multiAssignment.assignees)) {
    return { success: false, error: 'This task is not using multi-assignment.' }
  }

  const userOwnsAnyExistingStep = multiAssignment.assignees.some(
    (entry) => (findAssignmentStepOwner(task, entry.username) || '').toLowerCase() === user.username.toLowerCase(),
  )
  const isOriginalCreator = (normalizeChainUsername(multiAssignment.created_by)).toLowerCase() === user.username.toLowerCase()
  if (!userOwnsAnyExistingStep && !isOriginalCreator) {
    return { success: false, error: 'Only the step owner can add more users in this branch.' }
  }

  const existingUsers = new Set(multiAssignment.assignees.map((entry) => normalizeChainUsername(entry.username).toLowerCase()))
  if (normalizedAssignees.some((entry) => existingUsers.has(entry.username.toLowerCase()))) {
    return { success: false, error: 'One or more selected users are already assigned.' }
  }

  const now = new Date().toISOString()
  normalizedAssignees.forEach((entry) => {
    multiAssignment.assignees.push({
      username: entry.username,
      status: 'pending',
      assigned_at: now,
      actual_due_date: entry.actual_due_date || undefined,
    })
  })
  touchMultiAssignmentProgress(multiAssignment)

  const chain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  normalizedAssignees.forEach((entry) => {
    chain.push({
      user: user.username,
      role: 'multi_assign',
      assignedAt: now,
      next_user: entry.username,
      feedback: note?.trim() || undefined,
    })
  })

  const rolledDue = getMaxMaDueDate(multiAssignment)
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} added ${normalizedAssignees.length} more user(s) to multi-assignment${note?.trim() ? `. Note: ${note.trim()}` : ''}.`,
    timestamp: now,
    icon: '👥',
    title: 'More Users Added',
  })

  const updatePayload: Record<string, unknown> = {
    multi_assignment: JSON.stringify(multiAssignment),
    assignment_chain: JSON.stringify(chain),
    history: JSON.stringify(history),
    updated_at: now,
  }
  if (rolledDue) {
    updatePayload.due_date = rolledDue
    updatePayload.expected_due_date = rolledDue
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  await notifyUsers(
    supabase,
    normalizedAssignees.map((entry) => entry.username),
    {
      type: 'task_assigned',
      title: 'You were added to a task',
      body: `${user.username} added you to "${task.title}".`,
      relatedId: todoId,
    },
    user.username,
  )

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
    .select('username,assigned_to,multi_assignment,history,title')
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
    ...(newStatus === 'completed' ? { completed_at: now, notes: notes || undefined } : { completed_at: undefined }),
  }

  touchMultiAssignmentProgress(ma)

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
    workflow_state: 'split_to_multi',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  // Notify immediate step owner first so approval follows assignment chain.
  if (newStatus === 'completed') {
    const stepOwner = findAssignmentStepOwner(task, user.username)
    const reviewOwner = normalizeChainUsername(stepOwner) || normalizeChainUsername(task.username)
    if (reviewOwner && reviewOwner.toLowerCase() !== user.username.toLowerCase()) {
      await createNotification(supabase, {
        userId: reviewOwner,
        type: 'task_assigned',
        title: 'MA: Work Submitted for Review',
        body: `${user.username} submitted their work for task "${task.title}"`,
        relatedId: todoId,
      })
    }
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
    .select('username,assigned_to,multi_assignment,history,title,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const stepOwner = findAssignmentStepOwner(task, assigneeUsername)
  const isStepOwner = (stepOwner || '').toLowerCase() === user.username.toLowerCase()
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isStepOwner && !isAdmin)
    return { success: false, error: 'Only the person who assigned this step (or admin) can accept work.' }

  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const idx = ma.assignees.findIndex((a) => (a.username || '').toLowerCase() === assigneeUsername.toLowerCase())
  if (idx === -1) return { success: false, error: 'Assignee not found.' }

  const now = new Date().toISOString()
  ma.assignees[idx] = { ...ma.assignees[idx], status: 'accepted', completed_at: now, accepted_at: now, accepted_by: user.username }
  touchMultiAssignmentProgress(ma)
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

  const updatePayload: Record<string, unknown> = {
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }

  if (allAccepted) {
    const pendingChain = buildPendingApprovalChain(task, user.username, now)
    const nextApprover = pendingChain[0]?.user || (task.username as string)
    updatePayload.completed = false
    updatePayload.completed_at = null
    updatePayload.completed_by = user.username
    updatePayload.task_status = 'done'
    updatePayload.approval_status = 'pending_approval'
    updatePayload.pending_approver = nextApprover
    updatePayload.approval_chain = JSON.stringify(pendingChain)
    updatePayload.approval_requested_at = now
    updatePayload.approval_sla_due_at = addHoursIso(now, 48)
    updatePayload.workflow_state = 'submitted_for_approval'

    history.push({
      type: 'completion_submitted',
      user: user.username,
      details: `${user.username} submitted fully accepted multi-assignment for approval by ${nextApprover}`,
      timestamp: now,
      icon: '📨',
      title: 'MA Submitted For Approval',
    })
    updatePayload.history = JSON.stringify(history)
  } else {
    updatePayload.workflow_state = 'multi_accepted'
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  await createNotification(supabase, {
    userId: assigneeUsername,
    type: 'task_completed',
    title: 'Your Work Was Accepted',
    body: `${user.username} accepted your work on "${task.title}"`,
    relatedId: todoId,
  })

  if (allAccepted) {
    const nextApprover = buildPendingApprovalChain(task, user.username, now)[0]?.user || (task.username as string)
    await createNotification(supabase, {
      userId: nextApprover,
      type: 'task_assigned',
      title: 'Approval Required',
      body: `${user.username} submitted fully accepted work for "${task.title}".`,
      relatedId: todoId,
    })
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

// ── Delegate multi-assignment slot to another user ────────────────────────────

export async function rejectMaAssigneeAction(
  todoId: string,
  assigneeUsername: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!reason.trim()) return { success: false, error: 'Feedback is required.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const stepOwner = findAssignmentStepOwner(task, assigneeUsername)
  const isStepOwner = (stepOwner || '').toLowerCase() === user.username.toLowerCase()
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isStepOwner && !isAdmin) return { success: false, error: 'Only the person who assigned this step (or admin) can reject work.' }

  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const idx = ma.assignees.findIndex((entry) => (entry.username || '').toLowerCase() === assigneeUsername.toLowerCase())
  if (idx === -1) return { success: false, error: 'Assignee not found.' }

  const now = new Date().toISOString()
  ma.assignees[idx] = {
    ...ma.assignees[idx],
    status: 'in_progress',
    notes: reason.trim(),
    rejection_reason: reason.trim(),
    completed_at: undefined,
    accepted_at: undefined,
    accepted_by: undefined,
  }
  touchMultiAssignmentProgress(ma)

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'declined',
    user: user.username,
    details: `${user.username} rejected work from ${assigneeUsername}. Feedback: ${reason.trim()}`,
    timestamp: now,
    icon: '❌',
    title: 'Work Rejected',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    completed: false,
    completed_at: null,
    approval_status: 'approved',
    task_status: 'in_progress',
    workflow_state: 'rework_required',
    pending_approver: null,
    approval_chain: JSON.stringify([]),
    approval_requested_at: null,
    approval_sla_due_at: null,
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(supabase, [assigneeUsername], {
    type: 'task_assigned',
    title: 'Work Needs Changes',
    body: `${user.username} sent back your work on "${task.title}". Feedback: ${reason.trim()}`,
    relatedId: todoId,
  }, user.username)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function reopenMaAssigneeAction(
  todoId: string,
  assigneeUsername: string,
  feedback: string,
  newDueDate: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!feedback.trim()) return { success: false, error: 'Feedback is required.' }
  if (!newDueDate.trim()) return { success: false, error: 'New due date is required.' }

  const parsedDueDate = new Date(newDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  if (parsedDueDate.getTime() <= Date.now()) return { success: false, error: 'New due date must be in the future.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const stepOwner = findAssignmentStepOwner(task, assigneeUsername)
  const isStepOwner = (stepOwner || '').toLowerCase() === user.username.toLowerCase()
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isStepOwner && !isAdmin) return { success: false, error: 'Only the person who assigned this step (or admin) can reopen accepted work.' }

  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const idx = ma.assignees.findIndex((entry) => (entry.username || '').toLowerCase() === assigneeUsername.toLowerCase())
  if (idx === -1) return { success: false, error: 'Assignee not found.' }
  if (ma.assignees[idx].status !== 'accepted') return { success: false, error: 'Only accepted work can be reopened.' }

  const now = new Date().toISOString()
  ma.assignees[idx] = {
    ...ma.assignees[idx],
    status: 'in_progress',
    notes: feedback.trim(),
    rejection_reason: feedback.trim(),
    actual_due_date: parsedDueDate.toISOString(),
    completed_at: undefined,
    accepted_at: undefined,
    accepted_by: undefined,
  }
  touchMultiAssignmentProgress(ma)
  const rolledDue = getMaxMaDueDate(ma)

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'uncompleted',
    user: user.username,
    details: `${user.username} reopened ${assigneeUsername}'s work. Feedback: ${feedback.trim()}. New due date: ${parsedDueDate.toISOString()}`,
    timestamp: now,
    icon: '↩️',
    title: 'Work Reopened',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    completed: false,
    completed_at: null,
    approval_status: 'approved',
    task_status: 'in_progress',
    workflow_state: 'rework_required',
    ...(rolledDue ? { due_date: rolledDue, expected_due_date: rolledDue } : {}),
    pending_approver: null,
    approval_chain: JSON.stringify([]),
    approval_requested_at: null,
    approval_sla_due_at: null,
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(supabase, [assigneeUsername], {
    type: 'task_assigned',
    title: 'Accepted Work Reopened',
    body: `${user.username} reopened your accepted work on "${task.title}". Feedback: ${feedback.trim()}. New due date: ${parsedDueDate.toISOString()}`,
    relatedId: todoId,
  }, user.username)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

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

export async function updateMaSubAssigneeStatusAction(
  todoId: string,
  delegatorUsername: string,
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
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const delegated = findDelegatedAssignment(ma, user.username)
  if (!delegated || delegated.assignee.username.toLowerCase() !== delegatorUsername.toLowerCase()) {
    return { success: false, error: 'You are not delegated on this task.' }
  }

  const now = new Date().toISOString()
  const delegatedEntries = [...(delegated.assignee.delegated_to || [])]
  delegatedEntries[delegated.subIndex] = {
    ...delegated.subAssignee,
    status: newStatus,
    ...(newStatus === 'completed' ? { completed_at: now, notes: notes?.trim() || undefined } : { completed_at: undefined }),
  }
  ma.assignees[delegated.assigneeIndex] = {
    ...delegated.assignee,
    delegated_to: delegatedEntries,
  }
  touchMultiAssignmentProgress(ma)

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: newStatus === 'completed' ? 'completion_submitted' : 'started',
    user: user.username,
    details: `${user.username} ${newStatus === 'completed' ? 'submitted delegated work to' : 'started delegated work for'} ${delegatorUsername}${notes?.trim() ? `: ${notes.trim()}` : ''}`,
    timestamp: now,
    icon: newStatus === 'completed' ? '📤' : '🚀',
    title: newStatus === 'completed' ? 'Delegated Work Submitted' : 'Delegated Work Started',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  if (newStatus === 'completed') {
    await notifyUsers(supabase, [delegatorUsername], {
      type: 'task_assigned',
      title: 'Delegated Work Submitted',
      body: `${user.username} submitted delegated work on "${task.title}" for ${delegatorUsername}.`,
      relatedId: todoId,
    }, user.username)
  }

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function acceptMaSubAssigneeAction(
  todoId: string,
  delegatorUsername: string,
  subUsername: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (user.username.toLowerCase() !== delegatorUsername.toLowerCase()) return { success: false, error: 'Only the delegator can accept delegated work.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const delegated = findDelegatedAssignment(ma, subUsername)
  if (!delegated || delegated.assignee.username.toLowerCase() !== delegatorUsername.toLowerCase()) {
    return { success: false, error: 'Delegated assignee not found.' }
  }

  const now = new Date().toISOString()
  const delegatedEntries = [...(delegated.assignee.delegated_to || [])]
  delegatedEntries[delegated.subIndex] = {
    ...delegated.subAssignee,
    status: 'accepted',
    completed_at: delegated.subAssignee.completed_at || now,
  }
  ma.assignees[delegated.assigneeIndex] = {
    ...delegated.assignee,
    delegated_to: delegatedEntries,
  }
  touchMultiAssignmentProgress(ma)

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'completed',
    user: user.username,
    details: `${user.username} accepted delegated work from ${subUsername}`,
    timestamp: now,
    icon: '✅',
    title: 'Delegated Work Accepted',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(supabase, [subUsername], {
    type: 'task_completed',
    title: 'Delegated Work Accepted',
    body: `${user.username} accepted your delegated work on "${task.title}".`,
    relatedId: todoId,
  }, user.username)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function rejectMaSubAssigneeAction(
  todoId: string,
  delegatorUsername: string,
  subUsername: string,
  feedback: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (user.username.toLowerCase() !== delegatorUsername.toLowerCase()) return { success: false, error: 'Only the delegator can reject delegated work.' }
  if (!feedback.trim()) return { success: false, error: 'Feedback is required.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const delegated = findDelegatedAssignment(ma, subUsername)
  if (!delegated || delegated.assignee.username.toLowerCase() !== delegatorUsername.toLowerCase()) {
    return { success: false, error: 'Delegated assignee not found.' }
  }

  const now = new Date().toISOString()
  const delegatedEntries = [...(delegated.assignee.delegated_to || [])]
  delegatedEntries[delegated.subIndex] = {
    ...delegated.subAssignee,
    status: 'in_progress',
    notes: feedback.trim(),
    completed_at: undefined,
  }
  ma.assignees[delegated.assigneeIndex] = {
    ...delegated.assignee,
    delegated_to: delegatedEntries,
  }
  touchMultiAssignmentProgress(ma)

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'declined',
    user: user.username,
    details: `${user.username} rejected delegated work from ${subUsername}. Feedback: ${feedback.trim()}`,
    timestamp: now,
    icon: '❌',
    title: 'Delegated Work Rejected',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(supabase, [subUsername], {
    type: 'task_assigned',
    title: 'Delegated Work Needs Changes',
    body: `${user.username} sent back your delegated work on "${task.title}". Feedback: ${feedback.trim()}`,
    relatedId: todoId,
  }, user.username)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function removeMaDelegationAction(
  todoId: string,
  delegatorUsername: string,
  subUsername: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (user.username.toLowerCase() !== delegatorUsername.toLowerCase()) return { success: false, error: 'Only the delegator can remove a delegation.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('multi_assignment,history,title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled) return { success: false, error: 'Not a multi-assignment task.' }

  const idx = ma.assignees.findIndex((entry) => (entry.username || '').toLowerCase() === delegatorUsername.toLowerCase())
  if (idx === -1) return { success: false, error: 'Delegator not found.' }

  const before = ma.assignees[idx].delegated_to || []
  const after = before.filter((entry) => (entry.username || '').toLowerCase() !== subUsername.toLowerCase())
  if (before.length === after.length) return { success: false, error: 'Delegated assignee not found.' }

  ma.assignees[idx] = {
    ...ma.assignees[idx],
    delegated_to: after,
  }
  touchMultiAssignmentProgress(ma)

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'edit',
    user: user.username,
    details: `${user.username} removed delegation for ${subUsername}`,
    timestamp: now,
    icon: '🗑️',
    title: 'Delegation Removed',
  })

  await supabase.from('todos').update({
    multi_assignment: JSON.stringify(ma),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await notifyUsers(supabase, [subUsername], {
    type: 'task_assigned',
    title: 'Delegation Removed',
    body: `${user.username} removed your delegation on "${task.title}".`,
    relatedId: todoId,
  }, user.username)

  revalidatePath('/dashboard/tasks')
  return { success: true }
}

export async function getMyOverdueApprovalsAction(): Promise<Array<{ id: string; title: string; approval_sla_due_at: string | null }>> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('todos')
    .select('id,title,approval_sla_due_at')
    .eq('approval_status', 'pending_approval')
    .eq('pending_approver', user.username)
    .not('approval_sla_due_at', 'is', null)
    .lt('approval_sla_due_at', nowIso)

  if (error) {
    console.error('getMyOverdueApprovalsAction error:', error)
    return []
  }

  return (data || []) as Array<{ id: string; title: string; approval_sla_due_at: string | null }>
}

async function createNotification(
  supabase: ReturnType<typeof createServerClient>,
  opts: { userId: string; type: string; title: string; body: string; relatedId: string }
) {
  try {
    const legacyPayload = {
      user_id: opts.userId,
      title: opts.title,
      message: opts.body,
      type: opts.type,
      link: opts.relatedId,
      read: false,
      created_at: new Date().toISOString(),
    }

    const primary = await supabase.from('notifications').insert(legacyPayload)
    if (!primary.error) return

    const modernPayload = {
      user_id: opts.userId,
      title: opts.title,
      body: opts.body,
      type: opts.type,
      related_id: opts.relatedId,
      is_read: false,
      created_at: new Date().toISOString(),
    }
    const fallback = await supabase.from('notifications').insert(modernPayload)
    if (fallback.error) {
      console.error('createNotification insert failed:', fallback.error.message)
    }
  } catch (error) {
    console.error('createNotification unexpected error:', error)
  }
}
