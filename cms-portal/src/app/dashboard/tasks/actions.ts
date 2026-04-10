'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { validatePakistanOfficeDueDate, DEFAULT_OFFICE_HOURS } from '@/lib/pakistan-time'
import type { HallOfficeHours } from '@/lib/pakistan-time'
import { calculateEffectiveDueAt, getWorkMinutesInRange } from '@/lib/hall-scheduler'
import type { HallSchedulerState } from '@/lib/hall-scheduler'
import { buildTaskAttachmentPath, CMS_STORAGE_BUCKET, resolveStorageUrl } from '@/lib/storage'
import { computeTodoStatsFromTodos } from '@/lib/todo-stats'
import { canonicalDepartmentKey, mapDepartmentCsvToOfficial, splitDepartmentsCsv } from '@/lib/department-name'
import { queueTaskWebhookEvent } from '@/lib/task-webhooks'
import { resolvePackageAutoAssignment, buildAutoMultiAssignment } from '@/lib/package-assignment-resolver'
import type {
  Todo,
  TodoAttachment,
  TodoDetails,
  SidebarTaskCounts,
  TodoStats,
  HistoryEntry,
  CreateTodoInput,
  MultiAssignment,
  MultiAssignmentEntry,
  MultiAssignmentSubEntry,
  AssignmentChainEntry,
  ApprovalChainEntry,
  ClusterSettings,
  HallTaskWorkLog,
} from '@/types'
// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T } catch { return fallback }
  }
  return val as T
}

const TASK_LIST_SELECT = [
  'id',
  'username',
  'title',
  'description',
  'our_goal',
  'completed',
  'task_status',
  'priority',
  'category',
  'kpi_type',
  'due_date',
  'expected_due_date',
  'actual_due_date',
  'notes',
  'package_name',
  'app_name',
  'position',
  'archived',
  'queue_department',
  'queue_status',
  'multi_assignment',
  'assigned_to',
  'manager_id',
  'completed_by',
  'completed_at',
  'approval_status',
  'workflow_state',
  'pending_approver',
  'approved_at',
  'approved_by',
  'declined_at',
  'declined_by',
  'decline_reason',
  'assignment_chain',
  'history',
  'created_at',
  'updated_at',
  'cluster_id',
  'cluster_inbox',
  'cluster_origin_id',
  'cluster_routed_by',
  'scheduler_state',
  'queue_rank',
  'effective_due_at',
].join(',')

const SIDEBAR_TASK_SELECT = 'id,username,assigned_to,completed_by,completed,task_status,due_date,archived,queue_status,queue_department,cluster_id,multi_assignment,scheduler_state,effective_due_at'

async function resolveAttachmentUrl(
  supabase: ReturnType<typeof createServerClient>,
  row: TodoAttachment
): Promise<TodoAttachment> {
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

function emitTaskWebhook(
  event: Parameters<typeof queueTaskWebhookEvent>[0]['event'],
  taskId: string,
  actorUsername: string,
  metadata?: Record<string, unknown>
) {
  queueTaskWebhookEvent({
    event,
    taskId,
    actorUsername,
    metadata,
  })
}

/**
 * Normalizes assignment_chain entries from the old GAS format to the new Next.js format.
 *
 * Old GAS format:  { user (who completed), action, timestamp, level, status, review_status, feedback }
 *                  - `user` is the ASSIGNEE who did the work, NOT the assigner
 *                  - There is no `next_user` (chain direction is implicit)
 *
 * New format:      { user (assigner), role, assignedAt, next_user (assignee), feedback }
 *                  - `user` assigns TO `next_user`
 *
 * Conversion strategy for old entries:
 *  - If only one old entry exists: creator → assigned_to (single direct assignment)
 *    → convert to: { user: creator, role: "assignee", assignedAt: timestamp, next_user: old.user }
 *  - If multiple old entries: treat each as a sequential reassignment chain
 *    → The chain was: creator → entry[0].user → entry[1].user → ...
 *    → Each entry[i] was assigned BY entry[i-1].user (or creator for i=0)
 */
function normalizeAssignmentChain(
  chain: AssignmentChainEntry[],
  creatorUsername: string,
  assignedTo: string | null,
): AssignmentChainEntry[] {
  if (!Array.isArray(chain) || chain.length === 0) return chain

  // Check if any entry is in new format (has `next_user` or has no `action`)
  const hasNewFormat = chain.some((entry) => entry.next_user !== undefined || (entry.role !== undefined && !entry.action))
  if (hasNewFormat) {
    // Already in new format (or mixed) — just ensure all entries have sane defaults
    return chain.map((entry) => ({
      ...entry,
      assignedAt: entry.assignedAt ?? entry.timestamp ?? undefined,
    }))
  }

  // All entries are in old GAS format — convert them
  // Old entries: each entry.user is the person who took action (the assignee)
  // Timestamps: use entry.timestamp (old field) as assignedAt
  const normalized: AssignmentChainEntry[] = []

  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i]
    const actorUsername = String(entry.user || '').trim()
    if (!actorUsername) continue

    // The person who assigned this step = previous entry's actor, or creator for first step
    const assignerUsername = i === 0 ? creatorUsername : String(chain[i - 1].user || '').trim() || creatorUsername

    normalized.push({
      user: assignerUsername,
      role: 'assignee',
      assignedAt: entry.timestamp ?? undefined,
      next_user: actorUsername,
      feedback: entry.feedback ?? undefined,
      // Keep original legacy fields for reference
      action: entry.action,
      timestamp: entry.timestamp,
      level: entry.level,
      status: entry.status,
      review_status: entry.review_status,
    })
  }

  // If no old entries produced any assignee but assigned_to exists, add a synthetic entry
  if (normalized.length === 0 && assignedTo && creatorUsername) {
    normalized.push({
      user: creatorUsername,
      role: 'assignee',
      assignedAt: undefined,
      next_user: assignedTo,
    })
  }

  return normalized
}

function normalizeTodo(raw: Record<string, unknown>, username: string): Todo {
  const t = raw as unknown as Todo
  t.history = parseJson<HistoryEntry[]>(raw.history, [])
  // Pre-compute unread comment count server-side so the client doesn't need the full history array
  t.unread_comment_count = t.history.filter(
    (h) => h.type === 'comment' && !h.is_deleted &&
      Array.isArray(h.unread_by) && h.unread_by.some((u) => u.toLowerCase() === username.toLowerCase())
  ).length
  const rawChain = parseJson<AssignmentChainEntry[]>(raw.assignment_chain, [])
  // Normalize the chain to ensure it's in the new format regardless of what was stored
  t.assignment_chain = normalizeAssignmentChain(
    rawChain,
    String(raw.username || '').trim(),
    raw.assigned_to ? String(raw.assigned_to).trim() : null,
  )
  t.multi_assignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
  t.approval_chain = parseJson<ApprovalChainEntry[]>(raw.approval_chain, [])
  if (!t.archived) t.archived = false

  const userLower = username.toLowerCase()
  const isAssignee = (t.assigned_to || '').toLowerCase() === userLower

  // Multi-assignment specific deadlines: if the user is a sub-assignee, their personal deadline is primary
  if (t.multi_assignment?.enabled && Array.isArray(t.multi_assignment.assignees)) {
    const maEntry = t.multi_assignment.assignees.find(
      (a) => (a.username || '').toLowerCase() === userLower
    )
    if (maEntry && maEntry.actual_due_date) {
      t.due_date = maEntry.actual_due_date
    }
  }

  // For hall-scheduled tasks, effective_due_at is the authoritative due date (computed within office hours)
  if (t.effective_due_at) {
    t.due_date = t.effective_due_at
  } else if (isAssignee && t.actual_due_date) {
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

  // Skip 'submitted_for_approval' entries — those are submission records, not assignments.
  // We only want actual assignment entries (assigned, claimed, routed, reassigned_after_approval, etc.)
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const entry = chain[i]
    const role = normalizeChainUsername(entry?.role).toLowerCase()
    if (role === 'submitted_for_approval') continue
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
        // Walk backwards to find who routed this task to the department queue
        for (let j = i - 1; j >= 0; j -= 1) {
          const router = chain[j]
          const routerRole = normalizeChainUsername(router?.role)
          const routerActor = normalizeChainUsername(router?.user)
          if (routerRole === 'routed_to_department_queue' && routerActor && routerActor.toLowerCase() !== targetLower) {
            return routerActor
          }
        }
        // No router found — fall back to creator below
        break
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

    ; (managedRows || []).forEach((row: Record<string, unknown>) => {
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
      ; (assignee.delegated_to || []).forEach((subAssignee) => {
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
  const notifyPromises: Promise<void>[] = []

  for (const username of usernames) {
    const normalized = String(username || '').trim()
    if (!normalized) continue
    if (skipUsername && normalized.toLowerCase() === skipUsername.toLowerCase()) continue
    if (seen.has(normalized.toLowerCase())) continue
    seen.add(normalized.toLowerCase())
    // Fire all notifications concurrently instead of sequentially
    notifyPromises.push(
      createNotification(supabase, {
        userId: normalized,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        relatedId: payload.relatedId,
      })
    )
  }

  if (notifyPromises.length > 0) {
    await Promise.all(notifyPromises)
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
    ; ((allDepartments ?? []) as Array<{ name: string }>).forEach((dept) => {
      const key = canonicalDepartmentKey(dept.name)
      if (key && !canonicalToOfficial[key]) canonicalToOfficial[key] = dept.name
    })

  const mapSingleDepartment = (value: string | null | undefined) => {
    const key = canonicalDepartmentKey(value)
    return (key && canonicalToOfficial[key]) || (value ? String(value).trim() : '')
  }

  const userDeptMap: Record<string, string> = {}
  const userAvatarMap: Record<string, string | null> = {}
    ; (allUsers || []).forEach((u: Record<string, unknown>) => {
      if (u.username && u.department) {
        userDeptMap[String(u.username).toLowerCase()] = mapDepartmentCsvToOfficial(String(u.department), canonicalToOfficial)
      }
      if (u.username) {
        userAvatarMap[String(u.username)] = String(u.avatar_data || '').trim() || null
      }
    })

  if (isAdminOrSM) {
    const { data, error } = await supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false)
    if (error) { console.error('getTodos error:', error); return [] }
    const { data: sharedData } = await supabase
      .from('todo_shares')
      .select('todo_id')
      .eq('shared_with', user.username)
    const sharedIds = new Set((sharedData || []).map((s: Record<string, unknown>) => s.todo_id as string))
    return ((data || []) as unknown as Record<string, unknown>[]).map((raw) => {
      const t = normalizeTodo(raw, user.username)
      t.history = [] // strip heavy history — unread_comment_count carries the badge info
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
    ; (allUsers || []).forEach((u: Record<string, unknown>) => {
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

  const canViewAllQueues =
    user.role === 'Admin' ||
    user.role === 'Super Manager' ||
    user.role === 'Manager' ||
    user.role === 'Supervisor'

  // ── Mega-batch: all remaining queries fire in parallel ───────────────────
  // Previously the code used 4–5 sequential batches: owned/assigned/etc. →
  // managedData (sequential) → teamCreated/teamAssigned (sequential) →
  // maAssignee/maDelegated/chainMember (sequential) → clusterMemberships
  // (sequential).  Each sequential batch adds a full network round-trip.
  // By folding everything into one Promise.all we cut from 5+ round-trips to
  // 2 (metadata batch + this mega-batch), plus at most two conditional sequential
  // calls (sharedTasks and clusterInbox) that depend on IDs from this batch.
  const [
    ownedRes,
    assignedRes,
    completedByRes,
    pendingApproverRes,
    sharedRes,
    deptQueueRes,
    managedDataRes,
    teamCreatedRes,
    teamAssignedRes,
    maAssigneeRes,
    maDelegatedRes,
    chainMemberRes,
    chainAssigneeRes,
    clusterMembershipsRes,
  ] = await Promise.all([
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).eq('username', user.username),
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).eq('assigned_to', user.username),
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).eq('completed_by', user.username),
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).eq('pending_approver', user.username),
    supabase.from('todo_shares').select('todo_id').eq('shared_with', user.username),
    (canViewAllQueues || user.department)
      ? supabase
        .from('todos')
        .select(TASK_LIST_SELECT)
        .eq('archived', false)
        .eq('queue_status', 'queued')
        .or('assigned_to.is.null,assigned_to.eq.')
      : Promise.resolve({ data: [] as unknown[] }),
    // manager_id ilike — kept here (trigram GIN index handles it efficiently)
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false)
      .ilike('manager_id', `%${user.username}%`),
    // team created/assigned — conditional, resolved immediately if no team
    myTeamUsernames.length > 0
      ? supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).in('username', myTeamUsernames)
      : Promise.resolve({ data: [] as unknown[] }),
    myTeamUsernames.length > 0
      ? supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).in('assigned_to', myTeamUsernames)
      : Promise.resolve({ data: [] as unknown[] }),
    // multi_assignment JSONB containment — GIN-indexed after the SQL migration
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false)
      .contains('multi_assignment', { assignees: [{ username: user.username }] }),
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false)
      .contains('multi_assignment', { assignees: [{ delegated_to: [{ username: user.username }] }] }),
    // assignment_chain JSONB containment — GIN-indexed after the SQL migration
    // chainMemberRes: user was the ASSIGNER in the chain
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false)
      .contains('assignment_chain', [{ user: user.username }]),
    // chainAssigneeRes: user was the ASSIGNEE in the chain (next_user field).
    // Use JSONB containment (@>) to find tasks where any chain entry has next_user = this user.
    supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false)
      .contains('assignment_chain', [{ next_user: user.username }]),
    // cluster memberships — needed for inbox tasks below
    supabase.from('cluster_members').select('cluster_id')
      .eq('username', user.username)
      .in('cluster_role', ['owner', 'manager', 'supervisor']),
  ])

  const userDeptKeys = splitDepartmentsCsv(user.department)
    .map((dept) => canonicalDepartmentKey(dept))
    .filter(Boolean)

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
        ; (t.assignment_chain || []).forEach((entry) => {
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

    ; ((ownedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r))
    ; ((assignedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_assigned_to_me: true }))
    ; ((completedByRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_completed_by_me: true }))
    ; ((pendingApproverRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_chain_member: true }))
  {
    const deptRows = (deptQueueRes as { data: Record<string, unknown>[] | null }).data || []
    // ── Queue-visibility: hierarchical toggle check ─────────────────────────
    // Parent toggle  (allow_dept_users_see_queue):
    //   OFF → ONLY hall leaders (cluster_role owner/manager/supervisor) + system
    //         Admin/Super-Manager may see queue tasks.  All others are blocked.
    //   ON  → check the child toggle ↓
    // Child toggle  (allow_normal_users_see_queue):
    //   OFF → Managers/Supervisors (by session role) + hall leaders can see.
    //         Regular User-role members are blocked.
    //   ON  → everyone in the department can see.
    // ────────────────────────────────────────────────────────────────────────
    const blockedFull = new Set<string>()   // nobody except hall-leaders / admins
    const blockedNormal = new Set<string>() // only User-role blocked

    if (!canViewAllQueues) {
      const hallClusterIds = [...new Set(
        deptRows
          .map((r) => r.cluster_id as string | null)
          .filter((id): id is string => !!id)
      )]
      if (hallClusterIds.length > 0) {
        const { data: settingsRows } = await supabase
          .from('cluster_settings')
          .select('cluster_id,allow_dept_users_see_queue,allow_normal_users_see_queue')
          .in('cluster_id', hallClusterIds)
          ; (settingsRows || []).forEach((s: Record<string, unknown>) => {
            if (!s.allow_dept_users_see_queue) {
              // Parent OFF → block everyone except hall leaders + admins
              blockedFull.add(s.cluster_id as string)
            } else if (s.allow_normal_users_see_queue === false) {
              // Parent ON, child OFF → block only User-role
              blockedNormal.add(s.cluster_id as string)
            }
          })
      }
    }

    // Pre-load the caller's cluster_role for halls that are fully blocked so we
    // can allow hall leaders through even when allow_dept_users_see_queue is OFF.
    let leaderClusterIds = new Set<string>()
    if (blockedFull.size > 0) {
      const { data: memRows } = await supabase
        .from('cluster_members')
        .select('cluster_id, cluster_role')
        .eq('username', user.username)
        .in('cluster_id', [...blockedFull])
        ; (memRows ?? []).forEach((m: Record<string, unknown>) => {
          if (['owner', 'manager', 'supervisor'].includes(m.cluster_role as string)) {
            leaderClusterIds.add(m.cluster_id as string)
          }
        })
    }

    deptRows.forEach((r) => {
      if (canViewAllQueues) {
        addTask(r, { is_department_queue: true })
        return
      }
      const cid = r.cluster_id as string | null
      // Parent toggle OFF → only hall leaders + admins pass
      if (cid && blockedFull.has(cid) && !leaderClusterIds.has(cid)) {
        return
      }
      // Child toggle OFF → block User-role (Manager/Supervisor pass)
      if (cid && blockedNormal.has(cid) && user.role === 'User') {
        return
      }
      const queueDept = String(r.queue_department || '')
      const queueDeptKey = canonicalDepartmentKey(queueDept)
      if (userDeptKeys.length === 0 || (queueDeptKey && userDeptKeys.includes(queueDeptKey))) {
        addTask(r, { is_department_queue: true })
      }
    })
  }

  ; ((managedDataRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    const managers = String(r.manager_id || '').split(',').map((m) => m.trim().toLowerCase())
    if (managers.includes(user.username.toLowerCase())) {
      addTask(r, { is_managed: true })
    }
  })

    ; ((teamCreatedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_team_task: true }))
    ; ((teamAssignedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_team_task: true }))

  // Shared tasks — sequential because IDs come from the mega-batch sharedRes
  const sharedIds = (sharedRes.data || [])
    .map((s: Record<string, unknown>) => s.todo_id as string)
    .filter((id: string) => !taskIds.has(id))
  if (sharedIds.length > 0) {
    const { data: sharedTasks } = await supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).in('id', sharedIds)
      ; ((sharedTasks || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_shared: true }))
  }

  ; ((maAssigneeRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    addTask(r, { is_multi_assigned: true })
  })
    ; ((maDelegatedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
      addTask(r, { is_multi_assigned: true, is_delegated_to_me: true })
    })
    ; ((chainMemberRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
      addTask(r, { is_chain_member: true })
    })
    ; ((chainAssigneeRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
      addTask(r, { is_chain_member: true })
    })

  // Bulletproof MA safety net: JSONB .contains() (@>) can silently return zero rows
  // when data was stored via JSON.stringify() (double-encoding creates a jsonb string
  // instead of a jsonb object).  Fetch ALL incomplete split_to_multi tasks and filter
  // for the current user in JavaScript.  The addTask() dedup ensures no duplicates if
  // the JSONB queries above DID return results.
  // Also project per-user hall scheduler state from JSONB so task cards display the
  // correct state for the current user (the task-level scheduler_state is null for MA tasks).
  {
    const { data: allMaRows } = await supabase
      .from('todos')
      .select(TASK_LIST_SELECT)
      .eq('archived', false)
      .eq('workflow_state', 'split_to_multi')
    const uLower = user.username.toLowerCase()
    ;((allMaRows || []) as unknown as Record<string, unknown>[]).forEach((r) => {
      const ma = parseJson<MultiAssignment | null>(r.multi_assignment, null)
      const myEntry = ma?.enabled && Array.isArray(ma.assignees)
        ? ma.assignees.find((a) => a.username.toLowerCase() === uLower)
        : undefined
      const approverEntry = ma?.enabled && Array.isArray(ma.assignees)
        ? ma.assignees.find((a) =>
            (a.ma_approval_status === 'pending_approval') &&
            normalizeChainUsername(a.ma_pending_approver).toLowerCase() === uLower,
          )
        : undefined
      const isDelegated = ma?.enabled && Array.isArray(ma.assignees) &&
        ma.assignees.some((a) => Array.isArray(a.delegated_to) &&
          a.delegated_to.some((d) => d.username.toLowerCase() === uLower))
      const chain = parseJson<AssignmentChainEntry[]>(r.assignment_chain, [])
      const inChain = Array.isArray(chain) &&
        chain.some((e) => (e.next_user ?? '').toLowerCase() === uLower)
      if (myEntry || approverEntry || isDelegated || inChain) {
        // Project per-user JSONB scheduler fields onto the task so cards render correctly
        if (myEntry) {
          const derivedMaState = myEntry.hall_scheduler_state
            ?? (myEntry.ma_approval_status === 'pending_approval' ? 'waiting_review' : null)
            ?? (myEntry.status === 'in_progress' ? 'active' : null)
            ?? ((myEntry.status === 'completed' || myEntry.status === 'accepted') ? 'completed' : null)
            ?? 'user_queue'
          r.scheduler_state = derivedMaState
          if (myEntry.hall_queue_rank != null) r.queue_rank = myEntry.hall_queue_rank
          if (myEntry.hall_remaining_minutes != null) r.remaining_work_minutes = myEntry.hall_remaining_minutes
          if (myEntry.hall_active_started_at) r.active_started_at = myEntry.hall_active_started_at
          if (myEntry.hall_effective_due_at) r.effective_due_at = myEntry.hall_effective_due_at
          if (myEntry.ma_approval_status) r.approval_status = myEntry.ma_approval_status
          else if (myEntry.status === 'completed') r.approval_status = 'pending_approval'
          if (myEntry.ma_pending_approver !== undefined) r.pending_approver = myEntry.ma_pending_approver
        }
        if (approverEntry) {
          r.approval_status = 'pending_approval'
          r.pending_approver = user.username
          r.completed_by = approverEntry.username
        }
        addTask(r, { is_multi_assigned: true, ...(isDelegated ? { is_delegated_to_me: true } : {}) })
      }
    })
  }

  // Cluster inbox — sequential because cluster IDs come from the mega-batch clusterMembershipsRes
  {
    const explicitClusterIds = (clusterMembershipsRes.data || []).map((m: Record<string, unknown>) => m.cluster_id as string).filter(Boolean)

    // Dept-based hall access: Manager/Supervisor/Super Manager whose department belongs to a hall
    // can see that hall's inbox even without an explicit cluster_members entry
    let deptClusterIds: string[] = []
    if (['Manager', 'Supervisor', 'Super Manager', 'Admin'].includes(user.role)) {
      const userDeptNames = splitDepartmentsCsv(user.department).filter(Boolean)
      if (userDeptNames.length > 0) {
        const { data: matchedDepts } = await supabase
          .from('departments').select('id').in('name', userDeptNames)
        const deptIds = ((matchedDepts ?? []) as Array<{ id: string }>).map((d) => d.id)
        if (deptIds.length > 0) {
          const { data: hallDepts } = await supabase
            .from('cluster_departments').select('cluster_id').in('department_id', deptIds)
          deptClusterIds = ((hallDepts ?? []) as Array<{ cluster_id: string }>).map((d) => d.cluster_id)
        }
      }
    }

    const clusterIds = [...new Set([...explicitClusterIds, ...deptClusterIds])]
    if (clusterIds.length > 0) {
      const { data: inboxTasks } = await supabase
        .from('todos')
        .select(TASK_LIST_SELECT)
        .eq('archived', false)
        .eq('cluster_inbox', true)
        .in('cluster_id', clusterIds)
        ; ((inboxTasks || []) as unknown as Record<string, unknown>[]).forEach((r) => {
          addTask(r, { is_cluster_inbox: true })
        })
      // NOTE: Hall MA tasks are now caught by the bulletproof MA safety net above
      // (fetches ALL split_to_multi tasks and filters in JS). No separate
      // .contains() query needed here.
    }
  }

  allTasks.sort((a, b) => {
    const pa = a.position || 0
    const pb = b.position || 0
    if (pa !== pb) return pa - pb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  // Strip full history — unread_comment_count carries the badge info, full history loaded on task open
  allTasks.forEach((task) => { task.history = [] })

  return allTasks
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getTodoStats(): Promise<TodoStats> {
  const user = await getSession()
  if (!user) return { total: 0, completed: 0, pending: 0, overdue: 0, highPriority: 0, dueToday: 0, shared: 0 }
  const todos = await getTodos()
  return computeTodoStatsFromTodos(todos)
}

export async function getSidebarTaskCounts(): Promise<SidebarTaskCounts> {
  const user = await getSession()
  if (!user) return { all: 0, completed: 0, in_progress: 0, pending: 0, overdue: 0, queue: 0 }

  const supabase = createServerClient()
  const userLower = user.username.toLowerCase()
  const userDeptKeys = splitDepartmentsCsv(user.department)
    .map((dept) => canonicalDepartmentKey(dept))
    .filter(Boolean)

  // ── Targeted queries for all roles ────────────────────────────────────────
  // Previously, Admin/SM fetched ALL task rows (SELECT * WHERE archived=false)
  // and then filtered to personal tasks in JS.  With thousands of tasks this
  // means reading and deserialising the entire table just to count a handful of
  // admin-owned tasks.  We now use the same targeted query pattern for every
  // role — small indexed lookups rather than a full scan.
  const [ownedRes, assignedRes, completedByRes, maRes, chainRes, chainAssigneeRes2, managedRes, sharedRes, deptQueueRes] = await Promise.all([
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').eq('username', user.username).eq('archived', false) as any),
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').eq('assigned_to', user.username).eq('archived', false) as any),
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').eq('completed_by', user.username).eq('archived', false) as any),
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').contains('multi_assignment', { assignees: [{ username: user.username }] }).eq('archived', false) as any),
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').contains('assignment_chain', [{ user: user.username }]).eq('archived', false) as any),
    // Catch cross-hall tasks where user is next_user in assignment chain — JSONB containment
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').eq('archived', false)
      .contains('assignment_chain', [{ next_user: user.username }]) as any),
    (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').ilike('manager_id', `%${user.username}%`).eq('archived', false) as any),
    (supabase.from('todo_shares').select('todo_id').eq('shared_with', user.username) as any),
    userDeptKeys.length > 0
      ? (supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').eq('queue_status', 'queued').or('assigned_to.is.null,assigned_to.eq.').eq('archived', false) as any)
      : Promise.resolve({ data: [] }),
  ])

  const uniqueMap = new Map<string, any>()
  const addMany = (res: any) => (res.data || []).forEach((r: any) => uniqueMap.set(r.id, r))
  addMany(ownedRes); addMany(assignedRes); addMany(completedByRes); addMany(maRes); addMany(chainRes); addMany(chainAssigneeRes2); addMany(managedRes)

  if (sharedRes.data && sharedRes.data.length > 0) {
    const ids = sharedRes.data.map((s: any) => s.todo_id)
    const { data: sharedTasks } = await supabase.from('todos').select(SIDEBAR_TASK_SELECT + ',assignment_chain').in('id', ids).eq('archived', false) as any
    if (sharedTasks) sharedTasks.forEach((r: any) => uniqueMap.set(r.id, r))
  }

  const isLeaderRoleUser = user.role === 'Manager' || user.role === 'Supervisor' || user.role === 'Super Manager' || user.role === 'Admin'

  if (deptQueueRes.data) {
    deptQueueRes.data.forEach((r: any) => {
      const qDept = canonicalDepartmentKey(r.queue_department || '')
      if (qDept && userDeptKeys.includes(qDept)) uniqueMap.set(r.id, r)
    })

    // For non-leader users, enforce per-cluster queue visibility settings
    if (!isLeaderRoleUser) {
      const uniqueClusterIds = [...new Set(
        (deptQueueRes.data as any[])
          .filter((r: any) => r.cluster_id)
          .map((r: any) => r.cluster_id as string)
      )]
      if (uniqueClusterIds.length > 0) {
        const { data: clusterSettingRows } = await supabase
          .from('cluster_settings')
          .select('cluster_id,allow_dept_users_see_queue,allow_normal_users_see_queue')
          .in('cluster_id', uniqueClusterIds)
        const blockedClusterIds = new Set<string>()
          ; (clusterSettingRows || []).forEach((s: any) => {
            if (!s.allow_dept_users_see_queue || s.allow_normal_users_see_queue === false) {
              blockedClusterIds.add(s.cluster_id)
            }
          })
        if (blockedClusterIds.size > 0) {
          for (const [id, task] of Array.from(uniqueMap.entries())) {
            if (
              task.queue_status === 'queued' &&
              task.cluster_id &&
              blockedClusterIds.has(task.cluster_id) &&
              (task.username || '').toLowerCase() !== userLower // creator always retains visibility
            ) {
              uniqueMap.delete(id)
            }
          }
        }
      }
    }
  }

  const rawTasks = Array.from(uniqueMap.values())

  const tasks = rawTasks.map((row) => normalizeTodo(row, user.username))
  const now = Date.now()

  const isCompletedForUser = (task: Todo): boolean => {
    if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
      const entry = task.multi_assignment.assignees.find(
        (a) => (a.username || '').toLowerCase() === userLower
      )
      if (entry) return entry.status === 'completed' || entry.status === 'accepted'
    }
    const isGloballyDone = task.completed || task.task_status === 'done'
    const isMySubmission = (task.completed_by || '').toLowerCase() === userLower
    const isCurrentlyAssignedToMe = (task.assigned_to || '').toLowerCase() === userLower
    const chain = task.assignment_chain || []
    const hasForwardedSubmission = chain.some((entry) => {
      const actor = (entry.user || '').toLowerCase()
      const role = String(entry.role || '').toLowerCase()
      const action = String(entry.action || '').toLowerCase()
      return actor === userLower && (
        role === 'submitted_for_approval' ||
        action === 'submit' ||
        action === 'complete' ||
        action === 'complete_final'
      )
    })
    if (isGloballyDone) return true
    if (isMySubmission && !isCurrentlyAssignedToMe) return true
    if (isMySubmission && task.approval_status === 'pending_approval') return true
    if (hasForwardedSubmission && (task.approval_status === 'pending_approval' || !isCurrentlyAssignedToMe)) return true
    return false
  }

  const matchesPersonalScopeLogic = (task: Todo): boolean => {
    if (task.username.toLowerCase() === userLower) return true
    if ((task.completed_by || '').toLowerCase() === userLower) return true
    if ((task.assigned_to || '').toLowerCase() === userLower) return true
    if ((task.cluster_routed_by || '').toLowerCase() === userLower) return true

    // Chain check
    const chain = task.assignment_chain || []
    if (chain.some(e => (e.user || '').toLowerCase() === userLower || (e.next_user || '').toLowerCase() === userLower)) return true

    // MA check
    if (task.multi_assignment?.enabled) {
      if (task.multi_assignment.assignees.some(a => (a.username || '').toLowerCase() === userLower)) return true
    }

    // Queue check
    if (task.queue_status === 'queued') {
      const qDept = canonicalDepartmentKey(task.queue_department || '')
      if (qDept && userDeptKeys.includes(qDept)) return true
    }

    return false
  }

  // Final filtered list for "My Tasks" view — apply personal scope to all roles
  const scopedTasks = tasks.filter(matchesPersonalScopeLogic)

  return {
    all: scopedTasks.length,
    completed: scopedTasks.filter((t) => isCompletedForUser(t)).length,
    in_progress: scopedTasks.filter((t) => {
      if (isCompletedForUser(t)) return false
      // Don't count hall-scheduler tasks assigned to someone else as the creator's "in progress"
      const hs = (t as unknown as Record<string, unknown>).scheduler_state as string | null
      if (hs && ['active', 'user_queue', 'paused', 'blocked'].includes(hs) && (t.assigned_to || '').toLowerCase() !== userLower) return false
      return t.task_status === 'in_progress'
    }).length,
    pending: scopedTasks.filter((t) => {
      if (isCompletedForUser(t)) return false
      if (t.task_status === 'in_progress') return false // already counted above
      if (t.queue_status === 'queued') return false // queued tasks belong in Queue count, not Pending
      // Don't count tasks that are currently assigned to another user — they're that user's responsibility
      if (t.assigned_to && (t.assigned_to || '').toLowerCase() !== userLower) return false
      // Don't count hall-scheduler tasks (in someone else's queue) as creator's "pending"
      const hs = (t as unknown as Record<string, unknown>).scheduler_state as string | null
      if (hs && ['active', 'user_queue', 'paused', 'blocked', 'waiting_review'].includes(hs) && (t.assigned_to || '').toLowerCase() !== userLower) return false
      if (t.due_date) {
        const dueTs = new Date(t.due_date).getTime()
        if (!Number.isNaN(dueTs) && dueTs < now) return false
      }
      return true
    }).length,
    overdue: scopedTasks.filter((t) => {
      if (isCompletedForUser(t)) return false
      if (!t.due_date) return false
      const dueTs = new Date(t.due_date).getTime()
      return !Number.isNaN(dueTs) && dueTs < now
    }).length,
    queue: tasks.filter((t) => {
      if (t.queue_status !== 'queued' || !t.queue_department) return false
      if (t.username.toLowerCase() === userLower) return true
      const qDept = canonicalDepartmentKey(t.queue_department)
      return !!qDept && userDeptKeys.includes(qDept)
    }).length,
  }
}

// ── Cached wrappers for hot paths ────────────────────────────────────────────

// Module-level in-memory TTL caches (30 s) — survive warm Lambda re-invocations.
// These caches are cleared on every mutation via revalidateTasksData() so users
// always see fresh data after their own actions.
const _todosCache = new Map<string, { data: Todo[]; til: number }>()
const _countsCache = new Map<string, { data: SidebarTaskCounts; til: number }>()
const CACHE_TTL_MS = 120_000

/** Task list with a 2 min in-memory TTL + unstable_cache for cross-cold-start persistence. Cleared on every mutation. */
export async function getCachedTodos(): Promise<Todo[]> {
  const user = await getSession()
  if (!user) return []
  const key = user.username
  const entry = _todosCache.get(key)
  if (entry && entry.til > Date.now()) return entry.data
  // unstable_cache persists across Vercel cold starts (filesystem/CDN cache)
  const fetchFn = unstable_cache(
    () => getTodos(),
    ['todos', key, user.role ?? '', user.department ?? ''],
    { revalidate: 120, tags: ['tasks-data', `tasks-user-${key}`] }
  )
  const data = await fetchFn()
  _todosCache.set(key, { data, til: Date.now() + CACHE_TTL_MS })
  return data
}

/** Sidebar counts with a 30 s in-memory TTL. Cleared on every mutation. */
export async function getCachedSidebarTaskCounts(): Promise<SidebarTaskCounts> {
  const user = await getSession()
  const key = user?.username ?? '__anon__'
  const entry = _countsCache.get(key)
  if (entry && entry.til > Date.now()) return entry.data
  const data = await getSidebarTaskCounts()
  _countsCache.set(key, { data, til: Date.now() + CACHE_TTL_MS })
  return data
}

/** Bust the tasks server-side cache and revalidate the page. Call after any mutation. */
function revalidateTasksData() {
  _todosCache.clear()
  _countsCache.clear()
  revalidateTag('tasks-data')
  revalidateTag('team-data')
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

export async function getUsersForAssignment(filterByDepartmentOfUser?: string): Promise<Array<{ username: string; role: string; department: string | null; avatar_data: string | null }>> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()
  // If an assignee username is provided, look up their department first
  let departmentFilter: string | null = null
  if (filterByDepartmentOfUser) {
    const { data: assigneeRow } = await supabase
      .from('users')
      .select('department')
      .eq('username', filterByDepartmentOfUser)
      .maybeSingle()
    departmentFilter = assigneeRow?.department ?? null
  }
  let query = supabase
    .from('users')
    .select('username,role,department,avatar_data')
    .order('username')
  if (departmentFilter) {
    query = query.eq('department', departmentFilter)
  }
  const { data } = await query
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

  const supabase = createServerClient()
  const now = new Date().toISOString()
  const id = input.id || crypto.randomUUID()

  // ── Hall "users cannot create tasks" enforcement ──────────────────────────
  // If this task is being CREATED (not edited) and belongs to a cluster, check if
  // the cluster setting blocks normal users from creating tasks.
  const isEdit = Boolean(input.id)
  if (!isEdit && input.cluster_id) {
    const normalRoles = ['User', 'employee', 'Staff']
    const isNormalUser = normalRoles.some(r => (user.role ?? '').toLowerCase() === r.toLowerCase())
    if (isNormalUser) {
      const { data: cs } = await supabase
        .from('cluster_settings')
        .select('users_cannot_create_tasks')
        .eq('cluster_id', input.cluster_id)
        .single()
      if (cs && (cs as Record<string, unknown>).users_cannot_create_tasks === true) {
        return { success: false, error: 'Task creation is restricted in this hall. Only managers and supervisors can create tasks here.' }
      }
    }
  }

  // ── Hall User: Handle days/hours input and department queue ───────────
  let userHall: { cluster_id: string; cluster_name: string; department_queue_enabled: boolean; department_queue_pick_allowed: boolean; enforce_single_task: boolean } | null = null
  let estimatedWorkMinutes: number | null = null
  
  if (!isEdit) {
    userHall = await getUserCurrentHall()
    
    // If user is in a hall, calculate estimated work minutes from days/hours
    if (userHall && (input.estimated_days || input.estimated_hours)) {
      const days = input.estimated_days ?? 0
      const hours = input.estimated_hours ?? 0
      // Assume 8 hours per working day
      estimatedWorkMinutes = (days * 8 * 60) + (hours * 60)
    }
  }

  // Fetch hall-specific office hours (if this task belongs to a cluster)
  const hallHours = await getClusterOfficeHours(supabase, input.cluster_id ?? null)

  if (input.due_date) {
    const dueDate = new Date(input.due_date)
    if (Number.isNaN(dueDate.getTime())) {
      return { success: false, error: 'Invalid due date.' }
    }
    if (dueDate.getTime() <= Date.now()) {
      return { success: false, error: 'Due date must be in the future.' }
    }
  }
  if (input.multi_assignment?.enabled) {
    const invalidEntry = input.multi_assignment.assignees.find((entry) =>
      entry.actual_due_date ? Boolean(validatePakistanOfficeDueDate(entry.actual_due_date, hallHours)) : false
    )
    if (invalidEntry) {
      return {
        success: false,
        error: `Assignee due date for ${invalidEntry.username} must be within this hall's office hours.`,
      }
    }
  }

  if (isEdit) {
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

    let nextAssignedTo: string | null =
      input.routing === 'manager' ? (input.assigned_to || null) : null
    const nextManagerId =
      input.routing === 'manager'
        ? (input.manager_id || input.assigned_to || null)
        : null
    const nextQueueDept =
      input.routing === 'department'
        ? (input.queue_department || user.department || null)
        : null
    let nextQueueStatus: string | null = input.routing === 'department' ? 'queued' : null
    let nextMultiAssignment: MultiAssignment | null =
      input.routing === 'multi' && input.multi_assignment?.enabled
        ? input.multi_assignment
        : null

    // Auto-assign via package resolver when routing to a department
    if (input.routing === 'department' && nextQueueDept) {
      const autoEdit = await resolvePackageAutoAssignment(supabase, input.package_name, nextQueueDept)
      if (autoEdit.type === 'single') {
        nextAssignedTo = autoEdit.username
        nextQueueStatus = 'auto_assigned'
      } else if (autoEdit.type === 'multi') {
        nextMultiAssignment = buildAutoMultiAssignment(autoEdit.usernames, input.due_date, user.username)
        nextQueueStatus = 'auto_assigned'
      }
      // type === 'queue': keep defaults (nextAssignedTo=null, nextQueueStatus='queued', nextMultiAssignment=null)
    }

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
        ? (nextAssignedTo
          ? 'claimed_by_department'
          : nextMultiAssignment?.enabled
            ? 'split_to_multi'
            : 'queued_department')
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
    if (input.routing === 'department' && nextAssignedTo) {
      oldHistory.push({
        type: 'assigned',
        user: user.username,
        details: `Auto-assigned to ${nextAssignedTo} based on package ownership`,
        timestamp: now,
        icon: '🤖',
        title: 'Auto-Assigned',
      })
    } else if (input.routing === 'department' && nextMultiAssignment?.enabled && Array.isArray(nextMultiAssignment.assignees)) {
      oldHistory.push({
        type: 'assigned',
        user: user.username,
        details: `Auto-assigned to ${nextMultiAssignment.assignees.map((a) => a.username).join(', ')} based on package ownership`,
        timestamp: now,
        icon: '🤖',
        title: 'Auto-Assigned (Multi)',
      })
    }
    payload.history = JSON.stringify(oldHistory)

    const { error } = await supabase.from('todos').update(payload).eq('id', input.id)
    if (error) return { success: false, error: error.message }

    // Notify auto-assigned user(s) when department routing resolved via packages
    if (input.routing === 'department') {
      if (nextAssignedTo && nextAssignedTo !== user.username) {
        await createNotification(supabase, {
          userId: nextAssignedTo,
          type: 'task_assigned',
          title: 'Task Auto-Assigned to You',
          body: `${user.username} updated and re-routed a task that was auto-assigned to you based on package ownership: "${input.title.trim()}"`,
          relatedId: input.id!,
        })
      } else if (nextMultiAssignment?.enabled && Array.isArray(nextMultiAssignment.assignees)) {
        await notifyUsers(
          supabase,
          nextMultiAssignment.assignees.map((a) => a.username),
          {
            type: 'task_assigned',
            title: 'Task Auto-Assigned to You',
            body: `${user.username} updated and re-routed a task that was auto-assigned to you based on package ownership: "${input.title.trim()}"`,
            relatedId: input.id!,
          },
          user.username,
        )
      }
    }
  } else {
    // ── Cross-Hall task creation (routing: 'cluster') ─────────────────────────
    // Creates a brand-new task and places it directly in the destination Hall's inbox.
    // The sender does NOT control routing inside the destination Hall.
    if (input.routing === 'cluster') {
      if (!input.cluster_id) return { success: false, error: 'Destination Hall (cluster) is required.' }

      // Verify destination cluster exists and get its name
      const { data: destCluster } = await supabase
        .from('clusters')
        .select('id, name')
        .eq('id', input.cluster_id)
        .single()
      if (!destCluster) return { success: false, error: 'Destination Hall not found.' }
      const destClusterName = (destCluster as Record<string, string>).name

      // Resolve sender's own cluster (for origin tracking)
      const { data: senderMembership } = await supabase
        .from('cluster_members')
        .select('cluster_id')
        .eq('username', user.username)
        .limit(1)
        .single()
      const senderClusterId = (senderMembership as Record<string, string> | null)?.cluster_id ?? null

      const history: HistoryEntry[] = [
        {
          type: 'created',
          user: user.username,
          details: `Cross-Hall task created and sent to ${destClusterName} inbox`,
          timestamp: now,
          icon: '🏛️',
          title: 'Sent to Hall',
        },
      ]

      const assignmentChain: AssignmentChainEntry[] = [
        {
          user: user.username,
          role: 'sent_to_hall',
          assignedAt: now,
          next_user: destClusterName,
        },
      ]

      const payload: Record<string, unknown> = {
        id,
        username: user.username,
        title: input.title.trim(),
        description: input.description || null,
        our_goal: input.our_goal || null,
        completed: false,
        task_status: 'backlog',
        priority: input.priority,
        category: null,
        kpi_type: input.kpi_type,
        due_date: null,
        expected_due_date: null,
        actual_due_date: null,
        requested_due_at: null,
        notes: input.notes || null,
        package_name: input.package_name || null,
        app_name: input.app_name || null,
        position: 0,
        archived: false,
        queue_department: null,
        queue_status: 'cluster_inbox',
        multi_assignment: null,
        assigned_to: null,
        manager_id: null,
        completed_by: null,
        completed_at: null,
        approval_status: 'approved',
        workflow_state: 'queued_cluster',
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
        // Cluster fields
        cluster_id: input.cluster_id,
        cluster_inbox: true,
        cluster_origin_id: senderClusterId,
        cluster_routed_by: user.username,
        created_at: now,
        updated_at: now,
      }

      const { error: insertError } = await supabase.from('todos').insert(payload)
      if (insertError) return { success: false, error: insertError.message }

      // Notify all managers/supervisors/owners of destination cluster
      const { data: destMembers } = await supabase
        .from('cluster_members')
        .select('username')
        .eq('cluster_id', input.cluster_id)
        .in('cluster_role', ['owner', 'manager', 'supervisor'])
      if (destMembers && (destMembers as Array<{ username: string }>).length > 0) {
        await notifyUsers(
          supabase,
          (destMembers as Array<{ username: string }>).map((m) => m.username),
          {
            type: 'task_cluster_inbox',
            title: `New Task in ${destClusterName} Hall`,
            body: `${user.username} sent a task to your Hall inbox: "${input.title.trim()}"`,
            relatedId: id,
          },
          user.username,
        )
      }

      revalidateTasksData()
      emitTaskWebhook('task.created', id, user.username, {
        title: input.title.trim(),
        routing: 'cluster',
        destination_cluster: destClusterName,
      })
      return { success: true, id }
    }

    // ── Normal local task creation ────────────────────────────────────────────
    // Create new
    const taskStatus =
      input.routing === 'manager' || input.routing === 'department' || input.routing === 'multi'
        ? 'backlog'
        : 'todo'

    let assignedTo: string | null =
      input.routing === 'manager' ? (input.assigned_to || null) : null

    const managerId = input.routing === 'manager' ? (input.manager_id || input.assigned_to || null) : null

    const queueDept = input.routing === 'department' ? (input.queue_department || user.department || null) : null
    let queueStatus: string | null = input.routing === 'department' ? 'queued' : null

    let multiAssignment: MultiAssignment | null =
      input.routing === 'multi' && input.multi_assignment?.enabled
        ? input.multi_assignment
        : null

    // Auto-assign via package resolver when routing to a department
    if (input.routing === 'department' && queueDept) {
      const autoCreate = await resolvePackageAutoAssignment(supabase, input.package_name, queueDept)
      if (autoCreate.type === 'single') {
        assignedTo = autoCreate.username
        queueStatus = 'auto_assigned'
      } else if (autoCreate.type === 'multi') {
        multiAssignment = buildAutoMultiAssignment(autoCreate.usernames, input.due_date, user.username)
        queueStatus = 'auto_assigned'
      }
      // type === 'queue': keep defaults (assignedTo=null, queueStatus='queued', multiAssignment=null)
    }

    const rolledMaDue = getMaxMaDueDate(multiAssignment)

    const assignmentChain: AssignmentChainEntry[] = []
    if (assignedTo) {
      assignmentChain.push({
        user: user.username,
        role: input.routing === 'department' ? 'auto_assigned_by_package' : 'assignee',
        assignedAt: now,
        next_user: assignedTo,
      })
    } else if (input.routing === 'department' && queueDept) {
      // Queue fallback — record the routing in the chain so the dept node appears in the Assignment Flow
      assignmentChain.push({
        user: user.username,
        role: 'routed_to_department_queue',
        assignedAt: now,
        next_user: queueDept,
      })
    }
    if (managerId && managerId !== assignedTo) {
      assignmentChain.push({
        user: managerId,
        role: 'manager',
        assignedAt: now,
      })
    }
    // Add chain entries for auto-multi assignment
    if (input.routing === 'department' && multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
      for (const a of multiAssignment.assignees) {
        assignmentChain.push({
          user: user.username,
          role: 'auto_assigned_by_package',
          assignedAt: now,
          next_user: a.username,
        })
      }
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
        details: input.routing === 'department'
          ? `Auto-assigned to ${assignedTo} based on package ownership`
          : `Task assigned to ${assignedTo}`,
        timestamp: now,
        icon: input.routing === 'department' ? '🤖' : '👤',
        title: input.routing === 'department' ? 'Auto-Assigned' : 'Task Assigned',
      })
    }
    if (input.routing === 'department' && multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
      history.push({
        type: 'assigned',
        user: user.username,
        details: `Auto-assigned to ${multiAssignment.assignees.map((a) => a.username).join(', ')} based on package ownership`,
        timestamp: now,
        icon: '🤖',
        title: 'Auto-Assigned (Multi)',
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
          ? (assignedTo
            ? 'claimed_by_department'
            : multiAssignment?.enabled
              ? 'split_to_multi'
              : 'queued_department')
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

    // ── Add Hall-specific fields if user is in a hall ────────────────────────
    if (userHall) {
      payload.cluster_id = userHall.cluster_id

      // All hall tasks enter the scheduler queue
      payload.scheduler_state = 'user_queue'

      // If dept queue is disabled and task was dept-routed with an auto-assignment,
      // clear it so a manager/supervisor manually assigns from the queue instead
      if (input.routing === 'department' && !userHall.department_queue_enabled && assignedTo) {
        payload.assigned_to = null
        payload.queue_status = 'queued'
      }
      
      // Add estimated work minutes from days/hours
      if (estimatedWorkMinutes && estimatedWorkMinutes > 0) {
        payload.estimated_work_minutes = estimatedWorkMinutes
        payload.remaining_work_minutes = estimatedWorkMinutes
        // Calculate effective due date based on work minutes and office hours
        payload.effective_due_at = calculateEffectiveDueAt(now, estimatedWorkMinutes, hallHours).toISOString()
      }
    }

    if (rolledMaDue) {
      payload.due_date = rolledMaDue
      payload.expected_due_date = rolledMaDue
    }

    const { error } = await supabase.from('todos').insert(payload)
    if (error) return { success: false, error: error.message }

    // Notify assigned user if different from creator
    if (assignedTo && assignedTo !== user.username) {
      const isAutoAssigned = input.routing === 'department'
      await createNotification(supabase, {
        userId: assignedTo,
        type: 'task_assigned',
        title: isAutoAssigned ? 'Task Auto-Assigned to You' : 'New Task Assigned to You',
        body: isAutoAssigned
          ? `${user.username} created a task that was auto-assigned to you based on package ownership: "${input.title.trim()}"`
          : `${user.username} assigned you a task: "${input.title.trim()}"`,
        relatedId: id,
      })
    }
    // Notify multi-assignment assignees
    if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
      const isAutoAssigned = input.routing === 'department'
      for (const a of multiAssignment.assignees) {
        if (a.username && a.username !== user.username) {
          await createNotification(supabase, {
            userId: a.username,
            type: 'task_assigned',
            title: isAutoAssigned ? 'Task Auto-Assigned to You' : 'New Task Assigned to You',
            body: isAutoAssigned
              ? `${user.username} created a task that was auto-assigned to you based on package ownership: "${input.title.trim()}"`
              : `${user.username} assigned you a task: "${input.title.trim()}"`,
            relatedId: id,
          })
        }
      }
    }
  }

  revalidateTasksData()
  emitTaskWebhook(isEdit ? 'task.updated' : 'task.created', id, user.username, {
    title: input.title.trim(),
    routing: input.routing,
  })
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

  revalidateTasksData()
  emitTaskWebhook('task.deleted', todoId, user.username)
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
  revalidateTasksData()
  emitTaskWebhook('task.archived', todoId, user.username)
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

  revalidateTasksData()
  emitTaskWebhook('task.started', todoId, user.username, {
    title: String(task.title || ''),
  })
  return { success: true }
}

// ── Toggle complete ───────────────────────────────────────────────────────────

export async function toggleTodoCompleteAction(
  todoId: string,
  completed: boolean,
  submissionNote?: string
): Promise<{ success: boolean; error?: string }> {
  try {
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
    const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

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
        assignmentChain.push({
          user: user.username,
          role: 'submitted_for_approval',
          assignedAt: now,
          next_user: nextApprover,
          feedback: note || undefined,
        })
        updateData = {
          ...updateData,
          completed: false,
          approval_status: 'pending_approval',
          // Preserve original worker if already set (e.g. intermediate submission)
          completed_by: (task.completed_by as string) || user.username,
          // Keep as in_progress so it stays active in the dashboard for the chain
          task_status: 'in_progress',
          workflow_state: 'submitted_for_approval',
          pending_approver: nextApprover,
          approval_chain: JSON.stringify(pendingChain),
          assignment_chain: JSON.stringify(assignmentChain),
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
      // Post feedback as a comment so it surfaces in the activity/comments feed
      if (note) {
        const commentParticipants = new Set<string>()
        if (task.username) commentParticipants.add(String(task.username))
        if (task.assigned_to) commentParticipants.add(String(task.assigned_to))
        if (task.manager_id) {
          String(task.manager_id)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .forEach((v) => commentParticipants.add(v))
        }
        const commentUnreadBy = Array.from(commentParticipants).filter(
          (u) => u.toLowerCase() !== user.username.toLowerCase()
        )
        history.push({
          type: 'comment',
          user: user.username,
          details: note,
          timestamp: now,
          icon: '💬',
          title: 'Completion Feedback',
          message_id: crypto.randomUUID(),
          unread_by: commentUnreadBy,
          read_by: [user.username],
          mention_users: [],
        })
      }
    } else {
      return { success: false, error: 'Reopen task is disabled.' }
    }

    updateData.history = JSON.stringify(history)
    await supabase.from('todos').update(updateData).eq('id', todoId)

    revalidateTasksData()
    emitTaskWebhook('task.completed', todoId, user.username, {
      submissionNote: submissionNote ? submissionNote.trim() : '',
    })
    return { success: true }
  } catch (error) {
    console.error('toggleTodoCompleteAction failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected completion error',
    }
  }
}

// ── Approve completion ────────────────────────────────────────────────────────

export async function approveTodoAction(todoId: string, note?: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,completed_by,assigned_to,title,history,approval_status,assignment_chain,multi_assignment,pending_approver,approval_chain,scheduler_state,cluster_id,queue_rank,total_active_minutes,multi_assign_group_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const multiAssignmentForMaApprove = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (multiAssignmentForMaApprove?.enabled && Array.isArray(multiAssignmentForMaApprove.assignees)) {
    const now = new Date().toISOString()
    const history = parseJson<HistoryEntry[]>(task.history, [])
    const approverLower = user.username.toLowerCase()
    const idx = multiAssignmentForMaApprove.assignees.findIndex((entry) =>
      (entry.ma_approval_status === 'pending_approval') &&
      normalizeChainUsername(entry.ma_pending_approver).toLowerCase() === approverLower,
    )

    if (idx !== -1) {
      const target = multiAssignmentForMaApprove.assignees[idx]
      const entryChain = Array.isArray(target.ma_approval_chain) ? target.ma_approval_chain : []
      const currentStepIndex = entryChain.findIndex(
        (entry) => normalizeApprovalUser(entry.user).toLowerCase() === approverLower && entry.status === 'pending',
      )
      if (currentStepIndex !== -1) {
        entryChain[currentStepIndex] = {
          ...entryChain[currentStepIndex],
          status: 'approved',
          acted_at: now,
          acted_by: user.username,
          comment: note?.trim() || undefined,
        }
      }
      const nextPendingMa = entryChain.find((entry) => entry.status === 'pending')

      multiAssignmentForMaApprove.assignees[idx] = {
        ...target,
        status: nextPendingMa ? 'completed' : 'accepted',
        completed_at: target.completed_at ?? now,
        accepted_at: nextPendingMa ? target.accepted_at : now,
        accepted_by: nextPendingMa ? target.accepted_by : user.username,
        hall_scheduler_state: nextPendingMa ? (target.hall_scheduler_state ?? 'waiting_review') : (target.hall_scheduler_state === 'waiting_review' ? 'completed' : (target.hall_scheduler_state ?? 'completed')),
        hall_remaining_minutes: nextPendingMa ? target.hall_remaining_minutes : 0,
        hall_active_started_at: null,
        hall_effective_due_at: null,
        ma_approval_status: nextPendingMa ? 'pending_approval' : 'approved',
        ma_pending_approver: nextPendingMa ? nextPendingMa.user : null,
        ma_approval_chain: entryChain,
        ma_approval_requested_at: nextPendingMa ? now : null,
        ma_approval_sla_due_at: nextPendingMa ? addHoursIso(now, 48) : null,
        ma_approved_at: nextPendingMa ? target.ma_approved_at : now,
        ma_approved_by: nextPendingMa ? target.ma_approved_by : user.username,
        ma_declined_at: null,
        ma_declined_by: null,
        ma_decline_reason: null,
      }

      touchMultiAssignmentProgress(multiAssignmentForMaApprove)
      const allAccepted = multiAssignmentForMaApprove.assignees.every((entry) => entry.status === 'accepted')

      history.push({
        type: 'approved',
        user: user.username,
        details: note?.trim() || (nextPendingMa
          ? `${user.username} approved ${target.username}'s completion and forwarded it to ${nextPendingMa.user}`
          : `${user.username} approved ${target.username}'s completion`),
        timestamp: now,
        icon: '✅',
        title: nextPendingMa ? 'Approval Forwarded' : 'Completion Approved',
      })

      const updatePayload: Record<string, unknown> = {
        multi_assignment: JSON.stringify(multiAssignmentForMaApprove),
        history: JSON.stringify(history),
        updated_at: now,
      }

      if (allAccepted) {
        updatePayload.completed = true
        updatePayload.completed_at = now
        updatePayload.completed_by = user.username
        updatePayload.task_status = 'done'
        updatePayload.approval_status = 'approved'
        updatePayload.pending_approver = null
        updatePayload.approval_chain = JSON.stringify([])
        updatePayload.approval_requested_at = null
        updatePayload.approval_sla_due_at = null
        updatePayload.approved_at = now
        updatePayload.approved_by = user.username
        updatePayload.workflow_state = 'final_approved'
      }

      await supabase.from('todos').update(updatePayload).eq('id', todoId)

      if (nextPendingMa && normalizeChainUsername(nextPendingMa.user).toLowerCase() !== approverLower) {
        await createNotification(supabase, {
          userId: nextPendingMa.user,
          type: 'task_assigned',
          title: 'Approval Required',
          body: `${user.username} forwarded ${target.username}'s completion of "${task.title as string}" to you for approval.`,
          relatedId: todoId,
        })
      }

      if (target.username.toLowerCase() !== approverLower) {
        await createNotification(supabase, {
          userId: target.username,
          type: 'task_assigned',
          title: nextPendingMa ? 'Task Approval Forwarded' : 'Task Approved!',
          body: nextPendingMa
            ? `${user.username} approved your completion and forwarded it to ${nextPendingMa.user}.`
            : `${user.username} approved your completion of "${task.title as string}".`,
          relatedId: todoId,
        })
      }

      revalidateTasksData()
      emitTaskWebhook('task.approved', todoId, user.username, {
        nextApprover: nextPendingMa?.user ?? null,
        multiAssignee: target.username,
      })
      return { success: true }
    }
  }

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
    details: note || (nextPending
      ? `Task completion approved by ${user.username} and forwarded to ${nextPending.user}`
      : `Task completion approved by ${user.username}`),
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
    // Default to in_progress during the approval cycle unless it's final
    task_status: 'in_progress',
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
    // If approver is NOT the task creator, they are intermediate in the chain.
    // Return the task to them so they can submit their own work upward.
    // Keep completed_by intact so User C can still see their step as completed.
    const isCreator = String(task.username || '').toLowerCase() === user.username.toLowerCase()
    if (!isCreator) {
      // Add a chain entry so findAssignmentStepOwner can trace who "assigned" this user
      // back to the original sender. The previous approver (who submitted) becomes the
      // step owner link so the chain walks correctly upward.
      const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
      const previousAssignedTo = normalizeChainUsername(task.assigned_to)
      // Find who originally assigned this approver into the chain
      // (walk chain for the most recent actual assignment entry pointing to the previous assignee)
      let stepOrigin = normalizeChainUsername(task.username) // fallback: creator
      for (let i = assignmentChain.length - 1; i >= 0; i -= 1) {
        const e = assignmentChain[i]
        const role = normalizeChainUsername(e?.role).toLowerCase()
        if (role === 'submitted_for_approval') continue
        const nu = normalizeChainUsername(e?.next_user)
        if (nu && nu.toLowerCase() === previousAssignedTo.toLowerCase() && normalizeChainUsername(e?.user)) {
          stepOrigin = normalizeChainUsername(e.user)
          break
        }
      }
      assignmentChain.push({
        user: stepOrigin,
        role: 'reassigned_after_approval',
        assignedAt: now,
        next_user: user.username,
        feedback: note || undefined,
      })
      updatePayload.assignment_chain = JSON.stringify(assignmentChain)
      updatePayload.completed = false
      // DO NOT clear completed_by — preserves the original worker's credit
      updatePayload.task_status = 'in_progress'
      updatePayload.approval_status = 'approved'
      updatePayload.assigned_to = user.username
      updatePayload.pending_approver = null
      updatePayload.approval_requested_at = null
      updatePayload.approval_sla_due_at = null
      updatePayload.approved_at = now
      updatePayload.approved_by = user.username
      updatePayload.workflow_state = 'in_progress'
      // Reset hall scheduler state — the original worker's 'waiting_review' should not
      // carry over to the non-creator approver who now has their own work to do.
      if ((task.scheduler_state as string | null) === 'waiting_review') {
        updatePayload.scheduler_state = null
      }
    } else {
      // Creator approved — task is fully complete
      updatePayload.completed = true
      updatePayload.completed_at = now
      updatePayload.task_status = 'done'
      updatePayload.approval_status = 'approved'
      updatePayload.pending_approver = null
      updatePayload.approval_requested_at = null
      updatePayload.approval_sla_due_at = null
      updatePayload.approved_at = now
      updatePayload.approved_by = user.username
      updatePayload.workflow_state = 'final_approved'

      // Hall task: finalize scheduler state and auto-start next queued task
      const hallState = task.scheduler_state as string | null
      const clusterId = task.cluster_id as string | null
      const assignedTo = task.assigned_to as string | null
      if (hallState === 'waiting_review' && clusterId) {
        updatePayload.scheduler_state = 'completed'
        updatePayload.remaining_work_minutes = 0
        // Multi-assign group check: notify creator if all siblings are done
        const multiAssignGroupId = (task.multi_assign_group_id as string | null) ?? null
        if (multiAssignGroupId) {
          const { data: siblings } = await supabase
            .from('todos')
            .select('id, completed, scheduler_state, username')
            .eq('multi_assign_group_id', multiAssignGroupId)
          if (siblings) {
            const sibArr = siblings as Array<{ id: string; completed: boolean; scheduler_state: string; username: string }>
            const allDone = sibArr.every((s) => s.completed || s.id === todoId || s.scheduler_state === 'completed')
            if (allDone) {
              const creatorUsername = sibArr[0].username
              await createNotification(supabase, {
                userId: creatorUsername,
                type: 'task_approved',
                title: 'All Group Members Completed',
                body: `All assignees have completed their parts for "${task.title as string}". Fully approved.`,
                relatedId: todoId,
              })
            }
          }
        }
        // Auto-start next queued task for this user
        if (assignedTo) {
          const hallHours = await getClusterOfficeHours(supabase, clusterId)
          const settings = await getHallSettingsForTask(supabase, clusterId)
          if (settings.auto_start_next_task) {
            await autoActivateNextTask(supabase, assignedTo, clusterId, null, hallHours)
          }
        }
      }
    }
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

  revalidateTasksData()
  emitTaskWebhook('task.approved', todoId, user.username, {
    nextApprover: nextPending?.user ?? null,
  })
  return { success: true }
}

// ── Decline completion ────────────────────────────────────────────────────────

export async function declineTodoAction(todoId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,completed_by,assigned_to,title,history,approval_status,pending_approver,approval_chain,scheduler_state,cluster_id,queue_rank')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const multiAssignmentForMaDecline = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (multiAssignmentForMaDecline?.enabled && Array.isArray(multiAssignmentForMaDecline.assignees)) {
    const now = new Date().toISOString()
    const history = parseJson<HistoryEntry[]>(task.history, [])
    const approverLower = user.username.toLowerCase()
    const idx = multiAssignmentForMaDecline.assignees.findIndex((entry) =>
      (entry.ma_approval_status === 'pending_approval') &&
      normalizeChainUsername(entry.ma_pending_approver).toLowerCase() === approverLower,
    )

    if (idx !== -1) {
      const target = multiAssignmentForMaDecline.assignees[idx]
      const entryChain = (Array.isArray(target.ma_approval_chain) ? target.ma_approval_chain : []).map((entry) => {
        if (entry.status !== 'pending') return entry
        if (normalizeApprovalUser(entry.user).toLowerCase() !== approverLower) return entry
        return {
          ...entry,
          status: 'declined' as const,
          acted_at: now,
          acted_by: user.username,
          comment: reason || undefined,
        }
      })

      multiAssignmentForMaDecline.assignees[idx] = {
        ...target,
        status: 'in_progress',
        notes: reason || target.notes,
        rejection_reason: reason || target.rejection_reason,
        hall_scheduler_state: target.hall_scheduler_state === 'waiting_review' ? 'paused' : (target.hall_scheduler_state ?? 'paused'),
        hall_active_started_at: null,
        ma_approval_status: 'declined',
        ma_pending_approver: null,
        ma_approval_chain: entryChain,
        ma_approval_requested_at: null,
        ma_approval_sla_due_at: null,
        ma_declined_at: now,
        ma_declined_by: user.username,
        ma_decline_reason: reason || null,
      }
      touchMultiAssignmentProgress(multiAssignmentForMaDecline)

      history.push({
        type: 'declined',
        user: user.username,
        details: `${user.username} declined ${target.username}'s completion${reason ? ': ' + reason : ''}`,
        timestamp: now,
        icon: '❌',
        title: 'Completion Declined',
      })

      await supabase.from('todos').update({
        multi_assignment: JSON.stringify(multiAssignmentForMaDecline),
        history: JSON.stringify(history),
        updated_at: now,
      }).eq('id', todoId)

      if (target.username.toLowerCase() !== approverLower) {
        await createNotification(supabase, {
          userId: target.username,
          type: 'task_assigned',
          title: 'Task Completion Declined',
          body: `${user.username} declined your completion of "${task.title as string}".${reason ? ' Reason: ' + reason : ''}`,
          relatedId: todoId,
        })
      }

      revalidateTasksData()
      emitTaskWebhook('task.declined', todoId, user.username, {
        reason,
        multiAssignee: target.username,
      })
      return { success: true }
    }
  }

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

  // Hall task in waiting_review: revert to paused so it re-enters queue competition
  const hallState = task.scheduler_state as string | null
  const isHallReview = hallState === 'waiting_review'

  await supabase.from('todos').update({
    completed: false,
    approval_status: 'declined',
    declined_at: now,
    declined_by: user.username,
    decline_reason: reason || null,
    completed_by: null,
    assigned_to: previousAssignee || (task.assigned_to as string),
    task_status: isHallReview ? 'todo' : 'in_progress',
    workflow_state: isHallReview ? 'in_progress' : 'rework_required',
    // Hall: revert scheduler_state to paused so it sits in queue, ready when next slot opens
    ...(isHallReview ? { scheduler_state: 'paused', active_started_at: null } : {}),
    pending_approver: null,
    approval_chain: JSON.stringify(approvalChain),
    approval_requested_at: null,
    approval_sla_due_at: null,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  // Hall: auto-start next queued task if applicable (the declined task reverts to paused,
  // will be re-activated when the active task finishes or is paused)
  if (isHallReview) {
    const clusterId = task.cluster_id as string | null
    const assignedTo = previousAssignee
    if (clusterId && assignedTo) {
      const hallHours = await getClusterOfficeHours(supabase, clusterId)
      const settings = await getHallSettingsForTask(supabase, clusterId)
      if (settings.auto_start_next_task) {
        await autoActivateNextTask(supabase, assignedTo, clusterId, todoId, hallHours)
      }
    }
  }

  if (task.completed_by && (task.completed_by as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.completed_by as string,
      type: 'task_assigned',
      title: 'Task Completion Declined',
      body: `${user.username} declined your completion of "${task.title}".${reason ? ' Reason: ' + reason : ''}`,
      relatedId: todoId,
    })
  }

  revalidateTasksData()
  emitTaskWebhook('task.declined', todoId, user.username, {
    reason,
  })
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
      type: 'task_comment',
      title: `💬 New message on "${task.title as string}"`,
      body: `${user.username}: ${message.trim().slice(0, 100)}`,
      relatedId: todoId,
    })
  }

  revalidateTasksData()
  emitTaskWebhook('task.comment.created', todoId, user.username, {
    messageId: newComment.message_id,
    mentions: mentionUsers,
  })
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

  revalidateTasksData()
  emitTaskWebhook('task.comment.updated', todoId, user.username, {
    messageId,
    mentions: mentionUsers,
  })
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

  revalidateTasksData()
  emitTaskWebhook('task.comment.deleted', todoId, user.username, {
    messageId,
  })
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

  revalidateTasksData()
  emitTaskWebhook('task.shared', todoId, user.username, {
    sharedWithUsername,
  })
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

  revalidateTasksData()
  emitTaskWebhook('task.unshared', todoId, user.username, {
    sharedWithUsername,
  })
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

  revalidateTasksData()
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

  revalidateTasksData()
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

  revalidateTasksData()
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
  let currentMaEntry: MultiAssignmentEntry | undefined
  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    const uLower = user.username.toLowerCase()
    const myEntry = task.multi_assignment.assignees.find((entry) => (entry.username || '').toLowerCase() === uLower)
    currentMaEntry = myEntry
    const approverEntry = task.multi_assignment.assignees.find((entry) =>
      entry.ma_approval_status === 'pending_approval' &&
      normalizeChainUsername(entry.ma_pending_approver).toLowerCase() === uLower,
    )

    if (myEntry) {
      const derivedMaState = myEntry.hall_scheduler_state
        ?? (myEntry.ma_approval_status === 'pending_approval' ? 'waiting_review' : null)
        ?? (myEntry.status === 'in_progress' ? 'active' : null)
        ?? ((myEntry.status === 'completed' || myEntry.status === 'accepted') ? 'completed' : null)
        ?? 'user_queue'
      task.scheduler_state = derivedMaState as Todo['scheduler_state']
      if (myEntry.hall_queue_rank != null) task.queue_rank = myEntry.hall_queue_rank
      if (myEntry.hall_remaining_minutes != null) task.remaining_work_minutes = myEntry.hall_remaining_minutes
      if (myEntry.hall_active_started_at !== undefined) task.active_started_at = myEntry.hall_active_started_at
      if (myEntry.hall_effective_due_at !== undefined) task.effective_due_at = myEntry.hall_effective_due_at
      if (myEntry.ma_approval_status) task.approval_status = myEntry.ma_approval_status as Todo['approval_status']
      else if (myEntry.status === 'completed') task.approval_status = 'pending_approval'
      if (myEntry.ma_pending_approver !== undefined) task.pending_approver = myEntry.ma_pending_approver
    }

    if (approverEntry) {
      task.approval_status = 'pending_approval'
      task.pending_approver = user.username
      task.completed_by = approverEntry.username
    }
  }

  const detailMeta: Record<string, unknown> = {}
  if (task.cluster_id) {
    const targetUsername = currentMaEntry?.username || task.assigned_to || null
    const currentState = (currentMaEntry?.hall_scheduler_state
      ?? (currentMaEntry?.ma_approval_status === 'pending_approval' ? 'waiting_review' : null)
      ?? (currentMaEntry?.status === 'in_progress' ? 'active' : null)
      ?? ((currentMaEntry?.status === 'completed' || currentMaEntry?.status === 'accepted') ? 'completed' : null)
      ?? task.scheduler_state
      ?? null) as string | null
    const currentRank = currentMaEntry?.hall_queue_rank ?? task.queue_rank ?? null
    if (targetUsername && currentState && ['active', 'user_queue', 'paused', 'waiting_review', 'blocked'].includes(currentState)) {
      const [singleRowsRes, maRowsRes] = await Promise.all([
        supabase
          .from('todos')
          .select('id, scheduler_state, queue_rank')
          .eq('cluster_id', task.cluster_id)
          .eq('assigned_to', targetUsername)
          .eq('completed', false)
          .in('scheduler_state', ['active', 'user_queue', 'paused', 'waiting_review', 'blocked']),
        supabase
          .from('todos')
          .select('id, multi_assignment')
          .eq('cluster_id', task.cluster_id)
          .eq('completed', false)
          .eq('workflow_state', 'split_to_multi'),
      ])

      const queuedRanks: number[] = []
      let hasOtherQueued = false

      ; (singleRowsRes.data ?? []).forEach((row: Record<string, unknown>) => {
        const state = row.scheduler_state as string | null
        const rank = (row.queue_rank as number | null) ?? null
        const isQueued = state === 'user_queue' || state === 'paused'
        if (!isQueued || rank == null) return
        queuedRanks.push(rank)
        if ((row.id as string) !== task.id) hasOtherQueued = true
      })

      ; (maRowsRes.data ?? []).forEach((row: Record<string, unknown>) => {
        const ma = parseJson<MultiAssignment | null>(row.multi_assignment, null)
        if (!ma?.enabled || !Array.isArray(ma.assignees)) return
        const entry = ma.assignees.find((a) => (a.username || '').toLowerCase() === targetUsername.toLowerCase())
        if (!entry) return
        const state = entry.hall_scheduler_state
          ?? (entry.ma_approval_status === 'pending_approval' ? 'waiting_review' : null)
          ?? (entry.status === 'in_progress' ? 'active' : null)
          ?? ((entry.status === 'completed' || entry.status === 'accepted') ? 'completed' : null)
          ?? 'user_queue'
        const rank = entry.hall_queue_rank ?? null
        const isQueued = state === 'user_queue' || state === 'paused'
        if (!isQueued || rank == null) return
        queuedRanks.push(rank)
        if ((row.id as string) !== task.id) hasOtherQueued = true
      })

      const minRank = queuedRanks.length > 0 ? Math.min(...queuedRanks) : null
      const isFirst = (currentState === 'user_queue' || currentState === 'paused') && currentRank != null && minRank != null
        ? currentRank <= minRank
        : false

      detailMeta.hall_has_other_queued = hasOtherQueued
      detailMeta.hall_is_first_in_queue = isFirst
    }
  }
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
      ; (assignee.delegated_to || []).forEach((subAssignee) => {
        if (subAssignee.username) participantUsernames.add(subAssignee.username)
      })
  })
    ; (sharesRes.data || []).forEach((share: Record<string, unknown>) => {
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
    ...detailMeta,
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
  revalidateTasksData()
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

  revalidateTasksData()
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

  revalidateTasksData()
  return { success: true, id: newId }
}

// ── Claim queued task (dept queue pick) ──────────────────────────────────────

export async function claimQueuedTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,queue_status,queue_department,task_status,history,title,assignment_chain,cluster_id,estimated_work_minutes,remaining_work_minutes')
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

  // ── Hall queue enforcement checks + scheduler transition ──────────────────
  const taskClusterId = task.cluster_id as string | null
  let hasActiveInHall = false
  let queuedInsertRank: number | null = null
  if (taskClusterId) {
    const { data: clusterSettings } = await supabase
      .from('cluster_settings')
      .select('department_queue_pick_allowed, enforce_single_task')
      .eq('cluster_id', taskClusterId)
      .single()

    if (clusterSettings) {
      const settings = clusterSettings as Record<string, unknown>
      const pickAllowed = settings.department_queue_pick_allowed !== false // default true
      const enforceSingle = settings.enforce_single_task !== false // default true

      // If department_queue_pick_allowed is false, only managers/supervisors can claim
      if (!pickAllowed) {
        const isLeader = ['Admin', 'Super Manager', 'Manager', 'Supervisor'].includes(user.role)
        if (!isLeader) {
          // Also check cluster membership role
          const { data: membership } = await supabase
            .from('cluster_members')
            .select('cluster_role')
            .eq('cluster_id', taskClusterId)
            .eq('username', user.username)
            .single()
          const clusterRole = (membership as Record<string, string> | null)?.cluster_role ?? ''
          if (!['owner', 'manager', 'supervisor'].includes(clusterRole)) {
            return { success: false, error: 'Task picking from queue is restricted to managers and supervisors in this hall.' }
          }
        }
      }

      // If enforce_single_task is true, keep only one active task.
      // Additional claimed tasks are queued automatically for the user.
      if (enforceSingle) {
        const { data: activeTask } = await supabase
          .from('todos')
          .select('id, title, queue_rank')
          .eq('assigned_to', user.username)
          .eq('cluster_id', taskClusterId)
          .eq('completed', false)
          .eq('scheduler_state', 'active')
          .limit(1)
        hasActiveInHall = !!(activeTask && activeTask.length > 0)
        if (hasActiveInHall) {
          const { data: existingQueueRows } = await supabase
            .from('todos')
            .select('queue_rank')
            .eq('assigned_to', user.username)
            .eq('cluster_id', taskClusterId)
            .eq('completed', false)
            .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
          const maxRank = ((existingQueueRows ?? []) as Array<{ queue_rank: number | null }>).reduce(
            (mx, row) => Math.max(mx, row.queue_rank ?? 0),
            0,
          )
          queuedInsertRank = maxRank + 1
        }
      }
    }
  }

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

  const updatePayload: Record<string, unknown> = {
    assigned_to: user.username,
    queue_status: 'claimed',
    task_status: 'todo',
    workflow_state: 'claimed_by_department',
    assignment_chain: JSON.stringify(assignmentChain),
    last_handoff_at: now,
    history: JSON.stringify(history),
    updated_at: now,
  }

  // For hall-created queue tasks: auto-start immediately when user has no active hall task.
  // Timer begins only in active state and pauses stop the timer via pauseHallTaskAction.
  if (taskClusterId) {
    const hallHours = await getClusterOfficeHours(supabase, taskClusterId)
    const baseRemaining =
      (task.remaining_work_minutes as number | null) ??
      (task.estimated_work_minutes as number | null) ??
      null

    if (!hasActiveInHall) {
      updatePayload.scheduler_state = 'active'
      updatePayload.task_status = 'in_progress'
      updatePayload.queue_rank = null
      updatePayload.active_started_at = now
      updatePayload.effective_due_at =
        baseRemaining && baseRemaining > 0
          ? calculateEffectiveDueAt(now, baseRemaining, hallHours).toISOString()
          : null
    } else {
      updatePayload.scheduler_state = 'user_queue'
      updatePayload.task_status = 'todo'
      updatePayload.queue_rank = queuedInsertRank ?? 1
      updatePayload.active_started_at = null
      updatePayload.effective_due_at = null
    }
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  if ((task.username as string) && (task.username as string) !== user.username) {
    await createNotification(supabase, {
      userId: task.username as string,
      type: 'task_assigned',
      title: 'Task Claimed from Queue',
      body: `${user.username} claimed your queued task "${task.title}"`,
      relatedId: todoId,
    })
  }

  revalidateTasksData()
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

  revalidateTasksData()
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

  revalidateTasksData()
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
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,completed,approval_status,title,history,assignment_chain,package_name,multi_assignment,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  {
    const hallHours = await getClusterOfficeHours(supabase, (existing as Record<string, unknown>).cluster_id as string | null)
    const dueErr = validatePakistanOfficeDueDate(targetDueDate, hallHours)
    if (dueErr) return { success: false, error: dueErr }
  }

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

  // ── Auto-assign via package resolver ────────────────────────────────────────
  const autoRoute = await resolvePackageAutoAssignment(
    supabase,
    task.package_name as string | null,
    targetDepartment,
  )

  // Record the routing intent regardless of auto-assign outcome
  assignmentChain.push({
    user: user.username,
    role: 'routed_to_department_queue',
    assignedAt: now,
    next_user: targetDepartment,
    feedback: note?.trim() || undefined,
  })

  if (autoRoute.type === 'single') {
    // ── Single auto-assign path ────────────────────────────────────────────
    assignmentChain.push({
      user: user.username,
      role: 'auto_assigned_by_package',
      assignedAt: now,
      next_user: autoRoute.username,
    })
    history.push({
      type: 'assigned',
      user: user.username,
      details: `${user.username} routed task to ${targetDepartment} — auto-assigned to ${autoRoute.username} based on package ownership${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
      timestamp: now,
      icon: '🤖',
      title: 'Auto-Assigned',
    })

    await supabase.from('todos').update({
      assigned_to: autoRoute.username,
      manager_id: user.username,
      queue_department: targetDepartment,
      queue_status: 'auto_assigned',
      task_status: 'backlog',
      workflow_state: 'claimed_by_department',
      due_date: dueIso,
      expected_due_date: dueIso,
      actual_due_date: dueIso,
      assignment_chain: JSON.stringify(assignmentChain),
      history: JSON.stringify(history),
      pending_approver: null,
      approval_chain: JSON.stringify([]),
      approval_requested_at: null,
      approval_sla_due_at: null,
      last_handoff_at: now,
      updated_at: now,
    }).eq('id', todoId)

    if (autoRoute.username !== user.username) {
      await createNotification(supabase, {
        userId: autoRoute.username,
        type: 'task_assigned',
        title: 'Task Auto-Assigned to You',
        body: `${user.username} routed "${task.title as string}" to ${targetDepartment} — auto-assigned to you based on package ownership.`,
        relatedId: todoId,
      })
    }
    if (typeof task.username === 'string' && task.username && task.username !== user.username) {
      await createNotification(supabase, {
        userId: task.username,
        type: 'task_assigned',
        title: 'Task Auto-Assigned',
        body: `${user.username} routed your task "${task.title as string}" to ${targetDepartment} — auto-assigned to ${autoRoute.username} based on package ownership.`,
        relatedId: todoId,
      })
    }

  } else if (autoRoute.type === 'multi') {
    // ── Multi auto-assign path ─────────────────────────────────────────────
    // Only proceed if the task does not already have an active multi-assignment.
    const existingMa = parseJson<MultiAssignment | null>(task.multi_assignment, null)
    if (existingMa?.enabled) {
      // Already multi-assigned — fall through to queue to avoid overwriting active work.
      // (Handled by the queue block below; re-push with queue semantics.)
      history.push({
        type: 'assigned',
        user: user.username,
        details: `${user.username} routed task to ${targetDepartment} queue with due date ${dueIso}${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
        timestamp: now,
        icon: '📤',
        title: 'Sent To Department Queue',
      })
      await supabase.from('todos').update({
        assigned_to: null,
        manager_id: user.username,
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
      // Notify dept users about the queued task
      try {
        const { data: deptUsers } = await supabase.from('users').select('username').ilike('department', `%${targetDepartment}%`)
        if (deptUsers && deptUsers.length > 0) {
          for (const deptUser of deptUsers as Array<{ username: string }>) {
            if (deptUser.username && deptUser.username !== user.username) {
              await createNotification(supabase, {
                userId: deptUser.username,
                type: 'task_assigned',
                title: 'New Task in Your Department Queue',
                body: `${user.username} added "${task.title as string}" to the ${targetDepartment} queue.`,
                relatedId: todoId,
              })
            }
          }
        }
      } catch { /* non-critical */ }
    } else {
      const autoMa = buildAutoMultiAssignment(autoRoute.usernames, dueIso, user.username)
      const rolledDue = getMaxMaDueDate(autoMa) ?? dueIso
      for (const username of autoRoute.usernames) {
        assignmentChain.push({
          user: user.username,
          role: 'auto_assigned_by_package',
          assignedAt: now,
          next_user: username,
        })
      }
      const assigneeNames = autoRoute.usernames.join(', ')
      history.push({
        type: 'assigned',
        user: user.username,
        details: `${user.username} routed task to ${targetDepartment} — auto-assigned to ${assigneeNames} based on package ownership${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
        timestamp: now,
        icon: '🤖',
        title: 'Auto-Assigned (Multi)',
      })

      await supabase.from('todos').update({
        multi_assignment: JSON.stringify(autoMa),
        assigned_to: null,
        manager_id: user.username,
        queue_department: targetDepartment,
        queue_status: 'auto_assigned',
        task_status: 'backlog',
        workflow_state: 'split_to_multi',
        due_date: rolledDue,
        expected_due_date: rolledDue,
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

      await notifyUsers(
        supabase,
        autoRoute.usernames,
        {
          type: 'task_assigned',
          title: 'Task Auto-Assigned to You',
          body: `${user.username} routed "${task.title as string}" to ${targetDepartment} — auto-assigned to you based on package ownership.`,
          relatedId: todoId,
        },
        user.username,
      )
      if (typeof task.username === 'string' && task.username && task.username !== user.username) {
        await createNotification(supabase, {
          userId: task.username,
          type: 'task_assigned',
          title: 'Task Auto-Assigned',
          body: `${user.username} routed your task "${task.title as string}" to ${targetDepartment} — auto-assigned to ${assigneeNames} based on package ownership.`,
          relatedId: todoId,
        })
      }
    }

  } else {
    // ── Queue fallback path (existing behaviour) ───────────────────────────
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
      manager_id: user.username,
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

    if (typeof task.username === 'string' && task.username && task.username !== user.username) {
      await createNotification(supabase, {
        userId: task.username,
        type: 'task_assigned',
        title: 'Task Sent To Department Queue',
        body: `${user.username} routed "${task.title as string}" to ${targetDepartment} with due date ${dueIso}.`,
        relatedId: todoId,
      })
    }
    // Notify users in the target department about the new queued task
    try {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('username')
        .ilike('department', `%${targetDepartment}%`)
      if (deptUsers && deptUsers.length > 0) {
        for (const deptUser of deptUsers as Array<{ username: string }>) {
          if (deptUser.username && deptUser.username !== user.username) {
            await createNotification(supabase, {
              userId: deptUser.username,
              type: 'task_assigned',
              title: 'New Task in Your Department Queue',
              body: `${user.username} added "${task.title as string}" to the ${targetDepartment} queue.`,
              relatedId: todoId,
            })
          }
        }
      }
    } catch {
      // Non-critical: don't fail if dept notifications fail
    }
  }

  revalidateTasksData()
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

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,completed,multi_assignment,approval_status,history,title,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  // Validate against the hall's office hours now that we know the cluster
  const hallHours = await getClusterOfficeHours(supabase, (existing as Record<string, unknown>).cluster_id as string | null)
  const invalidOfficeAssignee = normalizedAssignees.find((entry) =>
    entry.actual_due_date ? Boolean(validatePakistanOfficeDueDate(entry.actual_due_date, hallHours)) : false
  )
  if (invalidOfficeAssignee) {
    return {
      success: false,
      error: `Due date for ${invalidOfficeAssignee.username} is outside this hall's office hours.`,
    }
  }

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

  revalidateTasksData()
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

  const parsedDueDate = new Date(nextDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,title,completed,approval_status,multi_assignment,history,expected_due_date,assignment_chain,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  // Validate against the hall's office hours (or global default if no cluster)
  const hallHours = await getClusterOfficeHours(supabase, (existing as Record<string, unknown>).cluster_id as string | null)
  {
    const dueErr = validatePakistanOfficeDueDate(nextDueDate, hallHours)
    if (dueErr) return { success: false, error: dueErr }
  }

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

  revalidateTasksData()
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

  const parsedDueDate = new Date(nextDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,title,completed,approval_status,multi_assignment,history,assignment_chain,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const hallHours = await getClusterOfficeHours(supabase, (existing as Record<string, unknown>).cluster_id as string | null)
  {
    const dueErr = validatePakistanOfficeDueDate(nextDueDate, hallHours)
    if (dueErr) return { success: false, error: dueErr }
  }

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

  revalidateTasksData()
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

  const parsedDueDate = new Date(nextDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return { success: false, error: 'Invalid due date.' }
  const dueIso = parsedDueDate.toISOString()

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,title,completed,approval_status,multi_assignment,history,assignment_chain,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const hallHours = await getClusterOfficeHours(supabase, (existing as Record<string, unknown>).cluster_id as string | null)
  {
    const dueErr = validatePakistanOfficeDueDate(nextDueDate, hallHours)
    if (dueErr) return { success: false, error: dueErr }
  }

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

  revalidateTasksData()
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
    .select('username,title,completed,approval_status,multi_assignment,history,assignment_chain,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const hallHours = await getClusterOfficeHours(supabase, (existing as Record<string, unknown>).cluster_id as string | null)
  const invalidOfficeAssignee = normalizedAssignees.find((entry) =>
    entry.actual_due_date ? Boolean(validatePakistanOfficeDueDate(entry.actual_due_date, hallHours)) : false
  )
  if (invalidOfficeAssignee) {
    return {
      success: false,
      error: `Due date for ${invalidOfficeAssignee.username} is outside this hall's office hours.`,
    }
  }

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

  revalidateTasksData()
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
    .select('username,assigned_to,multi_assignment,history,title,assignment_chain,cluster_id')
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

  // Sync hall scheduler state when user starts or completes their MA part
  const clusterId = task.cluster_id as string | null
  let newHallSchedulerState: string | undefined
  let hallActiveStartedAt: string | null | undefined

  if (newStatus === 'in_progress' && clusterId) {
    // Enforce one-active-at-a-time: check for existing active regular task
    const { data: activeRegular } = await supabase
      .from('todos')
      .select('id')
      .eq('assigned_to', user.username)
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('scheduler_state', 'active')
      .limit(1)
    // Also check for an already-active MA task entry for this user in this cluster
    const { data: allClusterMaCheck } = await supabase
      .from('todos')
      .select('multi_assignment')
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('workflow_state', 'split_to_multi')
    const hasActiveMa = ((allClusterMaCheck ?? []) as Array<{ multi_assignment: unknown }>)
      .some((t) => {
        const maTmp = parseJson<MultiAssignment | null>(t.multi_assignment, null)
        return maTmp?.assignees?.some(
          (a) => a.username.toLowerCase() === user.username.toLowerCase() &&
                  a.hall_scheduler_state === 'active'
        )
      })
    if (!activeRegular?.length && !hasActiveMa) {
      newHallSchedulerState = 'active'
      hallActiveStartedAt = now
    } else {
      newHallSchedulerState = 'user_queue'
      hallActiveStartedAt = null
    }
  } else if (newStatus === 'completed') {
    // Keep MA hall task in review state until the assignee's completion is approved.
    newHallSchedulerState = clusterId ? 'waiting_review' : undefined
    hallActiveStartedAt = null
  }

  const pendingChain = newStatus === 'completed'
    ? buildPendingApprovalChain(task, user.username, now)
    : []
  const nextApprover = newStatus === 'completed'
    ? (pendingChain[0]?.user || normalizeChainUsername(task.username))
    : ''
  const hasAssigneeApproval = newStatus === 'completed' && !!nextApprover

  ma.assignees[assigneeIdx] = {
    ...ma.assignees[assigneeIdx],
    status: newStatus,
    ...(newHallSchedulerState !== undefined ? { hall_scheduler_state: newHallSchedulerState } : {}),
    ...(hallActiveStartedAt !== undefined ? { hall_active_started_at: hallActiveStartedAt } : {}),
    ...(newStatus === 'completed'
      ? {
          completed_at: now,
          notes: notes || undefined,
          ma_approval_status: hasAssigneeApproval ? 'pending_approval' as const : 'approved' as const,
          ma_pending_approver: hasAssigneeApproval ? nextApprover : null,
          ma_approval_chain: hasAssigneeApproval ? pendingChain : [],
          ma_approval_requested_at: hasAssigneeApproval ? now : null,
          ma_approval_sla_due_at: hasAssigneeApproval ? addHoursIso(now, 48) : null,
          ma_approved_at: hasAssigneeApproval ? null : now,
          ma_approved_by: hasAssigneeApproval ? null : user.username,
          ma_declined_at: null,
          ma_declined_by: null,
          ma_decline_reason: null,
        }
      : {
          completed_at: undefined,
          ma_approval_status: undefined,
          ma_pending_approver: null,
          ma_approval_chain: [],
          ma_approval_requested_at: null,
          ma_approval_sla_due_at: null,
          ma_approved_at: null,
          ma_approved_by: null,
          ma_declined_at: null,
          ma_declined_by: null,
          ma_decline_reason: null,
        }),
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

  // Post notes as a comment so it surfaces in the activity/comments feed
  if (newStatus === 'completed' && notes?.trim()) {
    const noteText = notes.trim()
    const commentParticipants = new Set<string>()
    if (task.username) commentParticipants.add(String(task.username))
    if ((task as Record<string, unknown>).assigned_to) commentParticipants.add(String((task as Record<string, unknown>).assigned_to))
    ma.assignees.forEach((a) => { if (a.username) commentParticipants.add(a.username) })
    const commentUnreadBy = Array.from(commentParticipants).filter(
      (u) => u.toLowerCase() !== user.username.toLowerCase()
    )
    history.push({
      type: 'comment',
      user: user.username,
      details: noteText,
      timestamp: now,
      icon: '💬',
      title: 'Completion Feedback',
      message_id: crypto.randomUUID(),
      unread_by: commentUnreadBy,
      read_by: [user.username],
      mention_users: [],
    })
  }

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
    // Auto-activate the next task in the user's hall queue after completing MA work
    if (clusterId) {
      const hallHours = await getClusterOfficeHours(supabase, clusterId)
      const settings = await getHallSettingsForTask(supabase, clusterId)
      if (settings.auto_start_next_task) {
        await autoActivateNextTask(supabase, user.username, clusterId, todoId, hallHours)
      }
    }
  }

  revalidateTasksData()
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
  ma.assignees[idx] = {
    ...ma.assignees[idx],
    status: 'accepted',
    completed_at: now,
    accepted_at: now,
    accepted_by: user.username,
    hall_scheduler_state: ma.assignees[idx].hall_scheduler_state === 'waiting_review' ? 'completed' : ma.assignees[idx].hall_scheduler_state,
    hall_remaining_minutes: 0,
    hall_active_started_at: null,
    hall_effective_due_at: null,
    ma_approval_status: 'approved',
    ma_pending_approver: null,
    ma_approval_chain: [],
    ma_approval_requested_at: null,
    ma_approval_sla_due_at: null,
    ma_approved_at: now,
    ma_approved_by: user.username,
    ma_declined_at: null,
    ma_declined_by: null,
    ma_decline_reason: null,
  }
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
    // All sub-assignees accepted — put task back to in_progress so User B (step owner)
    // sees their "Submit for Approval" button and can explicitly send it up the chain.
    // Do NOT set task_status='done' here — that hides the completion button from User B.
    updatePayload.task_status = 'in_progress'
    updatePayload.workflow_state = 'ma_all_accepted'
    updatePayload.completed = false
    updatePayload.completed_at = null
    updatePayload.completed_by = null
    updatePayload.approval_status = 'approved'
    updatePayload.pending_approver = null
    updatePayload.approval_chain = JSON.stringify([])
    updatePayload.approval_requested_at = null
    updatePayload.approval_sla_due_at = null

    history.push({
      type: 'completed',
      user: user.username,
      details: `${user.username} accepted all sub-assignee work. Task is ready for final submission.`,
      timestamp: now,
      icon: '🎯',
      title: 'All Work Accepted',
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
    // Notify the task owner (User B) that all work is accepted and they can now complete the task
    const maCreatedBy = normalizeChainUsername(parseJson<MultiAssignment | null>(task.multi_assignment, null)?.created_by || '')
    const stepOwnerToNotify = maCreatedBy || normalizeChainUsername(task.assigned_to) || normalizeChainUsername(task.username)
    if (stepOwnerToNotify && stepOwnerToNotify.toLowerCase() !== user.username.toLowerCase()) {
      await createNotification(supabase, {
        userId: stepOwnerToNotify,
        type: 'task_assigned',
        title: 'All Assigned Work Accepted',
        body: `All sub-assignee work on "${task.title as string}" has been accepted. You can now submit the task for your own approval.`,
        relatedId: todoId,
      })
    }
  }

  revalidateTasksData()
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
    hall_scheduler_state: ma.assignees[idx].hall_scheduler_state === 'waiting_review' ? 'paused' : ma.assignees[idx].hall_scheduler_state,
    hall_active_started_at: null,
    completed_at: undefined,
    accepted_at: undefined,
    accepted_by: undefined,
    ma_approval_status: 'declined',
    ma_pending_approver: null,
    ma_approval_chain: [],
    ma_approval_requested_at: null,
    ma_approval_sla_due_at: null,
    ma_approved_at: null,
    ma_approved_by: null,
    ma_declined_at: now,
    ma_declined_by: user.username,
    ma_decline_reason: reason.trim(),
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

  revalidateTasksData()
  return { success: true }
}

export async function reopenMaAssigneeAction(
  todoId: string,
  assigneeUsername: string,
  feedback: string,
  newDueDate: string
): Promise<{ success: boolean; error?: string }> {
  void todoId
  void assigneeUsername
  void feedback
  void newDueDate
  return { success: false, error: 'Reopen task is disabled.' }
}

export async function delegateMaAssigneeAction(
  todoId: string,
  toUsername: string,
  instructions?: string,
  dueDate?: string
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
  const parsedDueDate = dueDate ? new Date(dueDate) : null
  const dueDateIso = parsedDueDate && !Number.isNaN(parsedDueDate.getTime()) ? parsedDueDate.toISOString() : undefined
  ma.assignees[myIdx].delegated_to = [
    ...existing_delegates,
    {
      username: toUsername,
      status: 'pending',
      delegation_instructions: instructions || undefined,
      actual_due_date: dueDateIso,
    },
  ]

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} delegated their assignment to ${toUsername}${instructions ? `: "${instructions}"` : ''}${dueDateIso ? ` (due: ${dueDateIso})` : ''}`,
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

  revalidateTasksData()
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

  // Post notes as a comment so it surfaces in the activity/comments feed
  if (newStatus === 'completed' && notes?.trim()) {
    const noteText = notes.trim()
    const commentParticipants = new Set<string>()
    if (task.username) commentParticipants.add(String(task.username))
    ma.assignees.forEach((a) => {
      if (a.username) commentParticipants.add(a.username)
        ; (a.delegated_to || []).forEach((sub) => { if (sub.username) commentParticipants.add(sub.username) })
    })
    const commentUnreadBy = Array.from(commentParticipants).filter(
      (u) => u.toLowerCase() !== user.username.toLowerCase()
    )
    history.push({
      type: 'comment',
      user: user.username,
      details: noteText,
      timestamp: now,
      icon: '💬',
      title: 'Completion Feedback',
      message_id: crypto.randomUUID(),
      unread_by: commentUnreadBy,
      read_by: [user.username],
      mention_users: [],
    })
  }

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

  revalidateTasksData()
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

  revalidateTasksData()
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

  revalidateTasksData()
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

  revalidateTasksData()
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

export async function getSingleTaskLiveUpdateAction(todoId: string): Promise<Todo | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = createServerClient()

  const { data: allDepartments } = await supabase.from('departments').select('name')
  const canonicalToOfficial: Record<string, string> = {}
    ; (allDepartments || []).forEach((d) => {
      const key = canonicalDepartmentKey(d.name)
      if (key && !canonicalToOfficial[key]) canonicalToOfficial[key] = d.name
    })

  const { data: rawTask } = await supabase
    .from('todos')
    .select(TASK_LIST_SELECT)
    .eq('id', todoId)
    .single()

  if (!rawTask) return null

  const usernamesToFetch = new Set<string>()
  const rTask = rawTask as any
  if (rTask.username) usernamesToFetch.add(String(rTask.username))
  if (rTask.assigned_to) usernamesToFetch.add(String(rTask.assigned_to))

  const { data: usersData } = await supabase
    .from('users')
    .select('username, department, avatar_data')
    .in('username', Array.from(usernamesToFetch))

  const userDeptMap: Record<string, string> = {}
  const userAvatarMap: Record<string, string | null> = {}
    ; (usersData || []).forEach((u: any) => {
      if (u.username && u.department) {
        userDeptMap[String(u.username).toLowerCase()] = mapDepartmentCsvToOfficial(String(u.department), canonicalToOfficial)
      }
      if (u.username) {
        userAvatarMap[String(u.username)] = String(u.avatar_data || '').trim() || null
      }
    })

  const { data: shares } = await supabase
    .from('todo_shares')
    .select('id')
    .eq('todo_id', todoId)
    .eq('shared_with', user.username)

  const t = normalizeTodo(rawTask as unknown as Record<string, unknown>, user.username)
  t.history = []
  t.is_shared = (shares && shares.length > 0) ? true : undefined
  t.creator_department = userDeptMap[t.username?.toLowerCase() || ''] || null
  t.assignee_department = userDeptMap[(t.assigned_to || '').toLowerCase()] || null
  t.participant_avatars = Object.fromEntries(
    Object.entries(userAvatarMap).filter(([username]) => {
      const lower = username.toLowerCase()
      return lower === String(t.username || '').toLowerCase() ||
        lower === String(t.assigned_to || '').toLowerCase()
    })
  )

  return t
}

// ── Cross-Cluster Routing ─────────────────────────────────────────────────────

/**
 * Sends a task to another cluster's inbox.
 * - Records the origin cluster, who routed it, and marks cluster_inbox = true
 * - Task becomes visible to all owners/managers/supervisors in the destination cluster
 * - Task is removed from the current assignment and placed in the cluster inbox queue
 */
export async function sendTaskToClusterInboxAction(
  todoId: string,
  destinationClusterId: string,
  dueDate: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  if (!destinationClusterId) return { success: false, error: 'Destination cluster is required.' }
  if (!dueDate) return { success: false, error: 'Due date is required.' }

  const parsedDue = new Date(dueDate)
  if (Number.isNaN(parsedDue.getTime())) {
    return { success: false, error: 'Invalid due date.' }
  }
  if (parsedDue.getTime() <= Date.now()) {
    return { success: false, error: 'Due date must be in the future.' }
  }
  const dueIso = parsedDue.toISOString()

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,completed,approval_status,title,history,assignment_chain,cluster_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const isCreator = (task.username as string) === user.username
  const isCurrentAssignee = (task.assigned_to as string) === user.username
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isCreator && !isCurrentAssignee && !isAdmin) {
    return { success: false, error: 'Only the creator, current assignee, or admin can route this task to another cluster.' }
  }
  if ((task.completed as boolean) === true) {
    return { success: false, error: 'Completed tasks cannot be routed to a cluster.' }
  }
  if ((task.approval_status as string) === 'pending_approval') {
    return { success: false, error: 'Task is awaiting approval and cannot be routed right now.' }
  }

  // Verify destination cluster exists
  const { data: destCluster } = await supabase
    .from('clusters')
    .select('id, name')
    .eq('id', destinationClusterId)
    .single()
  if (!destCluster) return { success: false, error: 'Destination cluster not found.' }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  const originClusterId = (task.cluster_id as string | null) ?? null
  const clusterName = (destCluster as Record<string, string>).name

  // Record in assignment chain
  assignmentChain.push({
    user: user.username,
    role: 'routed_to_cluster_inbox',
    assignedAt: now,
    next_user: clusterName,
    feedback: note?.trim() || undefined,
  })

  history.push({
    type: 'cluster_route',
    user: user.username,
    details: `${user.username} routed task to cluster inbox: ${clusterName}${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
    timestamp: now,
    icon: '🔀',
    title: 'Sent to Cluster Inbox',
  })

  await supabase.from('todos').update({
    cluster_id: destinationClusterId,
    cluster_inbox: true,
    cluster_origin_id: originClusterId,
    cluster_routed_by: user.username,
    assigned_to: null,
    manager_id: null,
    queue_status: 'cluster_inbox',
    task_status: 'backlog',
    workflow_state: 'queued_department',
    scheduler_state: 'hall_inbox',
    requested_due_at: dueIso,
    due_date: dueIso,
    expected_due_date: dueIso,
    actual_due_date: null,
    pending_approver: null,
    approval_chain: JSON.stringify([]),
    approval_requested_at: null,
    approval_sla_due_at: null,
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  // Notify all cluster owners, managers, and supervisors of the destination cluster
  const { data: clusterMembers } = await supabase
    .from('cluster_members')
    .select('username, cluster_role')
    .eq('cluster_id', destinationClusterId)
    .in('cluster_role', ['owner', 'manager', 'supervisor'])

  if (clusterMembers && clusterMembers.length > 0) {
    await notifyUsers(
      supabase,
      (clusterMembers as Array<{ username: string }>).map((m) => m.username),
      {
        type: 'task_cluster_inbox',
        title: `New Task in ${clusterName} Inbox`,
        body: `${user.username} sent "${task.title as string}" to your cluster inbox.`,
        relatedId: todoId,
      },
      user.username,
    )
  }

  revalidateTasksData()
  emitTaskWebhook('task.updated', todoId, user.username, {
    action: 'routed_to_cluster_inbox',
    destination_cluster: clusterName,
  })

  return { success: true }
}

/**
 * Claim a task from the cluster inbox — assigns it to self,
 * removes it from inbox, puts it in regular flow within the cluster.
 */
export async function claimClusterInboxTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,cluster_id,cluster_inbox,task_status,completed,approval_status,title,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if (!(task.cluster_inbox as boolean)) return { success: false, error: 'This task is not in a cluster inbox.' }
  if ((task.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }

  // Check user is a member (owner/manager/supervisor) of the task's cluster
  const { data: membership } = await supabase
    .from('cluster_members')
    .select('cluster_role')
    .eq('cluster_id', task.cluster_id as string)
    .eq('username', user.username)
    .single()

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!membership && !isAdmin) {
    return { success: false, error: 'You are not a member of this cluster.' }
  }
  if (membership && !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role) && !isAdmin) {
    return { success: false, error: 'Only cluster owners, managers, or supervisors can claim cluster inbox tasks.' }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  assignmentChain.push({
    user: user.username,
    role: 'claimed_cluster_inbox',
    assignedAt: now,
    next_user: user.username,
  })

  history.push({
    type: 'claimed',
    user: user.username,
    details: `${user.username} claimed task from cluster inbox`,
    timestamp: now,
    icon: '✋',
    title: 'Claimed from Cluster Inbox',
  })

  await supabase.from('todos').update({
    cluster_inbox: false,
    assigned_to: user.username,
    manager_id: user.username,
    queue_status: 'claimed',
    task_status: 'todo',
    workflow_state: 'claimed_by_department',
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  revalidateTasksData()
  return { success: true }
}

/**
 * Assign a cluster inbox task to a specific team member.
 * Only cluster owners/managers/supervisors can do this.
 */
export async function assignClusterInboxTaskAction(
  todoId: string,
  toUsername: string,
  dueDate?: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!toUsername) return { success: false, error: 'Target user is required.' }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,cluster_id,cluster_inbox,task_status,completed,approval_status,title,history,assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if (!(task.cluster_inbox as boolean)) return { success: false, error: 'This task is not in a cluster inbox.' }
  if ((task.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role')
      .eq('cluster_id', task.cluster_id as string)
      .eq('username', user.username)
      .single()
    const hasExplicitRole = membership && ['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)
    if (!hasExplicitRole) {
      // Dept-based access: Manager/Supervisor whose dept belongs to this hall
      if (!['Manager', 'Supervisor', 'Super Manager'].includes(user.role)) {
        return { success: false, error: 'Only cluster owners, managers, or supervisors can assign cluster inbox tasks.' }
      }
      const userDeptNames = splitDepartmentsCsv(user.department).filter(Boolean)
      if (userDeptNames.length > 0) {
        const { data: matchedDepts } = await supabase.from('departments').select('id').in('name', userDeptNames)
        const deptIds = ((matchedDepts ?? []) as Array<{ id: string }>).map((d) => d.id)
        if (deptIds.length > 0) {
          const { data: hallDept } = await supabase.from('cluster_departments').select('cluster_id')
            .eq('cluster_id', task.cluster_id as string).in('department_id', deptIds).limit(1)
          if (!hallDept || hallDept.length === 0) {
            return { success: false, error: 'Only cluster owners, managers, or supervisors can assign cluster inbox tasks.' }
          }
        } else {
          return { success: false, error: 'Only cluster owners, managers, or supervisors can assign cluster inbox tasks.' }
        }
      } else {
        return { success: false, error: 'Only cluster owners, managers, or supervisors can assign cluster inbox tasks.' }
      }
    }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  assignmentChain.push({
    user: user.username,
    role: 'assigned_from_cluster_inbox',
    assignedAt: now,
    next_user: toUsername,
    feedback: note?.trim() || undefined,
  })

  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} assigned task from cluster inbox to ${toUsername}${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
    timestamp: now,
    icon: '👤',
    title: 'Assigned from Cluster Inbox',
  })

  const dueDateFields: Record<string, string | undefined> = {}
  if (dueDate?.trim()) {
    dueDateFields.due_date = dueDate.trim()
    dueDateFields.expected_due_date = dueDate.trim()
    dueDateFields.actual_due_date = dueDate.trim()
  }

  await supabase.from('todos').update({
    cluster_inbox: false,
    assigned_to: toUsername,
    manager_id: user.username,
    queue_status: 'claimed',
    task_status: 'todo',
    workflow_state: 'claimed_by_department',
    ...dueDateFields,
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  if (toUsername !== user.username) {
    await createNotification(supabase, {
      userId: toUsername,
      type: 'task_assigned',
      title: 'Task Assigned to You',
      body: `${user.username} assigned you a task from the cluster inbox: "${task.title as string}"`,
      relatedId: todoId,
    })
  }

  revalidateTasksData()
  return { success: true }
}

// ── Hall (Cluster) Scoped Data Fetchers ──────────────────────────────────────

/**
 * Returns the current user's primary Hall (cluster) info.
 * Returns null if the user is not a member of any cluster.
 */
export async function getMyHallInfo(): Promise<{
  clusterId: string
  clusterName: string
  clusterRole: string
} | null> {
  const user = await getSession()
  if (!user) return null
  const supabase = createServerClient()
  const { data } = await supabase
    .from('cluster_members')
    .select('cluster_id, cluster_role, clusters(id, name)')
    .eq('username', user.username)
    .limit(1)
    .single()
  if (!data) return null
  const row = data as Record<string, unknown>
  const cluster = row.clusters as Record<string, string> | null
  if (!cluster) return null
  return {
    clusterId: cluster.id,
    clusterName: cluster.name,
    clusterRole: String(row.cluster_role ?? ''),
  }
}

/**
 * Returns all clusters — used in the "Send to Hall" mode for destination picker.
 */
export async function getClustersForHallSend(): Promise<Array<{
  id: string; name: string; color: string; description: string | null
  office_start: string; office_end: string
  break_start: string; break_end: string
  friday_break_start: string; friday_break_end: string
}>> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()

  // Get the IDs of clusters the current user belongs to — exclude those from the list
  const { data: myMemberships } = await supabase
    .from('cluster_members')
    .select('cluster_id')
    .eq('username', user.username)
  const myClusterIds = new Set((myMemberships ?? []).map((m: Record<string, string>) => m.cluster_id))

  const { data } = await supabase
    .from('clusters')
    .select('id, name, color, description, office_start, office_end, break_start, break_end, friday_break_start, friday_break_end')
    .order('name')
  return ((data ?? []) as Array<{
    id: string; name: string; color: string; description: string | null
    office_start: string; office_end: string
    break_start: string; break_end: string
    friday_break_start: string; friday_break_end: string
  }>).filter((c) => !myClusterIds.has(c.id))
}

/**
 * Returns the Hall (cluster) that the current user belongs to based on their department.
 * Returns null if user is not in any hall.
 */
export async function getUserCurrentHall(): Promise<{
  cluster_id: string
  cluster_name: string
  department_queue_enabled: boolean
  department_queue_pick_allowed: boolean
  enforce_single_task: boolean
  user_department: string | null
} | null> {
  const user = await getSession()
  if (!user || !user.department) return null
  
  const supabase = createServerClient()
  const userDepts = splitDepartmentsCsv(user.department).filter(Boolean)
  if (userDepts.length === 0) return null

  // First, find department IDs from user's departments
  const { data: deptRows } = await supabase
    .from('departments')
    .select('id, name')
    .in('name', userDepts)
  
  if (!deptRows || deptRows.length === 0) return null
  
  const deptIds = deptRows.map(d => d.id)
  
  // Find which cluster these departments belong to
  const { data: clusterDepts } = await supabase
    .from('cluster_departments')
    .select('cluster_id')
    .in('department_id', deptIds)
    .limit(1)
  
  if (!clusterDepts || clusterDepts.length === 0) return null
  
  const clusterId = clusterDepts[0].cluster_id as string
  
  // Get cluster settings
  const { data: settings } = await supabase
    .from('cluster_settings')
    .select('department_queue_enabled, department_queue_pick_allowed, enforce_single_task')
    .eq('cluster_id', clusterId)
    .single()
  
  // Get cluster name
  const { data: cluster } = await supabase
    .from('clusters')
    .select('name')
    .eq('id', clusterId)
    .single()
  
  return {
    cluster_id: clusterId,
    cluster_name: (cluster?.name as string) ?? 'Unknown Hall',
    department_queue_enabled: (settings?.department_queue_enabled as boolean) ?? false,
    department_queue_pick_allowed: (settings?.department_queue_pick_allowed as boolean) ?? true,
    enforce_single_task: (settings?.enforce_single_task as boolean) ?? true,
    user_department: userDepts[0] ?? null,
  }
}

/** Fetches the office-hours config for a single cluster (server-side). */
async function getClusterOfficeHours(supabase: ReturnType<typeof createServerClient>, clusterId: string | null | undefined): Promise<HallOfficeHours> {
  if (!clusterId) return DEFAULT_OFFICE_HOURS
  const { data } = await supabase
    .from('clusters')
    .select('office_start, office_end, break_start, break_end, friday_break_start, friday_break_end')
    .eq('id', clusterId)
    .single()
  if (!data) return DEFAULT_OFFICE_HOURS
  return {
    office_start: (data as Record<string, string>).office_start ?? '09:00',
    office_end: (data as Record<string, string>).office_end ?? '18:00',
    break_start: (data as Record<string, string>).break_start ?? '13:00',
    break_end: (data as Record<string, string>).break_end ?? '14:00',
    friday_break_start: (data as Record<string, string>).friday_break_start ?? '12:30',
    friday_break_end: (data as Record<string, string>).friday_break_end ?? '14:30',
  }
}

/**
 * Returns department names that belong to a specific Hall (cluster).
 * Scopes the dept picker in local mode so only Hall-owned departments appear.
 */
export async function getDepartmentsForHall(clusterId: string): Promise<string[]> {
  const user = await getSession()
  if (!user || !clusterId) return []
  const supabase = createServerClient()
  const { data } = await supabase
    .from('cluster_departments')
    .select('departments(name)')
    .eq('cluster_id', clusterId)
  if (!data) return []
  return (data as Array<Record<string, unknown>>)
    .map((row) => {
      const dept = row.departments as Record<string, string> | null
      return dept?.name ?? ''
    })
    .filter(Boolean)
    .sort()
}

/**
 * Returns users whose department belongs to a specific Hall.
 * Scopes the user picker in local mode so only same-Hall users appear.
 */
export async function getUsersForHallAssignment(clusterId: string): Promise<Array<{
  username: string
  role: string
  department: string | null
  avatar_data: string | null
}>> {
  const user = await getSession()
  if (!user || !clusterId) return []
  const supabase = createServerClient()

  const hallDepts = await getDepartmentsForHall(clusterId)
  if (hallDepts.length === 0) return []

  const { data } = await supabase
    .from('users')
    .select('username, role, department, avatar_data')
    .order('username')

  const hallDeptsLower = hallDepts.map((d) => d.toLowerCase())
  const rows = ((data ?? []) as Array<{
    username: string; role: string; department: string | null; avatar_data: string | null
  }>).filter((u) => {
    if (u.username === user.username) return false
    if (!u.department) return false
    return u.department.split(',').some((d) => hallDeptsLower.includes(d.trim().toLowerCase()))
  })

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      avatar_data: await resolveStorageUrl(supabase, row.avatar_data),
    }))
  )
}

/**
 * Route a task from the Hall (cluster) inbox to a specific department queue
 * within the same Hall. Only Hall managers/supervisors/owners may do this.
 */
export async function routeHallInboxToDeptQueueAction(
  todoId: string,
  deptName: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!deptName?.trim()) return { success: false, error: 'Department name is required.' }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,cluster_id,cluster_inbox,task_status,completed,approval_status,title,history,assignment_chain,package_name,due_date')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if (!(task.cluster_inbox as boolean)) return { success: false, error: 'This task is not in a Hall inbox.' }
  if ((task.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }
  if ((task.approval_status as string) === 'pending_approval') {
    return { success: false, error: 'Task is awaiting approval.' }
  }

  const clusterId = task.cluster_id as string | null
  if (!clusterId) return { success: false, error: 'Task has no cluster context.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only Hall managers/supervisors/owners can route Hall inbox tasks.' }
    }
  }

  // Verify the department belongs to this cluster
  const { data: deptRows } = await supabase
    .from('cluster_departments')
    .select('departments(name)')
    .eq('cluster_id', clusterId)
  const hallDeptNames = ((deptRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => (row.departments as Record<string, string> | null)?.name ?? '')
    .filter(Boolean)

  const deptMatch = hallDeptNames.find((d) => d.toLowerCase() === deptName.trim().toLowerCase())
  if (!deptMatch) {
    return { success: false, error: `Department "${deptName}" does not belong to this Hall.` }
  }

  const now = new Date().toISOString()
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  const history = parseJson<HistoryEntry[]>(task.history, [])

  let assignedTo: string | null = null
  let finalQueueStatus = 'queued'
  let multiAssignment: MultiAssignment | null = null

  const autoResult = await resolvePackageAutoAssignment(
    supabase,
    task.package_name as string | null ?? null,
    deptMatch
  )
  if (autoResult.type === 'single') {
    assignedTo = autoResult.username
    finalQueueStatus = 'auto_assigned'
  } else if (autoResult.type === 'multi') {
    multiAssignment = buildAutoMultiAssignment(
      autoResult.usernames,
      task.due_date as string | null ?? null,
      user.username
    )
    finalQueueStatus = 'auto_assigned'
  }

  assignmentChain.push({
    user: user.username,
    role: 'routed_to_department_queue',
    assignedAt: now,
    next_user: deptMatch,
    feedback: note?.trim() || undefined,
  })
  if (assignedTo) {
    assignmentChain.push({ user: user.username, role: 'auto_assigned_by_package', assignedAt: now, next_user: assignedTo })
  }

  history.push({
    type: 'routed',
    user: user.username,
    details: `${user.username} routed task from Hall inbox to ${deptMatch} department queue${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
    timestamp: now,
    icon: '🏢',
    title: 'Routed to Department',
  })

  await supabase.from('todos').update({
    cluster_inbox: false,
    queue_department: deptMatch,
    queue_status: finalQueueStatus,
    assigned_to: assignedTo,
    manager_id: assignedTo ? user.username : null,
    multi_assignment: multiAssignment ? JSON.stringify(multiAssignment) : null,
    task_status: 'backlog',
    workflow_state: assignedTo ? 'claimed_by_department' : multiAssignment ? 'split_to_multi' : 'queued_department',
    category: deptMatch,
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  if (assignedTo && assignedTo !== user.username) {
    await createNotification(supabase, {
      userId: assignedTo,
      type: 'task_assigned',
      title: 'Task Assigned to You',
      body: `${user.username} routed a Hall inbox task to you in ${deptMatch}: "${task.title as string}"`,
      relatedId: todoId,
    })
  } else if (multiAssignment?.assignees) {
    for (const a of multiAssignment.assignees) {
      if (a.username && a.username !== user.username) {
        await createNotification(supabase, {
          userId: a.username,
          type: 'task_assigned',
          title: 'Task Assigned to You',
          body: `${user.username} routed a Hall inbox task to you in ${deptMatch}: "${task.title as string}"`,
          relatedId: todoId,
        })
      }
    }
  }

  revalidateTasksData()
  emitTaskWebhook('task.updated', todoId, user.username, {
    action: 'routed_from_hall_inbox_to_dept',
    department: deptMatch,
  })
  return { success: true }
}

// ── Cluster Settings ──────────────────────────────────────────────────────────

/**
 * Get settings for a specific cluster.
 */
export async function getClusterSettingsAction(clusterId: string): Promise<ClusterSettings | null> {
  const user = await getSession()
  if (!user || !clusterId) return null
  const supabase = createServerClient()
  const { data } = await supabase
    .from('cluster_settings')
    .select('*')
    .eq('cluster_id', clusterId)
    .single()
  if (!data) return null
  const row = data as Record<string, unknown>
  return {
    id: row.id as string,
    cluster_id: row.cluster_id as string,
    allow_dept_users_see_queue: (row.allow_dept_users_see_queue as boolean) ?? false,
    allow_normal_users_see_queue: (row.allow_normal_users_see_queue as boolean) ?? true,
    single_active_task_per_user: (row.single_active_task_per_user as boolean) ?? false,
    auto_start_next_task: (row.auto_start_next_task as boolean) ?? true,
    users_cannot_create_tasks: (row.users_cannot_create_tasks as boolean) ?? false,
    department_queue_enabled: (row.department_queue_enabled as boolean) ?? false,
    department_queue_pick_allowed: (row.department_queue_pick_allowed as boolean) ?? true,
    enforce_single_task: (row.enforce_single_task as boolean) ?? true,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

/**
 * Upsert settings for a cluster.
 * Only Admin, Super Manager, or cluster owner/manager may modify.
 */
export async function saveClusterSettingsAction(
  clusterId: string,
  settings: {
    allow_dept_users_see_queue?: boolean
    allow_normal_users_see_queue?: boolean
    single_active_task_per_user?: boolean
    auto_start_next_task?: boolean
    users_cannot_create_tasks?: boolean
    department_queue_enabled?: boolean
    department_queue_pick_allowed?: boolean
    enforce_single_task?: boolean
  }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const supabase = createServerClient()
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    if (!membership || !['owner', 'manager'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only cluster owners, managers, or admins can modify Hall settings.' }
    }
  }

  const supabase = createServerClient()
  const now = new Date().toISOString()

  const payload: Record<string, unknown> = {
    cluster_id: clusterId,
    updated_at: now,
  }
  if (settings.allow_dept_users_see_queue !== undefined) payload.allow_dept_users_see_queue = settings.allow_dept_users_see_queue
  if (settings.allow_normal_users_see_queue !== undefined) payload.allow_normal_users_see_queue = settings.allow_normal_users_see_queue
  if (settings.single_active_task_per_user !== undefined) payload.single_active_task_per_user = settings.single_active_task_per_user
  if (settings.auto_start_next_task !== undefined) payload.auto_start_next_task = settings.auto_start_next_task
  if (settings.users_cannot_create_tasks !== undefined) payload.users_cannot_create_tasks = settings.users_cannot_create_tasks
  if (settings.department_queue_enabled !== undefined) payload.department_queue_enabled = settings.department_queue_enabled
  if (settings.department_queue_pick_allowed !== undefined) payload.department_queue_pick_allowed = settings.department_queue_pick_allowed
  if (settings.enforce_single_task !== undefined) payload.enforce_single_task = settings.enforce_single_task

  const { error } = await supabase
    .from('cluster_settings')
    .upsert(payload, { onConflict: 'cluster_id' })

  if (error) return { success: false, error: error.message }

  // If single_active_task_per_user was just turned ON, enforce it immediately
  if (settings.single_active_task_per_user === true) {
    await enforceHallSingleActiveTaskAction(clusterId)
  }

  return { success: true }
}

/**
 * Returns whether the current user is allowed to create tasks.
 * Normal users (non-manager/supervisor/admin) are blocked when ALL clusters
 * they belong to have `users_cannot_create_tasks = true`.
 * If the user has no cluster memberships or is a privileged role, returns true.
 */
export async function canUserCreateTasksAction(): Promise<boolean> {
  const user = await getSession()
  if (!user) return false

  const normalRoles = ['user', 'employee', 'staff']
  const isNormalUser = normalRoles.includes((user.role ?? '').toLowerCase())
  if (!isNormalUser) return true

  return unstable_cache(
    async () => {
      const supabase = createServerClient()

      // Get all cluster IDs this user belongs to
      const { data: memberships } = await supabase
        .from('cluster_members')
        .select('cluster_id')
        .eq('username', user.username)

      if (!memberships || memberships.length === 0) return true

      const clusterIds = (memberships as { cluster_id: string }[]).map((m) => m.cluster_id)

      // Check settings for all those clusters
      const { data: settings } = await supabase
        .from('cluster_settings')
        .select('cluster_id, users_cannot_create_tasks')
        .in('cluster_id', clusterIds)

      if (!settings || settings.length === 0) return true

      // If every cluster the user belongs to restricts creation → block
      const allRestricted = clusterIds.every((cid) => {
        const row = (settings as { cluster_id: string; users_cannot_create_tasks: boolean }[]).find((s) => s.cluster_id === cid)
        return row?.users_cannot_create_tasks === true
      })

      return !allRestricted
    },
    ['can-create-tasks', user.username],
    { revalidate: 300, tags: ['session-data'] }
  )()
}

// ── Hall Scheduler Actions ────────────────────────────────────────────────────
//
// These actions extend the existing cross-hall routing with work-time tracking,
// queue ordering, and auto-start logic.  They operate on tasks that have
// already reached a hall inbox (cluster_inbox = true) and are being further
// managed by hall leaders.
//
// Conventions:
//   - All state transitions are atomic (single .update() call where possible).
//   - Every meaningful transition appends to both `history` and `hall_task_work_logs`.
//   - Server-side permission checks for every exported function.
// ─────────────────────────────────────────────────────────────────────────────

/** Private: write a single hall work-log entry. */
async function writeHallWorkLog(
  supabase: ReturnType<typeof createServerClient>,
  params: {
    todoId: string
    username: string
    event: string
    minutesDeducted?: number
    notes?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await supabase.from('hall_task_work_logs').insert({
      todo_id: params.todoId,
      username: params.username,
      event: params.event,
      minutes_deducted: params.minutesDeducted ?? 0,
      notes: params.notes ?? null,
      metadata: params.metadata ?? null,
    })
  } catch {
    // Work-log failures must never block the main transition
  }
}

/** Private: get the hall settings for the cluster a task belongs to. */
async function getHallSettingsForTask(
  supabase: ReturnType<typeof createServerClient>,
  clusterId: string
): Promise<{
  single_active_task_per_user: boolean
  auto_start_next_task: boolean
}> {
  const { data } = await supabase
    .from('cluster_settings')
    .select('single_active_task_per_user, auto_start_next_task')
    .eq('cluster_id', clusterId)
    .single()
  const row = (data ?? {}) as Record<string, unknown>
  return {
    single_active_task_per_user: (row.single_active_task_per_user as boolean) ?? false,
    auto_start_next_task: (row.auto_start_next_task as boolean) ?? true,
  }
}

/**
 * Private: Find and activate the next highest-priority queued or paused task
 * for a user within a cluster.  Excludes `excludeId` so a task just-paused
 * doesn't immediately re-activate itself.
 * Returns the id of the activated task, or null if nothing to activate.
 */
async function autoActivateNextTask(
  supabase: ReturnType<typeof createServerClient>,
  assignedTo: string,
  clusterId: string,
  excludeId: string | null,
  hallHours: HallOfficeHours,
): Promise<string | null> {
  // Never auto-activate if user already has an active task in this cluster
  const { data: existingActive } = await supabase
    .from('todos')
    .select('id')
    .eq('assigned_to', assignedTo)
    .eq('cluster_id', clusterId)
    .eq('completed', false)
    .eq('scheduler_state', 'active')
    .limit(1)
  if (existingActive && existingActive.length > 0) return null

  // Also check if user has an active MA task in this cluster
  const { data: allClusterMa } = await supabase
    .from('todos')
    .select('id, multi_assignment')
    .eq('cluster_id', clusterId)
    .eq('completed', false)
    .eq('workflow_state', 'split_to_multi')
  const uLower = assignedTo.toLowerCase()
  const hasActiveMa = ((allClusterMa ?? []) as Array<{ id: string; multi_assignment: unknown }>)
    .some((t) => {
      const maTmp = parseJson<MultiAssignment | null>(t.multi_assignment, null)
      return maTmp?.assignees?.some(
        (a) => a.username.toLowerCase() === uLower && a.hall_scheduler_state === 'active'
      )
    })
  if (hasActiveMa) return null

  // Candidates: user_queue or paused, ordered by queue_rank ASC
  let query = supabase
    .from('todos')
    .select('id, queue_rank, remaining_work_minutes, scheduler_state')
    .eq('assigned_to', assignedTo)
    .eq('cluster_id', clusterId)
    .in('scheduler_state', ['user_queue', 'paused'])
    .order('queue_rank', { ascending: true })
    .limit(1)

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data: candidates } = await query

  // Also collect MA task candidates (user_queue state per-user JSONB)
  const maCandidates = ((allClusterMa ?? []) as Array<{ id: string; multi_assignment: unknown }>)
    .flatMap((t) => {
      const maTmp = parseJson<MultiAssignment | null>(t.multi_assignment, null)
      if (!maTmp?.assignees) return []
      return maTmp.assignees
        .filter((a) => a.username.toLowerCase() === uLower &&
          (a.hall_scheduler_state === 'user_queue' || a.hall_scheduler_state === 'paused') &&
          (excludeId ? t.id !== excludeId : true))
        .map((a) => ({ id: t.id, queue_rank: a.hall_queue_rank ?? 9999, type: 'ma' as const, ma: maTmp, entry: a }))
    })
    .sort((x, y) => x.queue_rank - y.queue_rank)

  const now = new Date().toISOString()

  // Determine which comes first: regular task or MA task
  const regularNext = candidates && candidates.length > 0
    ? (candidates[0] as Record<string, unknown>)
    : null
  const maNext = maCandidates.length > 0 ? maCandidates[0] : null

  const regularRank = (regularNext?.queue_rank as number | null) ?? Infinity
  const maRank = maNext?.queue_rank ?? Infinity

  if (regularRank <= maRank && regularNext) {
    const nextId = regularNext.id as string
    const storedRemaining = (regularNext.remaining_work_minutes as number | null) ?? null
    const effectiveDueAt = storedRemaining != null && storedRemaining > 0
      ? calculateEffectiveDueAt(now, storedRemaining, hallHours).toISOString()
      : null
    const wasResumed = (regularNext.scheduler_state as string) === 'paused'
    await supabase.from('todos').update({
      scheduler_state: 'active',
      active_started_at: now,
      task_status: 'in_progress',
      effective_due_at: effectiveDueAt ?? undefined,
      updated_at: now,
    }).eq('id', nextId)
    await writeHallWorkLog(supabase, {
      todoId: nextId,
      username: assignedTo,
      event: wasResumed ? 'resumed' : 'started',
      notes: 'Auto-activated by scheduler',
    })
    return nextId
  }

  if (maNext) {
    // Auto-activate the MA task entry for this user
    const { data: maRow } = await supabase
      .from('todos').select('multi_assignment, history, title').eq('id', maNext.id).single()
    if (maRow) {
      const maCurrent = parseJson<MultiAssignment | null>((maRow as Record<string, unknown>).multi_assignment, null)
      if (maCurrent?.assignees) {
        const idx = maCurrent.assignees.findIndex((a) => a.username.toLowerCase() === uLower)
        if (idx !== -1) {
          const wasResumed = maCurrent.assignees[idx].hall_scheduler_state === 'paused'
          const storedRemaining = maCurrent.assignees[idx].hall_remaining_minutes ?? null
          const effectiveDueAt = storedRemaining != null && storedRemaining > 0
            ? calculateEffectiveDueAt(now, storedRemaining, hallHours).toISOString()
            : null
          maCurrent.assignees[idx] = {
            ...maCurrent.assignees[idx],
            hall_scheduler_state: 'active',
            hall_active_started_at: now,
            hall_effective_due_at: effectiveDueAt,
            status: 'in_progress',
          }
          await supabase.from('todos').update({
            multi_assignment: JSON.stringify(maCurrent),
            updated_at: now,
          }).eq('id', maNext.id)
          await writeHallWorkLog(supabase, {
            todoId: maNext.id,
            username: assignedTo,
            event: wasResumed ? 'resumed' : 'started',
            notes: 'MA task auto-activated by scheduler',
          })
          return maNext.id
        }
      }
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assign a hall inbox task to a specific team member with a work estimate.
 * This replaces the simpler assignClusterInboxTaskAction for scheduler-enabled halls.
 *
 * Supervisor scope: supervisors can only assign to users in their scoped departments.
 * Manager: can assign to any hall member.
 *
 * If single_active_task_per_user is ON and the user has no active task:
 *   → task goes directly to 'active', active_started_at = now
 * Otherwise:
 *   → task goes to 'user_queue', ranked after existing queued tasks
 */
export async function assignHallInboxTaskWithSchedulerAction(
  todoId: string,
  toUsername: string,
  priority: string,
  estimatedHours: number,
  note?: string,
  insertAtRank?: number
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!toUsername) return { success: false, error: 'Assignee is required.' }
  if (!estimatedHours || estimatedHours <= 0) return { success: false, error: 'Estimated hours must be greater than 0.' }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('todos')
    .select('username,cluster_id,cluster_inbox,task_status,completed,approval_status,title,history,assignment_chain,scheduler_state,assigned_to,workflow_state,multi_assignment,estimated_work_minutes,remaining_work_minutes,queue_rank,active_started_at,effective_due_at')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  // Allow inbox tasks AND active/in-progress hall tasks (manager reassignment flow)
  if ((task.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }

  const clusterId = task.cluster_id as string | null
  if (!clusterId) return { success: false, error: 'Task has no cluster context.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  let callerRole = ''

  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role, scoped_departments')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    const hasExplicitRole = membership && ['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)
    if (!hasExplicitRole) {
      // Dept-based access: Manager/Supervisor whose dept belongs to this hall
      if (!['Manager', 'Supervisor', 'Super Manager'].includes(user.role)) {
        return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
      }
      const userDeptNames = splitDepartmentsCsv(user.department).filter(Boolean)
      if (userDeptNames.length > 0) {
        const { data: matchedDepts } = await supabase.from('departments').select('id').in('name', userDeptNames)
        const deptIds = ((matchedDepts ?? []) as Array<{ id: string }>).map((d) => d.id)
        if (deptIds.length > 0) {
          const { data: hallDept } = await supabase.from('cluster_departments').select('cluster_id')
            .eq('cluster_id', clusterId).in('department_id', deptIds).limit(1)
          if (!hallDept || hallDept.length === 0) {
            return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
          }
        } else {
          return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
        }
      } else {
        return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
      }
      callerRole = 'supervisor'
    } else {
      callerRole = (membership as Record<string, string>).cluster_role
    }
    // Supervisors (by session role) can only assign to members within their own department
    if (user.role === 'Supervisor') {
      const supervisorDepts = splitDepartmentsCsv(user.department ?? '').map((d) => d.toLowerCase()).filter(Boolean)
      if (supervisorDepts.length > 0) {
        const { data: targetUserRow } = await supabase
          .from('users').select('department').eq('username', toUsername).maybeSingle()
        const targetDept = ((targetUserRow as Record<string, unknown> | null)?.department as string ?? '').toLowerCase()
        const inScope = supervisorDepts.some((d) => targetDept.includes(d) || d.includes(targetDept))
        if (!inScope) {
          return { success: false, error: 'As a supervisor, you can only assign tasks to members of your own department.' }
        }
      }
    }
  }

  const estimatedWorkMinutes = Math.round(estimatedHours * 60)
  const settings = await getHallSettingsForTask(supabase, clusterId)
  const hallHours = await getClusterOfficeHours(supabase, clusterId)
  const now = new Date().toISOString()

  // ── Append-to-existing logic ──────────────────────────────────────────────
  // If the task already has an assigned user or multi-assignment, add the new
  // user to the MA structure instead of overwriting.  This keeps existing
  // assignees fully intact – their scheduler state, progress, and visibility
  // are preserved.
  const existingMa = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const existingAssignedTo = task.assigned_to as string | null
  const isAlreadyAssigned = existingMa?.enabled || (existingAssignedTo && existingAssignedTo.trim() !== '')

  if (isAlreadyAssigned) {
    // Determine scheduler state for the new user in this hall
    const { data: newUserTasks } = await supabase
      .from('todos')
      .select('id, scheduler_state, queue_rank')
      .eq('assigned_to', toUsername)
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
    const newUserRows = (newUserTasks ?? []) as Array<{ id: string; scheduler_state: string; queue_rank: number | null }>
    const newUserHasActive = newUserRows.some((r) => r.scheduler_state === 'active')
    const newUserMaxRank = newUserRows.reduce((mx, r) => Math.max(mx, r.queue_rank ?? 0), 0)
    // Also check if new user already has an active MA task in this hall
    const existingAllMa = (await supabase
      .from('todos')
      .select('multi_assignment')
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('workflow_state', 'split_to_multi')).data ?? []
    const newUserHasActiveMa = (existingAllMa as Array<{ multi_assignment: unknown }>).some((t) => {
      const maTmp = parseJson<MultiAssignment | null>(t.multi_assignment, null)
      return maTmp?.assignees?.some(
        (ae) => ae.username.toLowerCase() === toUsername.toLowerCase() && ae.hall_scheduler_state === 'active'
      )
    })
    const newSchedulerState = (newUserHasActive || newUserHasActiveMa) ? 'user_queue' : 'active'

    const newMaEntry: MultiAssignmentEntry = {
      username: toUsername,
      status: 'pending',
      assigned_at: now,
      hall_estimated_hours: estimatedHours,
      hall_scheduler_state: newSchedulerState,
      hall_queue_rank: newUserMaxRank + 1,
      hall_remaining_minutes: estimatedWorkMinutes,
      hall_active_started_at: newSchedulerState === 'active' ? now : null,
      hall_effective_due_at: null,
    }

    let nextMa: MultiAssignment
    if (existingMa?.enabled) {
      // Already multi-assigned — check for duplicate
      if (existingMa.assignees.some((a) => a.username.toLowerCase() === toUsername.toLowerCase())) {
        return { success: false, error: `${toUsername} is already assigned to this task.` }
      }
      // Add new entry to existing MA
      nextMa = {
        ...existingMa,
        assignees: [...existingMa.assignees, newMaEntry],
      }
    } else {
      // Single-assign → convert to multi-assignment, preserving the existing assignee
      const prevAssigned = existingAssignedTo!.trim()
      const prevEstMinutes = (task.estimated_work_minutes as number | null) ?? 0
      const prevRemaining = (task.remaining_work_minutes as number | null) ?? prevEstMinutes
      const prevSchedulerState = (task.scheduler_state as string | null) ?? 'active'
      const prevQueueRank = (task.queue_rank as number | null) ?? 1
      const prevActiveStartedAt = (task.active_started_at as string | null) ?? null
      const prevEffectiveDue = (task.effective_due_at as string | null) ?? null

      const existingEntry: MultiAssignmentEntry = {
        username: prevAssigned,
        status: 'in_progress',
        assigned_at: now,
        hall_estimated_hours: prevEstMinutes / 60,
        hall_scheduler_state: prevSchedulerState,
        hall_queue_rank: prevQueueRank,
        hall_remaining_minutes: prevRemaining,
        hall_active_started_at: prevActiveStartedAt ?? undefined,
        hall_effective_due_at: prevEffectiveDue ?? undefined,
      }

      nextMa = {
        enabled: true,
        created_by: user.username,
        assignees: [existingEntry, newMaEntry],
        completion_percentage: 0,
        all_completed: false,
      }
    }

    touchMultiAssignmentProgress(nextMa)

    const history = parseJson<HistoryEntry[]>(task.history, [])
    const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
    assignmentChain.push({
      user: user.username,
      role: 'assigned_from_hall_inbox',
      assignedAt: now,
      next_user: toUsername,
      feedback: note?.trim() || undefined,
    })
    history.push({
      type: 'assigned',
      user: user.username,
      details: `${user.username} added ${toUsername} to task (${estimatedHours}h estimate)${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
      timestamp: now,
      icon: '👤',
      title: 'Assignee Added',
    })

    await supabase.from('todos').update({
      cluster_inbox: false,
      assigned_to: null,
      manager_id: user.username,
      queue_status: 'claimed',
      task_status: 'in_progress',
      workflow_state: 'split_to_multi',
      scheduler_state: null,
      estimated_work_minutes: null,
      remaining_work_minutes: null,
      queue_rank: null,
      active_started_at: null,
      effective_due_at: null,
      multi_assignment: JSON.stringify(nextMa),
      assignment_chain: JSON.stringify(assignmentChain),
      history: JSON.stringify(history),
      last_handoff_at: now,
      updated_at: now,
    }).eq('id', todoId)

    await writeHallWorkLog(supabase, {
      todoId,
      username: user.username,
      event: 'assigned',
      notes: `Added ${toUsername} to existing assignment, estimate ${estimatedHours}h, state ${newSchedulerState}`,
    })

    if (toUsername !== user.username) {
      await createNotification(supabase, {
        userId: toUsername,
        type: 'task_assigned',
        title: 'Hall Task Assigned to You',
        body: `${user.username} assigned you to a hall task: "${task.title as string}" (${estimatedHours}h estimate)`,
        relatedId: todoId,
      })
    }

    revalidateTasksData()
    return { success: true }
  }
  // ── End append-to-existing ────────────────────────────────────────────────

  // Find next queue_rank for this user in this cluster
  const { data: existingTasks } = await supabase
    .from('todos')
    .select('queue_rank, scheduler_state')
    .eq('assigned_to', toUsername)
    .eq('cluster_id', clusterId)
    .eq('completed', false)
    .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
  const existingRows = (existingTasks ?? []) as Array<{ queue_rank: number | null; scheduler_state: string }>
  const maxRank = existingRows.reduce((max, r) => Math.max(max, r.queue_rank ?? 0), 0)

  const hasActiveTask = existingRows.some((r) => r.scheduler_state === 'active')
  let newQueueRank = maxRank + 1

  // If caller requested a specific queue position, shift existing queued tasks to make room
  if (
    insertAtRank &&
    Number.isInteger(insertAtRank) &&
    insertAtRank >= 1 &&
    insertAtRank <= newQueueRank &&
    hasActiveTask // only meaningful to re-position when tasks are already queued
  ) {
    const { data: toShift } = await supabase
      .from('todos')
      .select('id,queue_rank')
      .eq('assigned_to', toUsername)
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .gte('queue_rank', insertAtRank)
      .in('scheduler_state', ['user_queue', 'paused', 'blocked'])
    for (const st of ((toShift ?? []) as Array<{ id: string; queue_rank: number | null }>)) {
      await supabase.from('todos').update({ queue_rank: (st.queue_rank ?? 0) + 1 }).eq('id', st.id)
    }
    newQueueRank = insertAtRank
  }

  // Determine initial scheduler state
  let initialState: HallSchedulerState = 'user_queue'
  let activeStartedAt: string | null = null
  let effectiveDueAt: string | null = null

  if (settings.single_active_task_per_user && !hasActiveTask) {
    // No active task → go directly to active
    initialState = 'active'
    activeStartedAt = now
    effectiveDueAt = calculateEffectiveDueAt(now, estimatedWorkMinutes, hallHours).toISOString()
  } else if (!settings.single_active_task_per_user) {
    // Setting OFF → all tasks go active immediately
    initialState = 'active'
    activeStartedAt = now
    effectiveDueAt = calculateEffectiveDueAt(now, estimatedWorkMinutes, hallHours).toISOString()
  }
  // else: setting ON and user has active task → user_queue

  const history = parseJson<HistoryEntry[]>(task.history, [])
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  assignmentChain.push({
    user: user.username,
    role: 'assigned_from_hall_inbox',
    assignedAt: now,
    next_user: toUsername,
    feedback: note?.trim() || undefined,
  })

  history.push({
    type: 'assigned',
    user: user.username,
    details: `${user.username} assigned hall task to ${toUsername} with ${estimatedHours}h estimate${note?.trim() ? `. Note: ${note.trim()}` : ''}`,
    timestamp: now,
    icon: '👤',
    title: 'Assigned from Hall Inbox',
  })

  const updatePayload: Record<string, unknown> = {
    cluster_inbox: false,
    assigned_to: toUsername,
    manager_id: user.username,
    queue_status: 'claimed',
    task_status: initialState === 'active' ? 'in_progress' : 'todo',
    workflow_state: 'claimed_by_department',
    scheduler_state: initialState,
    priority: priority,
    estimated_work_minutes: estimatedWorkMinutes,
    remaining_work_minutes: estimatedWorkMinutes,
    queue_rank: newQueueRank,
    active_started_at: activeStartedAt,
    effective_due_at: effectiveDueAt,
    assignment_chain: JSON.stringify(assignmentChain),
    history: JSON.stringify(history),
    last_handoff_at: now,
    updated_at: now,
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: 'assigned',
    notes: `Assigned to ${toUsername}, estimate ${estimatedHours}h, state ${initialState}`,
  })

  if (toUsername !== user.username) {
    await createNotification(supabase, {
      userId: toUsername,
      type: 'task_assigned',
      title: 'Hall Task Assigned to You',
      body: `${user.username} assigned you a task from the hall inbox: "${task.title as string}" (${estimatedHours}h estimate)`,
      relatedId: todoId,
    })
  }

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Multi-user hall task assignment ─────────────────────────────────────────

export interface HallMultiAssignEntry {
  username: string
  estimatedHours: number
  queuePosition?: number  // 1-based position in the user's queue; undefined = append to end
  assignmentNote?: string  // optional clarification note visible to the assignee
}

/**
 * Assign one hall inbox task to multiple users simultaneously.
 * - The first entry updates the original task (same as single-assign).
 * - Each subsequent entry creates a COPY of the original task assigned to that user.
 * - Each user gets their own scheduler state and queue_rank.
 */
export async function assignHallInboxTaskMultiAction(
  todoId: string,
  assignments: HallMultiAssignEntry[]
): Promise<{ success: boolean; error?: string; assignedCount?: number }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { success: false, error: 'At least one assignment is required.' }
  }

  // Validate that all usernames present and hours > 0
  for (const a of assignments) {
    if (!a.username?.trim()) return { success: false, error: 'Each assignment must have a username.' }
    if (!a.estimatedHours || a.estimatedHours <= 0) return { success: false, error: `Estimated hours must be > 0 for ${a.username}.` }
  }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('todos')
    .select('username,cluster_id,cluster_inbox,task_status,completed,approval_status,title,description,our_goal,category,kpi_type,priority,notes,package_name,app_name,history,assignment_chain,cluster_origin_id,cluster_routed_by,requested_due_at,multi_assignment,assigned_to,workflow_state,estimated_work_minutes,remaining_work_minutes,queue_rank,active_started_at,effective_due_at,scheduler_state')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }

  const clusterId = task.cluster_id as string | null
  if (!clusterId) return { success: false, error: 'Task has no cluster context.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  let callerRole = ''

  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .maybeSingle()
    const hasExplicitRole = membership && ['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)
    if (!hasExplicitRole) {
      if (!['Manager', 'Supervisor', 'Super Manager'].includes(user.role)) {
        return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
      }
      const userDeptNames = splitDepartmentsCsv(user.department).filter(Boolean)
      if (userDeptNames.length > 0) {
        const { data: matchedDepts } = await supabase.from('departments').select('id').in('name', userDeptNames)
        const deptIds = ((matchedDepts ?? []) as Array<{ id: string }>).map((d) => d.id)
        if (deptIds.length > 0) {
          const { data: hallDept } = await supabase.from('cluster_departments').select('cluster_id')
            .eq('cluster_id', clusterId).in('department_id', deptIds).limit(1)
          if (!hallDept || hallDept.length === 0) {
            return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
          }
        } else {
          return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
        }
      } else {
        return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
      }
      callerRole = 'supervisor'
    } else {
      callerRole = (membership as Record<string, string>).cluster_role
    }

    // Supervisors: restrict to own department users only
    if (user.role === 'Supervisor') {
      const supervisorDepts = splitDepartmentsCsv(user.department ?? '').map((d) => d.toLowerCase()).filter(Boolean)
      if (supervisorDepts.length > 0) {
        const targetUsernames = assignments.map((a) => a.username)
        const { data: targetUsers } = await supabase.from('users').select('username,department').in('username', targetUsernames)
        for (const au of assignments) {
          const targetRow = ((targetUsers ?? []) as Array<{ username: string; department: string | null }>).find(
            (r) => r.username.toLowerCase() === au.username.toLowerCase()
          )
          const targetDept = ((targetRow?.department ?? '')).toLowerCase()
          const inScope = supervisorDepts.some((d) => targetDept.includes(d) || d.includes(targetDept))
          if (!inScope) {
            return { success: false, error: `As a supervisor, you can only assign tasks to members of your own department. ${au.username} is out of scope.` }
          }
        }
      }
    }
  }

  void callerRole

  const now = new Date().toISOString()
  const baseHistory = parseJson<HistoryEntry[]>(task.history, [])
  const baseChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])

  // ── Append-to-existing multi-assignment logic ─────────────────────────────
  // If the task already has assignees (single or multi), merge new assignees in
  // instead of replacing.  This preserves every existing assignee's progress.
  const existingMa = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const existingAssignedTo = task.assigned_to as string | null
  const isAlreadyAssigned = existingMa?.enabled || (existingAssignedTo && existingAssignedTo.trim() !== '')

  if (isAlreadyAssigned) {
    // Build scheduler entries for each new assignee
    const newMaEntries: MultiAssignmentEntry[] = []
    for (const a of assignments) {
      const uname = a.username.trim()
      // Skip if this user is already in the existing MA
      if (existingMa?.enabled && existingMa.assignees.some((ea) => ea.username.toLowerCase() === uname.toLowerCase())) continue

      const { data: userTasks } = await supabase
        .from('todos')
        .select('id, scheduler_state, queue_rank')
        .eq('assigned_to', uname)
        .eq('cluster_id', clusterId)
        .eq('completed', false)
        .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
      const rows = (userTasks ?? []) as Array<{ id: string; scheduler_state: string; queue_rank: number | null }>
      const hasActive = rows.some((t) => t.scheduler_state === 'active')
      const maxRank = rows.reduce((mx, t) => Math.max(mx, t.queue_rank ?? 0), 0)
      const existingAllMaTasks = (await supabase
        .from('todos')
        .select('multi_assignment')
        .eq('cluster_id', clusterId)
        .eq('completed', false)
        .eq('workflow_state', 'split_to_multi')).data ?? []
      const hasActiveMa = (existingAllMaTasks as Array<{ multi_assignment: unknown }>).some((t) => {
        const maTmp = parseJson<MultiAssignment | null>(t.multi_assignment, null)
        return maTmp?.assignees?.some(
          (ae) => ae.username.toLowerCase() === uname.toLowerCase() && ae.hall_scheduler_state === 'active'
        )
      })
      const schedState = (hasActive || hasActiveMa) ? 'user_queue' : 'active'
      newMaEntries.push({
        username: uname,
        status: 'pending',
        assigned_at: now,
        hall_estimated_hours: a.estimatedHours,
        hall_scheduler_state: schedState,
        hall_queue_rank: maxRank + 1,
        hall_remaining_minutes: a.estimatedHours ? Math.round(a.estimatedHours * 60) : null,
        hall_active_started_at: schedState === 'active' ? now : null,
        hall_effective_due_at: null,
      })
    }

    if (newMaEntries.length === 0) {
      return { success: false, error: 'All specified users are already assigned to this task.' }
    }

    let nextMa: MultiAssignment
    if (existingMa?.enabled) {
      nextMa = { ...existingMa, assignees: [...existingMa.assignees, ...newMaEntries] }
    } else {
      // Convert single-assign to MA, preserving existing assignee
      const prevAssigned = existingAssignedTo!.trim()
      const prevEstMinutes = (task.estimated_work_minutes as number | null) ?? 0
      const prevRemaining = (task.remaining_work_minutes as number | null) ?? prevEstMinutes
      const prevSchedulerState = (task.scheduler_state as string | null) ?? 'active'
      const prevQueueRank = (task.queue_rank as number | null) ?? 1
      const prevActiveStartedAt = (task.active_started_at as string | null) ?? null
      const prevEffectiveDue = (task.effective_due_at as string | null) ?? null

      const existingEntry: MultiAssignmentEntry = {
        username: prevAssigned,
        status: 'in_progress',
        assigned_at: now,
        hall_estimated_hours: prevEstMinutes / 60,
        hall_scheduler_state: prevSchedulerState,
        hall_queue_rank: prevQueueRank,
        hall_remaining_minutes: prevRemaining,
        hall_active_started_at: prevActiveStartedAt ?? undefined,
        hall_effective_due_at: prevEffectiveDue ?? undefined,
      }
      nextMa = {
        enabled: true,
        created_by: user.username,
        assignees: [existingEntry, ...newMaEntries],
        completion_percentage: 0,
        all_completed: false,
      }
    }
    touchMultiAssignmentProgress(nextMa)

    const entryChain: AssignmentChainEntry[] = [
      ...baseChain,
      ...newMaEntries.map((e) => ({
        user: user.username,
        role: 'assigned_from_hall_inbox',
        assignedAt: now,
        next_user: e.username,
        feedback: assignments.find((a) => a.username.trim() === e.username)?.assignmentNote?.trim() || undefined,
      } as AssignmentChainEntry)),
    ]
    const addedNames = newMaEntries.map((e) => e.username).join(', ')
    const entryHistory: HistoryEntry[] = [
      ...baseHistory,
      {
        type: 'assigned',
        user: user.username,
        details: `${user.username} added ${newMaEntries.length} user(s) to task: ${addedNames}`,
        timestamp: now,
        icon: '👥',
        title: 'Assignees Added',
      } as HistoryEntry,
    ]

    await supabase.from('todos').update({
      cluster_inbox: false,
      assigned_to: null,
      manager_id: user.username,
      queue_status: 'claimed',
      task_status: 'in_progress',
      workflow_state: 'split_to_multi',
      scheduler_state: null,
      estimated_work_minutes: null,
      remaining_work_minutes: null,
      queue_rank: null,
      active_started_at: null,
      effective_due_at: null,
      multi_assignment: JSON.stringify(nextMa),
      assignment_chain: JSON.stringify(entryChain),
      history: JSON.stringify(entryHistory),
      last_handoff_at: now,
      updated_at: now,
    }).eq('id', todoId)

    await writeHallWorkLog(supabase, {
      todoId,
      username: user.username,
      event: 'assigned',
      notes: `Added assignees to existing task: ${addedNames}`,
    })

    await notifyUsers(
      supabase,
      newMaEntries.map((e) => e.username),
      {
        type: 'task_assigned',
        title: 'Hall Task Assigned to You',
        body: `${user.username} assigned you to a hall task: "${task.title as string}"`,
        relatedId: todoId,
      },
      user.username,
    )

    revalidateTasksData()
    return { success: true, assignedCount: newMaEntries.length }
  }
  // ── End append-to-existing ────────────────────────────────────────────────

  // Determine per-assignee hall scheduler state:
  // Each assignee gets their own queue_rank (appended after their existing tasks) and
  // scheduler_state ('active' if they have no active task, otherwise 'user_queue').
  // clusterId already declared above; reuse it here.
  const perAssigneeScheduler: Array<{
    username: string
    hall_scheduler_state: string
    hall_queue_rank: number
    hall_remaining_minutes: number | null
  }> = []

  if (clusterId) {
    for (const a of assignments) {
      const uname = a.username.trim()
      // Count of tasks already queued for this user in this hall
      const { data: existingTasks } = await supabase
        .from('todos')
        .select('id, scheduler_state, queue_rank')
        .eq('cluster_id', clusterId)
        .eq('assigned_to', uname)
        .eq('completed', false)
        .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
      const userTasks = (existingTasks ?? []) as Array<{ id: string; scheduler_state: string; queue_rank: number | null }>
      const hasActive = userTasks.some((t) => t.scheduler_state === 'active')
      const maxRank = userTasks.reduce((mx, t) => Math.max(mx, t.queue_rank ?? 0), 0)
      // Also check if this user already has an active MA task in this hall
      const existingAllMa = (await supabase
        .from('todos')
        .select('multi_assignment')
        .eq('cluster_id', clusterId)
        .eq('completed', false)
        .eq('workflow_state', 'split_to_multi')).data ?? []
      const hasActiveMa = (existingAllMa as Array<{ multi_assignment: unknown }>).some((t) => {
        const maTmp = parseJson<MultiAssignment | null>(t.multi_assignment, null)
        return maTmp?.assignees?.some(
          (ae) => ae.username.toLowerCase() === uname.toLowerCase() && ae.hall_scheduler_state === 'active'
        )
      })
      perAssigneeScheduler.push({
        username: uname,
        hall_scheduler_state: (hasActive || hasActiveMa) ? 'user_queue' : 'active',
        hall_queue_rank: maxRank + 1,
        hall_remaining_minutes: a.estimatedHours ? Math.round(a.estimatedHours * 60) : null,
      })
    }
  }

  // Build multi_assignment JSON — all assignees tracked inside a single task (no copies)
  const maAssignees: MultiAssignmentEntry[] = assignments.map((a) => {
    const sched = perAssigneeScheduler.find((p) => p.username === a.username.trim())
    return {
      username: a.username.trim(),
      status: 'pending' as const,
      assigned_at: now,
      hall_estimated_hours: a.estimatedHours,
      hall_scheduler_state: sched?.hall_scheduler_state ?? 'user_queue',
      hall_queue_rank: sched?.hall_queue_rank ?? 1,
      hall_remaining_minutes: sched?.hall_remaining_minutes ?? null,
      hall_active_started_at: sched?.hall_scheduler_state === 'active' ? now : null,
      hall_effective_due_at: null,
    }
  })

  const hallMa: MultiAssignment = {
    enabled: true,
    created_by: user.username,
    assignees: maAssignees,
    completion_percentage: 0,
    all_completed: false,
  }
  touchMultiAssignmentProgress(hallMa)

  // Chain entries and history for all assignees
  const entryChain: AssignmentChainEntry[] = [
    ...baseChain,
    ...assignments.map((a) => ({
      user: user.username,
      role: 'assigned_from_hall_inbox',
      assignedAt: now,
      next_user: a.username.trim(),
      feedback: a.assignmentNote?.trim() || undefined,
    } as AssignmentChainEntry)),
  ]

  const assigneeNames = assignments.map((a) => a.username.trim()).join(', ')
  const entryHistory: HistoryEntry[] = [
    ...baseHistory,
    {
      type: 'assigned',
      user: user.username,
      details: `${user.username} assigned hall task to ${assignments.length} user(s) (multi-assign): ${assigneeNames}`,
      timestamp: now,
      icon: '👥',
      title: 'Assigned from Hall Inbox (Multi)',
    } as HistoryEntry,
  ]

  // Single update on the original task — no copies created
  const { error: updateError } = await supabase.from('todos').update({
    cluster_inbox: false,
    assigned_to: null,
    manager_id: user.username,
    queue_status: 'claimed',
    task_status: 'in_progress',
    workflow_state: 'split_to_multi',
    scheduler_state: null,
    estimated_work_minutes: null,
    remaining_work_minutes: null,
    queue_rank: null,
    active_started_at: null,
    effective_due_at: null,
    multi_assignment: JSON.stringify(hallMa),
    assignment_chain: JSON.stringify(entryChain),
    history: JSON.stringify(entryHistory),
    last_handoff_at: now,
    updated_at: now,
  }).eq('id', todoId)

  if (updateError) {
    console.error('[hall-multi-assign] Failed to update task:', updateError)
    return { success: false, error: updateError.message }
  }

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: 'assigned',
    notes: `Multi-assigned to: ${assigneeNames}`,
  })

  // Notify all assignees concurrently
  await notifyUsers(
    supabase,
    assignments.map((a) => a.username.trim()),
    {
      type: 'task_assigned',
      title: 'Hall Task Assigned to You',
      body: `${user.username} assigned you a hall task: "${task.title as string}"`,
      relatedId: todoId,
    },
    user.username,
  )

  revalidateTasksData()
  revalidatePath('/dashboard/tasks')
  revalidatePath('/dashboard')
  return { success: true, assignedCount: assignments.length }
}

// ── MA-aware helper: load task and resolve per-user MA entry ─────────────────
// Used by all hall scheduler actions to transparently handle both single-assign
// and multi-assignment tasks.  Returns the MA entry + index when the task is MA,
// or null when it's a regular single-assign task.
async function loadMaEntryForUser(
  supabase: ReturnType<typeof createServerClient>,
  todoId: string,
  username: string,
): Promise<{
  task: Record<string, unknown>
  ma: MultiAssignment
  idx: number
  entry: MultiAssignmentEntry
} | null> {
  const { data: existing } = await supabase
    .from('todos')
    .select('multi_assignment, workflow_state, history, assignment_chain, cluster_id, completed, title, username')
    .eq('id', todoId)
    .single()
  if (!existing) return null
  const task = existing as Record<string, unknown>
  if (task.workflow_state !== 'split_to_multi') return null
  const ma = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  if (!ma?.enabled || !Array.isArray(ma.assignees)) return null
  const idx = ma.assignees.findIndex(
    (a) => (a.username || '').toLowerCase() === username.toLowerCase()
  )
  if (idx === -1) return null
  return { task, ma, idx, entry: ma.assignees[idx] }
}

/**
 * Manually activate a task that is in user_queue or paused state.
 * Used when auto_start_next_task is OFF, or for manually resuming a paused task.
 * Only the task assignee, their manager, or a hall leader may call this.
 */
export async function activateHallTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  // ── MA path: activate this user's per-assignee hall_scheduler_state ────────
  const maResult = await loadMaEntryForUser(supabase, todoId, user.username)
  if (maResult) {
    const { task: maTask, ma, idx, entry } = maResult
    const maState = entry.hall_scheduler_state ?? null
    if (!maState || !['user_queue', 'paused'].includes(maState)) {
      return { success: false, error: `Cannot activate your assignment in state "${maState}".` }
    }
    const clusterId = maTask.cluster_id as string | null
    if (!clusterId) return { success: false, error: 'Task has no cluster context.' }
    const hallHours = await getClusterOfficeHours(supabase, clusterId)
    const now = new Date().toISOString()
    const storedRemaining = entry.hall_remaining_minutes ?? 0
    const effectiveDueAt = storedRemaining > 0
      ? calculateEffectiveDueAt(now, storedRemaining, hallHours).toISOString()
      : null

    // Auto-pause any currently active single-assign task for this user
    const { data: activeChecks } = await supabase
      .from('todos')
      .select('id, active_started_at, remaining_work_minutes, total_active_minutes, history')
      .eq('assigned_to', user.username)
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('scheduler_state', 'active')
      .limit(1)
    if (activeChecks && activeChecks.length > 0) {
      const at = activeChecks[0] as Record<string, unknown>
      const startedAt = at.active_started_at as string | null
      const workedMinutes = startedAt ? getWorkMinutesInRange(startedAt, now, hallHours) : 0
      const storedRem = (at.remaining_work_minutes as number | null) ?? 0
      const totalAct = (at.total_active_minutes as number | null) ?? 0
      const newRem = Math.max(0, storedRem - workedMinutes)
      const apHistory = parseJson<HistoryEntry[]>(at.history, [])
      apHistory.push({ type: 'status_change', user: user.username, details: `Auto-paused — ${user.username} started another queued task. Worked: ${workedMinutes}m. Remaining: ${newRem}m.`, timestamp: now, icon: '⏸️', title: 'Auto-Paused' })
      await supabase.from('todos').update({ scheduler_state: 'paused', task_status: 'todo', active_started_at: null, remaining_work_minutes: newRem, total_active_minutes: totalAct + workedMinutes, history: JSON.stringify(apHistory), updated_at: now }).eq('id', at.id as string)
      await writeHallWorkLog(supabase, { todoId: at.id as string, username: user.username, event: 'paused', minutesDeducted: workedMinutes, notes: 'Auto-paused to start MA task' })
    }

    // Auto-pause any currently active MA entry for this user in any other task
    const { data: allClusterMa } = await supabase
      .from('todos').select('id, multi_assignment, history')
      .eq('cluster_id', clusterId).eq('completed', false).eq('workflow_state', 'split_to_multi')
    for (const row of ((allClusterMa ?? []) as Array<{ id: string; multi_assignment: unknown; history: unknown }>)) {
      if (row.id === todoId) continue
      const otherMa = parseJson<MultiAssignment | null>(row.multi_assignment, null)
      if (!otherMa?.assignees) continue
      const otherIdx = otherMa.assignees.findIndex(
        (a) => a.username.toLowerCase() === user.username.toLowerCase() && a.hall_scheduler_state === 'active'
      )
      if (otherIdx === -1) continue
      const otherEntry = otherMa.assignees[otherIdx]
      const otherStarted = otherEntry.hall_active_started_at ?? null
      const otherWorked = otherStarted ? getWorkMinutesInRange(otherStarted, now, hallHours) : 0
      const otherRem = Math.max(0, (otherEntry.hall_remaining_minutes ?? 0) - otherWorked)
      otherMa.assignees[otherIdx] = { ...otherEntry, hall_scheduler_state: 'paused', hall_active_started_at: null, hall_remaining_minutes: otherRem, hall_effective_due_at: null }
      const otherHistory = parseJson<HistoryEntry[]>(row.history, [])
      otherHistory.push({ type: 'status_change', user: user.username, details: `Auto-paused ${user.username}'s part — started another task. Worked: ${otherWorked}m. Remaining: ${otherRem}m.`, timestamp: now, icon: '⏸️', title: 'Auto-Paused (MA)' })
      await supabase.from('todos').update({ multi_assignment: JSON.stringify(otherMa), history: JSON.stringify(otherHistory), updated_at: now }).eq('id', row.id)
    }

    ma.assignees[idx] = { ...entry, hall_scheduler_state: 'active', hall_active_started_at: now, hall_effective_due_at: effectiveDueAt, status: entry.status === 'pending' ? 'in_progress' : entry.status }
    const history = parseJson<HistoryEntry[]>(maTask.history, [])
    history.push({ type: 'status_change', user: user.username, details: `${user.username} activated their assignment`, timestamp: now, icon: '▶️', title: 'Assignment Activated' })
    await supabase.from('todos').update({ multi_assignment: JSON.stringify(ma), history: JSON.stringify(history), updated_at: now }).eq('id', todoId)
    await writeHallWorkLog(supabase, { todoId, username: user.username, event: maState === 'paused' ? 'resumed' : 'started' })
    revalidateTasksData()
    return { success: true }
  }
  // ── End MA path ───────────────────────────────────────────────────────────

  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, remaining_work_minutes, queue_rank, history')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const state = task.scheduler_state as string | null
  if (!['user_queue', 'paused'].includes(state ?? '')) {
    return { success: false, error: `Cannot activate a task in state "${state}".` }
  }

  const assignedTo = task.assigned_to as string | null
  const clusterId = task.cluster_id as string | null
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isAdmin && user.username !== assignedTo) {
    if (!clusterId) return { success: false, error: 'Not authorised.' }
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Not authorised to activate this task.' }
    }
  }

  // Enforce queue order: only the task with the lowest queue_rank among user_queue tasks can be started
  if (assignedTo && clusterId && state === 'user_queue') {
    const thisRank = (task.queue_rank as number | null) ?? 0
    const { data: queuedTasks } = await supabase
      .from('todos')
      .select('queue_rank')
      .eq('assigned_to', assignedTo)
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('scheduler_state', 'user_queue')
      .neq('id', todoId)
    const minOtherRank = queuedTasks && queuedTasks.length > 0
      ? Math.min(...(queuedTasks as Array<{ queue_rank: number | null }>).map((r) => r.queue_rank ?? Infinity))
      : Infinity
    if (thisRank > minOtherRank) {
      return { success: false, error: 'You must complete the tasks ahead in your queue first. Work on Queue #1 before this one.' }
    }
  }

  const now = new Date().toISOString()
  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const hallHours = clusterId ? await getClusterOfficeHours(supabase, clusterId) : DEFAULT_OFFICE_HOURS

  // Auto-pause any currently active task for this user so they can start this one
  if (assignedTo && clusterId) {
    const { data: activeChecks } = await supabase
      .from('todos')
      .select('id, active_started_at, remaining_work_minutes, total_active_minutes, history')
      .eq('assigned_to', assignedTo)
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('scheduler_state', 'active')
      .neq('id', todoId)
      .limit(1)
    if (activeChecks && activeChecks.length > 0) {
      const at = activeChecks[0] as Record<string, unknown>
      const apNow = new Date().toISOString()
      const startedAt = at.active_started_at as string | null
      const workedMinutes = startedAt ? getWorkMinutesInRange(startedAt, apNow, hallHours) : 0
      const storedRem = (at.remaining_work_minutes as number | null) ?? 0
      const totalAct = (at.total_active_minutes as number | null) ?? 0
      const newRem = Math.max(0, storedRem - workedMinutes)
      const apHistory = parseJson<HistoryEntry[]>(at.history, [])
      apHistory.push({
        type: 'status_change',
        user: user.username,
        details: `Auto-paused — ${user.username} started another queued task. Worked: ${workedMinutes}m. Remaining: ${newRem}m.`,
        timestamp: apNow,
        icon: '⏸️',
        title: 'Auto-Paused',
      })
      await supabase.from('todos').update({
        scheduler_state: 'paused',
        task_status: 'todo',
        active_started_at: null,
        remaining_work_minutes: newRem,
        total_active_minutes: totalAct + workedMinutes,
        history: JSON.stringify(apHistory),
        updated_at: apNow,
      }).eq('id', at.id as string)
      await writeHallWorkLog(supabase, {
        todoId: at.id as string,
        username: user.username,
        event: 'paused',
        minutesDeducted: workedMinutes,
        notes: 'Auto-paused to start another queued task',
      })
    }
  }
  const effectiveDueAt = storedRemaining > 0
    ? calculateEffectiveDueAt(now, storedRemaining, hallHours).toISOString()
    : null

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'status_change',
    user: user.username,
    details: `${user.username} activated task`,
    timestamp: now,
    icon: '▶️',
    title: 'Task Activated',
  })

  await supabase.from('todos').update({
    scheduler_state: 'active',
    active_started_at: now,
    task_status: 'in_progress',
    effective_due_at: effectiveDueAt,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: state === 'paused' ? 'resumed' : 'started',
  })

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pause an active hall task.
 *
 * Rules:
 *  - Task must be in 'active' state.
 *  - If the user has NO other queued/paused tasks in this hall,
 *    pause is NOT allowed — use blockHallTaskAction instead.
 *  - Deducts worked minutes from remaining_work_minutes.
 *  - If auto_start_next_task is ON, the next candidate task is activated.
 *  - Paused task keeps its queue_rank (does NOT go to the end of the queue).
 */
export async function pauseHallTaskAction(
  todoId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  // ── MA path ───────────────────────────────────────────────────────────────
  const maResult = await loadMaEntryForUser(supabase, todoId, user.username)
  if (maResult) {
    const { task: maTask, ma, idx, entry } = maResult
    if (entry.hall_scheduler_state !== 'active') {
      return { success: false, error: 'Only active assignments can be paused.' }
    }
    const clusterId = maTask.cluster_id as string | null
    if (!clusterId) return { success: false, error: 'Task has no cluster context.' }

    // Check if user has other queued/paused tasks to hand off to
    const { data: otherQueued } = await supabase.from('todos').select('id').eq('assigned_to', user.username).eq('cluster_id', clusterId).in('scheduler_state', ['user_queue', 'paused']).limit(1)
    let hasOtherQueued = (otherQueued ?? []).length > 0
    if (!hasOtherQueued) {
      const { data: maTasks } = await supabase.from('todos').select('id, multi_assignment').eq('cluster_id', clusterId).eq('workflow_state', 'split_to_multi').eq('completed', false)
      const uLower = user.username.toLowerCase()
      hasOtherQueued = ((maTasks ?? []) as Array<{ id: string; multi_assignment: unknown }>).some((row) => {
        if (row.id === todoId) {
          // Check other assignees in the same task for this user (unlikely but safe)
          return false
        }
        const otherMa = parseJson<MultiAssignment | null>(row.multi_assignment, null)
        return otherMa?.assignees?.some((a) => a.username.toLowerCase() === uLower && a.hall_scheduler_state && ['user_queue', 'paused'].includes(a.hall_scheduler_state)) ?? false
      })
      // Also check other entries in this same task's MA (user might have multiple entries — unlikely but safe)
      if (!hasOtherQueued) {
        hasOtherQueued = ma.assignees.some((a, i) => i !== idx && a.username.toLowerCase() === uLower && a.hall_scheduler_state && ['user_queue', 'paused'].includes(a.hall_scheduler_state))
      }
    }
    if (!hasOtherQueued) {
      return { success: false, error: 'No queued tasks to hand off to. Use "Mark as Blocked" with a reason instead.' }
    }

    const hallHours = await getClusterOfficeHours(supabase, clusterId)
    const now = new Date().toISOString()
    const activeStartedAt = entry.hall_active_started_at ?? null
    const workedMinutes = activeStartedAt ? getWorkMinutesInRange(activeStartedAt, now, hallHours) : 0
    const storedRemaining = entry.hall_remaining_minutes ?? 0
    const newRemaining = Math.max(0, storedRemaining - workedMinutes)

    ma.assignees[idx] = { ...entry, hall_scheduler_state: 'paused', hall_active_started_at: null, hall_remaining_minutes: newRemaining, hall_effective_due_at: null }
    const history = parseJson<HistoryEntry[]>(maTask.history, [])
    history.push({ type: 'status_change', user: user.username, details: `${user.username} paused their assignment. Worked: ${workedMinutes}m. Remaining: ${newRemaining}m.${reason?.trim() ? ` Reason: ${reason.trim()}` : ''}`, timestamp: now, icon: '⏸️', title: 'Assignment Paused' })
    await supabase.from('todos').update({ multi_assignment: JSON.stringify(ma), history: JSON.stringify(history), updated_at: now }).eq('id', todoId)
    await writeHallWorkLog(supabase, { todoId, username: user.username, event: 'paused', minutesDeducted: workedMinutes, notes: reason?.trim() || undefined })

    // Pausing is an explicit handoff: immediately auto-activate the next queued
    // task in this hall for this user (if any).
    await autoActivateNextTask(supabase, user.username, clusterId, todoId, hallHours)
    revalidateTasksData()
    return { success: true }
  }
  // ── End MA path ───────────────────────────────────────────────────────────

  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, active_started_at, remaining_work_minutes, total_active_minutes, history, queue_rank')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if (task.scheduler_state !== 'active') {
    return { success: false, error: 'Only active tasks can be paused.' }
  }

  const assignedTo = task.assigned_to as string
  if (!assignedTo) return { success: false, error: 'Task has no assignee.' }

  // Only assignee, their manager, or hall leader can pause
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin && user.username !== assignedTo) {
    return { success: false, error: 'Only the task assignee can pause their task.' }
  }

  const clusterId = task.cluster_id as string | null
  if (!clusterId) return { success: false, error: 'Task has no cluster context.' }

  // Check if there are other queued tasks — required for a simple pause
  const { data: otherQueued } = await supabase
    .from('todos')
    .select('id')
    .eq('assigned_to', assignedTo)
    .eq('cluster_id', clusterId)
    .in('scheduler_state', ['user_queue', 'paused'])
    .neq('id', todoId)
    .limit(1)

  let hasOtherQueued = (otherQueued ?? []).length > 0

  if (!hasOtherQueued) {
    const { data: maTasks } = await supabase
      .from('todos')
      .select('id, multi_assignment')
      .eq('cluster_id', clusterId)
      .eq('workflow_state', 'split_to_multi')
      .eq('completed', false)
      .neq('id', todoId)
    const assignedToLower = assignedTo.toLowerCase()
    hasOtherQueued = ((maTasks ?? []) as Array<{ id: string; multi_assignment: unknown }>).some((row) => {
      const maTmp = parseJson<MultiAssignment | null>(row.multi_assignment, null)
      if (!maTmp?.enabled) return false
      return maTmp.assignees.some(
        (a) => a.username.toLowerCase() === assignedToLower &&
          a.hall_scheduler_state && ['user_queue', 'paused'].includes(a.hall_scheduler_state)
      )
    })
  }

  if (!hasOtherQueued) {
    return {
      success: false,
      error: 'No queued tasks to hand off to. Use "Mark as Blocked" with a reason instead.',
    }
  }

  const activeStartedAt = task.active_started_at as string | null
  const hallHours = await getClusterOfficeHours(supabase, clusterId)
  const workedMinutes = activeStartedAt
    ? getWorkMinutesInRange(activeStartedAt, new Date().toISOString(), hallHours)
    : 0

  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const totalActive = (task.total_active_minutes as number | null) ?? 0
  const newRemaining = Math.max(0, storedRemaining - workedMinutes)
  const newTotal = totalActive + workedMinutes

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'status_change',
    user: user.username,
    details: `${user.username} paused task. Worked: ${workedMinutes}m. Remaining: ${newRemaining}m.${reason?.trim() ? ` Reason: ${reason.trim()}` : ''}`,
    timestamp: now,
    icon: '⏸️',
    title: 'Task Paused',
  })

  await supabase.from('todos').update({
    scheduler_state: 'paused',
    active_started_at: null,
    task_status: 'todo',
    remaining_work_minutes: newRemaining,
    total_active_minutes: newTotal,
    pause_reason: reason?.trim() || null,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: 'paused',
    minutesDeducted: workedMinutes,
    notes: reason?.trim() || undefined,
  })

  // Pausing is an explicit handoff: immediately auto-activate the next queued
  // task in this hall for this user (if any).
  await autoActivateNextTask(supabase, assignedTo, clusterId, todoId, hallHours)

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Block a hall task (from active or queued/paused state).
 *
 * Blocked state:
 *  - Countdown stops.
 *  - Reason is REQUIRED.
 *  - If user has queued tasks and auto_start is ON, the next task is activated.
 *  - If no queued tasks, user can be without an active task (this is allowed for blocked).
 *  - Blocked tasks do NOT compete for auto-activation — only unblocking moves them back.
 */
export async function blockHallTaskAction(
  todoId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!reason?.trim()) return { success: false, error: 'A blocked reason is required.' }

  const supabase = createServerClient()

  // ── MA path ───────────────────────────────────────────────────────────────
  const maResult = await loadMaEntryForUser(supabase, todoId, user.username)
  if (maResult) {
    const { task: maTask, ma, idx, entry } = maResult
    const maState = entry.hall_scheduler_state ?? null
    if (!maState || !['active', 'user_queue', 'paused'].includes(maState)) {
      return { success: false, error: `Cannot block an assignment in state "${maState}".` }
    }
    const clusterId = maTask.cluster_id as string | null
    if (!clusterId) return { success: false, error: 'Task has no cluster context.' }
    const hallHours = await getClusterOfficeHours(supabase, clusterId)
    const now = new Date().toISOString()

    let workedMinutes = 0
    if (maState === 'active' && entry.hall_active_started_at) {
      workedMinutes = getWorkMinutesInRange(entry.hall_active_started_at, now, hallHours)
    }
    const storedRemaining = entry.hall_remaining_minutes ?? 0
    const newRemaining = Math.max(0, storedRemaining - workedMinutes)

    ma.assignees[idx] = { ...entry, hall_scheduler_state: 'blocked', hall_active_started_at: null, hall_remaining_minutes: newRemaining, hall_effective_due_at: null }
    const history = parseJson<HistoryEntry[]>(maTask.history, [])
    history.push({ type: 'status_change', user: user.username, details: `${user.username} blocked their assignment. Reason: ${reason.trim()}${workedMinutes > 0 ? `. Worked: ${workedMinutes}m` : ''}`, timestamp: now, icon: '🚫', title: 'Assignment Blocked' })
    await supabase.from('todos').update({ multi_assignment: JSON.stringify(ma), history: JSON.stringify(history), updated_at: now }).eq('id', todoId)
    await writeHallWorkLog(supabase, { todoId, username: user.username, event: 'blocked', minutesDeducted: workedMinutes, notes: reason.trim() })

    if (maState === 'active') {
      const settings = await getHallSettingsForTask(supabase, clusterId)
      if (settings.auto_start_next_task) {
        await autoActivateNextTask(supabase, user.username, clusterId, todoId, hallHours)
      }
    }
    revalidateTasksData()
    return { success: true }
  }
  // ── End MA path ───────────────────────────────────────────────────────────

  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, active_started_at, remaining_work_minutes, total_active_minutes, history')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const state = task.scheduler_state as string | null
  if (!['active', 'user_queue', 'paused'].includes(state ?? '')) {
    return { success: false, error: `Cannot block a task in state "${state}".` }
  }

  const assignedTo = task.assigned_to as string | null
  if (!assignedTo) return { success: false, error: 'Task has no assignee.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin && user.username !== assignedTo) {
    return { success: false, error: 'Only the task assignee can block their task.' }
  }

  const clusterId = task.cluster_id as string | null
  const hallHours = clusterId ? await getClusterOfficeHours(supabase, clusterId) : DEFAULT_OFFICE_HOURS

  let workedMinutes = 0
  if (state === 'active') {
    const activeStartedAt = task.active_started_at as string | null
    if (activeStartedAt) {
      workedMinutes = getWorkMinutesInRange(activeStartedAt, new Date().toISOString(), hallHours)
    }
  }

  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const totalActive = (task.total_active_minutes as number | null) ?? 0
  const newRemaining = Math.max(0, storedRemaining - workedMinutes)
  const newTotal = totalActive + workedMinutes

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'status_change',
    user: user.username,
    details: `${user.username} marked task as blocked. Reason: ${reason.trim()}${workedMinutes > 0 ? `. Worked: ${workedMinutes}m` : ''}`,
    timestamp: now,
    icon: '🚫',
    title: 'Task Blocked',
  })

  await supabase.from('todos').update({
    scheduler_state: 'blocked',
    active_started_at: null,
    task_status: 'todo',
    remaining_work_minutes: newRemaining,
    total_active_minutes: newTotal,
    blocked_reason: reason.trim(),
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: 'blocked',
    minutesDeducted: workedMinutes,
    notes: reason.trim(),
  })

  if (clusterId) {
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      await autoActivateNextTask(supabase, assignedTo, clusterId, todoId, hallHours)
    }
  }

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unblock a hall task.
 * Moves it back to user_queue so it can compete for activation.
 * Does NOT automatically activate it — the auto-activate logic handles that
 * when the currently active task completes.
 */
export async function unblockHallTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  // ── MA path ───────────────────────────────────────────────────────────────
  const maResult = await loadMaEntryForUser(supabase, todoId, user.username)
  if (maResult) {
    const { task: maTask, ma, idx, entry } = maResult
    if (entry.hall_scheduler_state !== 'blocked') {
      return { success: false, error: 'Assignment is not blocked.' }
    }
    const clusterId = maTask.cluster_id as string | null
    if (!clusterId) return { success: false, error: 'Task has no cluster context.' }

    const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
    if (!isAdmin) {
      const { data: membership } = await supabase
        .from('cluster_members').select('cluster_role')
        .eq('cluster_id', clusterId).eq('username', user.username).single()
      if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
        // assignee can unblock themselves
        if (user.username !== entry.username) {
          return { success: false, error: 'Not authorised to unblock this assignment.' }
        }
      }
    }

    const now = new Date().toISOString()
    ma.assignees[idx] = { ...entry, hall_scheduler_state: 'user_queue' }
    const history = parseJson<HistoryEntry[]>(maTask.history, [])
    history.push({ type: 'status_change', user: user.username, details: `${user.username} unblocked their assignment.`, timestamp: now, icon: '✅', title: 'Assignment Unblocked' })
    await supabase.from('todos').update({ multi_assignment: JSON.stringify(ma), history: JSON.stringify(history), updated_at: now }).eq('id', todoId)
    await writeHallWorkLog(supabase, { todoId, username: user.username, event: 'unblocked' })

    // Auto-activate if no active task
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      // Check both single-assign active tasks AND active MA entries for this user
      const { data: activeCheck } = await supabase
        .from('todos').select('id')
        .eq('assigned_to', user.username).eq('cluster_id', clusterId)
        .eq('scheduler_state', 'active').limit(1)
      const hasActiveSingle = activeCheck && activeCheck.length > 0
      if (!hasActiveSingle) {
        // Also check if user has any other active MA entry in this cluster
        const { data: clusterTasks } = await supabase
          .from('todos').select('id, multi_assignment')
          .eq('cluster_id', clusterId)
          .eq('workflow_state', 'split_to_multi')
          .neq('id', todoId)
        const hasActiveMa = (clusterTasks ?? []).some((t: Record<string, unknown>) => {
          const m = parseJson<{ enabled: boolean; assignees: Array<{ username: string; hall_scheduler_state?: string }> }>(t.multi_assignment, { enabled: false, assignees: [] })
          return m.enabled && m.assignees.some((a) => a.username === user.username && a.hall_scheduler_state === 'active')
        })
        if (!hasActiveMa) {
          const hallHours = await getClusterOfficeHours(supabase, clusterId)
          await autoActivateNextTask(supabase, user.username, clusterId, null, hallHours)
        }
      }
    }
    revalidateTasksData()
    return { success: true }
  }
  // ── End MA path ───────────────────────────────────────────────────────────

  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, history, remaining_work_minutes')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if (task.scheduler_state !== 'blocked') {
    return { success: false, error: 'Task is not blocked.' }
  }

  const assignedTo = task.assigned_to as string | null
  const clusterId = task.cluster_id as string | null
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'

  if (!isAdmin && user.username !== assignedTo) {
    // Hall leaders can unblock
    if (clusterId) {
      const { data: membership } = await supabase
        .from('cluster_members').select('cluster_role')
        .eq('cluster_id', clusterId).eq('username', user.username).single()
      if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
        return { success: false, error: 'Not authorised to unblock this task.' }
      }
    } else {
      return { success: false, error: 'Not authorised to unblock this task.' }
    }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'status_change',
    user: user.username,
    details: `${user.username} unblocked the task.`,
    timestamp: now,
    icon: '✅',
    title: 'Task Unblocked',
  })

  // Re-enter user_queue; the auto-activate logic will pick it up if appropriate
  await supabase.from('todos').update({
    scheduler_state: 'user_queue',
    blocked_reason: null,
    task_status: 'todo',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await writeHallWorkLog(supabase, { todoId, username: user.username, event: 'unblocked' })

  // If user has no active task and auto_start is ON → activate immediately
  if (assignedTo && clusterId) {
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      const { data: activeCheck } = await supabase
        .from('todos').select('id')
        .eq('assigned_to', assignedTo).eq('cluster_id', clusterId)
        .eq('scheduler_state', 'active').limit(1)
      if (!activeCheck || activeCheck.length === 0) {
        const hallHours = await getClusterOfficeHours(supabase, clusterId)
        await autoActivateNextTask(supabase, assignedTo, clusterId, null, hallHours)
      }
    }
  }

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete a hall task.
 * Deducts any remaining active time, marks as completed, and auto-activates the
 * next queued task if auto_start_next_task is ON.
 */
export async function completeHallTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  // ── MA path ───────────────────────────────────────────────────────────────
  const maResult = await loadMaEntryForUser(supabase, todoId, user.username)
  if (maResult) {
    const { task: maTask, ma, idx, entry } = maResult
    const maState = entry.hall_scheduler_state ?? null
    if (!maState || !['active', 'user_queue', 'paused'].includes(maState)) {
      return { success: false, error: `Cannot complete an assignment in state "${maState ?? 'unknown'}".` }
    }
    const clusterId = maTask.cluster_id as string | null
    if (!clusterId) return { success: false, error: 'Task has no cluster context.' }
    const hallHours = await getClusterOfficeHours(supabase, clusterId)
    const now = new Date().toISOString()

    let workedMinutes = 0
    if (maState === 'active' && entry.hall_active_started_at) {
      workedMinutes = getWorkMinutesInRange(entry.hall_active_started_at, now, hallHours)
    }

    ma.assignees[idx] = {
      ...entry,
      hall_scheduler_state: 'completed',
      hall_active_started_at: null,
      hall_remaining_minutes: 0,
      hall_effective_due_at: null,
      status: 'accepted',
      completed_at: now,
    }

    // Check if all assignees are now completed
    const allCompleted = ma.assignees.every((a) => a.hall_scheduler_state === 'completed' || a.status === 'accepted')

    const history = parseJson<HistoryEntry[]>(maTask.history, [])
    history.push({ type: 'completed', user: user.username, details: `${user.username} completed their assignment. Worked: ${workedMinutes}m.${allCompleted ? ' All assignees are done.' : ''}`, timestamp: now, icon: '✅', title: 'Assignment Completed' })

    const updatePayload: Record<string, unknown> = {
      multi_assignment: JSON.stringify(ma),
      history: JSON.stringify(history),
      updated_at: now,
    }
    if (allCompleted) {
      updatePayload.completed = true
      updatePayload.completed_at = now
      updatePayload.task_status = 'done'
    }
    await supabase.from('todos').update(updatePayload).eq('id', todoId)

    await writeHallWorkLog(supabase, { todoId, username: user.username, event: 'completed', minutesDeducted: workedMinutes, notes: `Assignment completed` })

    // Notify original creator if all done
    if (allCompleted) {
      const creatorUsername = maTask.username as string | null
      if (creatorUsername) {
        await createNotification(supabase, {
          userId: creatorUsername,
          type: 'task_approved',
          title: 'All Group Members Completed',
          body: `All assignees have completed their parts for the multi-assign task "${maTask.title as string}".`,
          relatedId: todoId,
        })
      }
    }

    // Auto-start next
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      await autoActivateNextTask(supabase, user.username, clusterId, todoId, hallHours)
    }
    revalidateTasksData()
    return { success: true }
  }
  // ── End MA path ───────────────────────────────────────────────────────────

  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, active_started_at, remaining_work_minutes, total_active_minutes, history, title, username, multi_assign_group_id')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const state = task.scheduler_state as string | null

  if (!state || !['active', 'user_queue', 'paused'].includes(state)) {
    return { success: false, error: `Cannot complete a task in state "${state ?? 'unknown'}".` }
  }

  const assignedTo = task.assigned_to as string | null
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin && user.username !== assignedTo) {
    return { success: false, error: 'Only the task assignee can complete their task.' }
  }

  const clusterId = task.cluster_id as string | null
  const hallHours = clusterId ? await getClusterOfficeHours(supabase, clusterId) : DEFAULT_OFFICE_HOURS

  let workedMinutes = 0
  if (state === 'active') {
    const activeStartedAt = task.active_started_at as string | null
    if (activeStartedAt) {
      workedMinutes = getWorkMinutesInRange(activeStartedAt, new Date().toISOString(), hallHours)
    }
  }

  const totalActive = (task.total_active_minutes as number | null) ?? 0
  const newTotal = totalActive + workedMinutes
  const now = new Date().toISOString()

  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'completed',
    user: user.username,
    details: `${user.username} completed hall task. Total worked: ${newTotal}m.`,
    timestamp: now,
    icon: '✅',
    title: 'Task Completed',
  })

  await supabase.from('todos').update({
    scheduler_state: 'completed',
    completed: true,
    completed_by: user.username,
    completed_at: now,
    active_started_at: null,
    task_status: 'done',
    remaining_work_minutes: 0,
    total_active_minutes: newTotal,
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: 'completed',
    minutesDeducted: workedMinutes,
    notes: `Total worked: ${newTotal}m`,
  })

  // Auto-start next queued/paused task
  if (assignedTo && clusterId) {
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      await autoActivateNextTask(supabase, assignedTo, clusterId, null, hallHours)
    }
  }

  // Multi-assign group: check if ALL sibling tasks are completed → notify original creator
  const multiAssignGroupId = (task.multi_assign_group_id as string | null) ?? null
  if (multiAssignGroupId) {
    const { data: siblings } = await supabase
      .from('todos')
      .select('id, completed, username')
      .eq('multi_assign_group_id', multiAssignGroupId)
    if (siblings && siblings.length > 0) {
      const allDone = (siblings as Array<{ id: string; completed: boolean; username: string }>).every((s) => s.completed)
      if (allDone) {
        // Notify the original task creator that all assignees completed their work
        const creatorUsername = (siblings[0] as Record<string, string>).username
        await createNotification(supabase, {
          userId: creatorUsername,
          type: 'task_approved',
          title: 'All Group Members Completed',
          body: `All assignees have completed their parts for the multi-assign task "${task.title as string}". Please review and approve.`,
          relatedId: todoId,
        })
      }
    }
  }

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a hall-scheduled task for approval (instead of directly completing it).
 *
 * Behaviour:
 *  - Timer is frozen (worked minutes deducted, remaining_work_minutes preserved).
 *  - scheduler_state → 'waiting_review'  (task holds its queue_rank position).
 *  - approval_status → 'pending_approval', task_status → 'in_progress' (stays visible).
 *  - autoActivateNextTask is called so the next queued task starts automatically.
 *  - When the approver later approves → completeHallTaskAction finalises it.
 *  - When the approver declines → task reverts to 'paused' and re-enters queue competition.
 */
export async function submitHallTaskForReviewAction(
  todoId: string,
  submissionNote?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  // ── MA path ───────────────────────────────────────────────────────────────
  const maResult = await loadMaEntryForUser(supabase, todoId, user.username)
  if (maResult) {
    const { task: maTask, ma, idx, entry } = maResult
    const maState = entry.hall_scheduler_state ?? null
    if (!maState || !['active', 'user_queue', 'paused'].includes(maState)) {
      return { success: false, error: `Cannot submit an assignment in state "${maState ?? 'unknown'}" for review.` }
    }
    const clusterId = maTask.cluster_id as string | null
    if (!clusterId) return { success: false, error: 'Task has no cluster context.' }
    const hallHours = await getClusterOfficeHours(supabase, clusterId)
    const now = new Date().toISOString()

    let workedMinutes = 0
    if (maState === 'active' && entry.hall_active_started_at) {
      workedMinutes = getWorkMinutesInRange(entry.hall_active_started_at, now, hallHours)
    }
    const storedRemaining = entry.hall_remaining_minutes ?? 0
    const newRemaining = Math.max(0, storedRemaining - workedMinutes)

    // Build approval chain using the task-level data
    const pendingChain = buildPendingApprovalChain(maTask as Record<string, unknown>, user.username, now)
    const nextApprover = pendingChain[0]?.user || (maTask.username as string)

    ma.assignees[idx] = {
      ...entry,
      hall_scheduler_state: 'waiting_review',
      hall_active_started_at: null,
      hall_remaining_minutes: newRemaining,
      hall_effective_due_at: null,
      status: 'pending_review',
    }

    const history = parseJson<HistoryEntry[]>(maTask.history, [])
    history.push({
      type: 'completion_submitted',
      user: user.username,
      details: submissionNote?.trim()
        ? `${user.username} submitted their assignment for approval. Awaiting ${nextApprover}. Note: ${submissionNote.trim()}`
        : `${user.username} submitted their assignment for approval. Awaiting ${nextApprover}.`,
      timestamp: now,
      icon: '⏳',
      title: 'Assignment Submitted for Approval',
    })

    await supabase.from('todos').update({ multi_assignment: JSON.stringify(ma), history: JSON.stringify(history), updated_at: now }).eq('id', todoId)
    await writeHallWorkLog(supabase, { todoId, username: user.username, event: 'paused', minutesDeducted: workedMinutes, notes: 'Submitted for approval' })

    // Notify approver
    await createNotification(supabase, {
      userId: nextApprover,
      type: 'task_assigned',
      title: 'Hall Task Needs Approval',
      body: `${user.username} submitted their assignment on "${maTask.title as string}" for your approval.`,
      relatedId: todoId,
    })

    // Auto-start next
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      await autoActivateNextTask(supabase, user.username, clusterId, todoId, hallHours)
    }
    revalidateTasksData()
    return { success: true }
  }
  // ── End MA path ───────────────────────────────────────────────────────────

  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, active_started_at, remaining_work_minutes, total_active_minutes, queue_rank, history, title, username, multi_assign_group_id, assignment_chain')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const state = task.scheduler_state as string | null

  if (!state || !['active', 'user_queue', 'paused'].includes(state)) {
    return { success: false, error: `Cannot submit a task in state "${state ?? 'unknown'}" for review.` }
  }

  const assignedTo = task.assigned_to as string | null
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin && user.username !== assignedTo) {
    return { success: false, error: 'Only the task assignee can submit their task for review.' }
  }

  const clusterId = task.cluster_id as string | null
  const hallHours = clusterId ? await getClusterOfficeHours(supabase, clusterId) : DEFAULT_OFFICE_HOURS

  // Freeze the timer: deduct minutes worked since last activation
  let workedMinutes = 0
  if (state === 'active') {
    const activeStartedAt = task.active_started_at as string | null
    if (activeStartedAt) {
      workedMinutes = getWorkMinutesInRange(activeStartedAt, new Date().toISOString(), hallHours)
    }
  }
  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const totalActive = (task.total_active_minutes as number | null) ?? 0
  const newRemaining = Math.max(0, storedRemaining - workedMinutes)
  const newTotal = totalActive + workedMinutes

  // Build approval chain (same logic as normal task submission)
  const pendingChain = buildPendingApprovalChain(task, user.username, new Date().toISOString())
  const nextApprover = pendingChain[0]?.user || (task.username as string)

  // Update assignment chain
  const assignmentChain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  assignmentChain.push({
    user: user.username,
    role: 'submitted_for_approval',
    assignedAt: new Date().toISOString(),
    next_user: nextApprover,
    feedback: submissionNote?.trim() || undefined,
  })

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  history.push({
    type: 'completion_submitted',
    user: user.username,
    details: submissionNote?.trim()
      ? `${user.username} submitted hall task for approval. Awaiting ${nextApprover}. Summary: ${submissionNote.trim()}`
      : `${user.username} submitted hall task for approval. Awaiting ${nextApprover}.`,
    timestamp: now,
    icon: '⏳',
    title: 'Submitted for Approval',
  })

  await supabase.from('todos').update({
    scheduler_state: 'waiting_review',
    task_status: 'in_progress',         // stays visible as in-progress
    active_started_at: null,            // timer frozen
    remaining_work_minutes: newRemaining,
    total_active_minutes: newTotal,
    completed: false,
    completed_by: user.username,        // credit worker
    approval_status: 'pending_approval',
    pending_approver: nextApprover,
    approval_chain: JSON.stringify(pendingChain),
    assignment_chain: JSON.stringify(assignmentChain),
    approval_requested_at: now,
    approval_sla_due_at: addHoursIso(now, 48),
    workflow_state: 'submitted_for_approval',
    history: JSON.stringify(history),
    updated_at: now,
  }).eq('id', todoId)

  await writeHallWorkLog(supabase, {
    todoId,
    username: user.username,
    event: 'paused',   // treat as a pause for worklog continuity
    minutesDeducted: workedMinutes,
    notes: 'Submitted for approval',
  })

  // Notify approver
  await createNotification(supabase, {
    userId: nextApprover,
    type: 'task_assigned',
    title: 'Hall Task Needs Approval',
    body: `${user.username} submitted "${task.title as string}" for your approval.`,
    relatedId: todoId,
  })

  // Auto-start next queued task now that this one is in review
  if (assignedTo && clusterId) {
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.auto_start_next_task) {
      await autoActivateNextTask(supabase, assignedTo, clusterId, todoId, hallHours)
    }
  }

  revalidateTasksData()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reorder the queue for a specific user within a hall.
 * Accepts an ordered array of todo IDs (the desired order, rank 1 = first).
 *
 * Rules:
 *  - Caller must be a hall manager, supervisor, or admin.
 *  - Supervisors can only reorder users in their scoped departments.
 *  - The active task (if any) retains rank 1 and floats to the top.
 *  - All provided IDs must belong to `targetUsername` and `clusterId`.
 */
export async function reorderHallUserQueueAction(
  clusterId: string,
  targetUsername: string,
  orderedTodoIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!clusterId || !targetUsername || !orderedTodoIds.length) {
    return { success: false, error: 'clusterId, targetUsername, and orderedTodoIds are required.' }
  }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  let supervisorScoped: string[] | null = null

  if (!isAdmin) {
    const supabase = createServerClient()
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role, scoped_departments')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only hall leaders can reorder team member queues.' }
    }
    if ((membership as Record<string, string>).cluster_role === 'supervisor') {
      supervisorScoped = ((membership as Record<string, unknown>).scoped_departments as string[] | null) ?? null
    }
  }

  const supabase = createServerClient()

  // Supervisor scope check
  if (supervisorScoped && supervisorScoped.length > 0) {
    const { data: targetUser } = await supabase
      .from('users').select('department').eq('username', targetUsername).single()
    const targetDept = ((targetUser as Record<string, string> | null)?.department ?? '').toLowerCase()
    const inScope = supervisorScoped.some((d) => d.toLowerCase() === targetDept)
    if (!inScope) {
      return { success: false, error: 'Supervisor cannot reorder tasks for users outside their scoped departments.' }
    }
  }

  // Build queue map for this user across BOTH single-assign and MA entries.
  const { data: clusterTasks } = await supabase
    .from('todos')
    .select('id, assigned_to, scheduler_state, queue_rank, workflow_state, multi_assignment')
    .eq('cluster_id', clusterId)
    .eq('completed', false)

  type QueueItem = {
    kind: 'single' | 'ma'
    state: string
    row: Record<string, unknown>
  }
  const queueMap = new Map<string, QueueItem>()

  ; (clusterTasks ?? []).forEach((row: Record<string, unknown>) => {
    const id = row.id as string
    if (!id) return

    // Single-assignment queue item
    if ((row.assigned_to as string | null) === targetUsername) {
      const state = (row.scheduler_state as string | null) ?? ''
      if (['active', 'user_queue', 'paused', 'blocked', 'waiting_review'].includes(state)) {
        queueMap.set(id, { kind: 'single', state, row })
      }
    }

    // Multi-assignment queue item (per-user entry inside JSONB)
    if ((row.workflow_state as string | null) === 'split_to_multi') {
      const ma = parseJson<MultiAssignment | null>(row.multi_assignment, null)
      if (!ma?.enabled || !Array.isArray(ma.assignees)) return
      const entry = ma.assignees.find((a) => (a.username || '').toLowerCase() === targetUsername.toLowerCase())
      if (!entry) return
      const state = entry.hall_scheduler_state ?? ''
      if (['active', 'user_queue', 'paused', 'blocked', 'waiting_review'].includes(state)) {
        queueMap.set(id, { kind: 'ma', state, row })
      }
    }
  })

  const invalid = orderedTodoIds.filter((id) => !queueMap.has(id))
  if (invalid.length > 0) {
    return { success: false, error: `Task IDs not found in this user's queue: ${invalid.join(', ')}` }
  }

  // Apply new ranks; active task always stays rank 1.
  const now = new Date().toISOString()
  const updates: Array<Promise<unknown>> = []
  orderedTodoIds.forEach((id, index) => {
    const item = queueMap.get(id)
    if (!item) return
    const newRank = item.state === 'active' ? 1 : index + 1

    if (item.kind === 'single') {
      updates.push(
        supabase.from('todos').update({ queue_rank: newRank, updated_at: now }).eq('id', id) as unknown as Promise<unknown>
      )
      return
    }

    const ma = parseJson<MultiAssignment | null>(item.row.multi_assignment, null)
    if (!ma?.enabled || !Array.isArray(ma.assignees)) return
    const idx = ma.assignees.findIndex((a) => (a.username || '').toLowerCase() === targetUsername.toLowerCase())
    if (idx === -1) return
    ma.assignees[idx] = {
      ...ma.assignees[idx],
      hall_queue_rank: newRank,
    }
    updates.push(
      supabase.from('todos').update({ multi_assignment: JSON.stringify(ma), updated_at: now }).eq('id', id) as unknown as Promise<unknown>
    )
  })

  await Promise.all(updates)

  await writeHallWorkLog(supabase, {
    todoId: orderedTodoIds[0],
    username: user.username,
    event: 'reordered',
    notes: `Reordered queue for ${targetUsername}`,
    metadata: { ordered_ids: orderedTodoIds },
  })

  revalidateTasksData()
  return { success: true }
}

// ── Hold User Tasks ───────────────────────────────────────────────────────────

/**
 * Put a user's entire hall task queue on hold (or release hold).
 * When held = true:
 *   - All active tasks are paused; hall time stops counting.
 *   - cluster_members.is_on_hold is set to true.
 * When held = false:
 *   - Hold is released; the highest-priority queued task auto-activates.
 *
 * Only owners, managers, supervisors (within scope), and admins may call this.
 */
export async function holdUserTasksAction(
  clusterId: string,
  targetUsername: string,
  held: boolean,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role, scoped_departments')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only hall owners, managers, supervisors, or admins can hold user tasks.' }
    }
    const supervisorScoped = ((membership as Record<string, unknown>).scoped_departments as string[] | null) ?? null
    if ((membership as Record<string, string>).cluster_role === 'supervisor' && supervisorScoped && supervisorScoped.length > 0) {
      const { data: targetUserRow } = await supabase.from('users').select('department').eq('username', targetUsername).single()
      const targetDept = ((targetUserRow as Record<string, string> | null)?.department ?? '').toLowerCase()
      if (!supervisorScoped.some((d) => d.toLowerCase() === targetDept)) {
        return { success: false, error: 'Supervisor cannot hold tasks for users outside their scoped departments.' }
      }
    }
  }

  const now = new Date().toISOString()
  const hallHours = await getClusterOfficeHours(supabase, clusterId)

  if (held) {
    const { data: activeTasks } = await supabase
      .from('todos')
      .select('id, scheduler_state, remaining_work_minutes, total_active_minutes, active_started_at')
      .eq('assigned_to', targetUsername)
      .eq('cluster_id', clusterId)
      .in('scheduler_state', ['active', 'user_queue', 'paused'])

    for (const t of (activeTasks ?? [])) {
      const task = t as Record<string, unknown>
      if (task.scheduler_state === 'active') {
        const activeStartedAt = task.active_started_at as string | null
        const workedMinutes = activeStartedAt ? getWorkMinutesInRange(activeStartedAt, now, hallHours) : 0
        const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
        const totalActive = (task.total_active_minutes as number | null) ?? 0
        await supabase.from('todos').update({
          scheduler_state: 'paused',
          task_status: 'todo',
          active_started_at: null,
          remaining_work_minutes: Math.max(0, storedRemaining - workedMinutes),
          total_active_minutes: totalActive + workedMinutes,
          updated_at: now,
        }).eq('id', task.id as string)
      }
    }

    await supabase
      .from('cluster_members')
      .update({ is_on_hold: true, held_by: user.username, held_at: now, updated_at: now })
      .eq('cluster_id', clusterId)
      .eq('username', targetUsername)

    await writeHallWorkLog(supabase, {
      todoId: 'system' as unknown as string,
      username: user.username,
      event: 'hold_applied',
      notes: `All tasks for ${targetUsername} put on hold by ${user.username}`,
      metadata: { target_username: targetUsername },
    })
  } else {
    await supabase
      .from('cluster_members')
      .update({ is_on_hold: false, held_by: null, held_at: null, updated_at: now })
      .eq('cluster_id', clusterId)
      .eq('username', targetUsername)

    await writeHallWorkLog(supabase, {
      todoId: 'system' as unknown as string,
      username: user.username,
      event: 'hold_released',
      notes: `Hold released for ${targetUsername} by ${user.username}`,
      metadata: { target_username: targetUsername },
    })

    await autoActivateNextTask(supabase, targetUsername, clusterId, null, hallHours)
  }

  revalidateTasksData()
  return { success: true }
}

/**
 * Get all cluster members with their hold status and current active/queued task counts.
 * Used by the management portal to show per-user hold controls.
 */
export async function getHallMembersWithStatusAction(
  clusterId: string,
): Promise<{
  success: boolean
  error?: string
  members?: Array<{
    username: string
    cluster_role: string
    is_on_hold: boolean
    held_by: string | null
    held_at: string | null
    active_tasks: number
    queued_tasks: number
    display_name: string | null
    avatar_data: string | null
  }>
}> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members')
      .select('cluster_role')
      .eq('cluster_id', clusterId)
      .eq('username', user.username)
      .single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only hall leadership can view member status.' }
    }
  }

  const { data: membersRaw, error: mErr } = await supabase
    .from('cluster_members')
    .select('username, cluster_role, is_on_hold, held_by, held_at')
    .eq('cluster_id', clusterId)
  if (mErr) return { success: false, error: mErr.message }

  const usernames = (membersRaw ?? []).map((m: Record<string, unknown>) => m.username as string)
  const { data: usersRaw } = await supabase
    .from('users').select('username, display_name, avatar_data').in('username', usernames)

  const { data: taskCounts } = await supabase
    .from('todos')
    .select('assigned_to, scheduler_state')
    .eq('cluster_id', clusterId)
    .in('assigned_to', usernames)
    .in('scheduler_state', ['active', 'user_queue', 'paused'])

  const userMap = new Map(
    (usersRaw ?? []).map((u: Record<string, unknown>) => [u.username as string, u])
  )
  const countMap = new Map<string, { active: number; queued: number }>()
  for (const t of (taskCounts ?? [])) {
    const tc = t as Record<string, unknown>
    const uname = tc.assigned_to as string
    if (!countMap.has(uname)) countMap.set(uname, { active: 0, queued: 0 })
    const entry = countMap.get(uname)!
    if (tc.scheduler_state === 'active') entry.active++
    else entry.queued++
  }

  const members = (membersRaw ?? []).map((m: Record<string, unknown>) => {
    const uname = m.username as string
    const uInfo = (userMap.get(uname) ?? {}) as Record<string, unknown>
    const counts = countMap.get(uname) ?? { active: 0, queued: 0 }
    return {
      username: uname,
      cluster_role: m.cluster_role as string,
      is_on_hold: (m.is_on_hold as boolean) ?? false,
      held_by: (m.held_by as string | null) ?? null,
      held_at: (m.held_at as string | null) ?? null,
      active_tasks: counts.active,
      queued_tasks: counts.queued,
      display_name: (uInfo.display_name as string | null) ?? null,
      avatar_data: (uInfo.avatar_data as string | null) ?? null,
    }
  })

  return { success: true, members }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforce single_active_task_per_user for a hall.
 * Called when the setting is turned ON.
 * For each user, keeps only their lowest-queue_rank task as 'active'
 * and moves all others to 'user_queue'.
 */
export async function enforceHallSingleActiveTaskAction(clusterId: string): Promise<void> {
  const supabase = createServerClient()

  const { data: activeTasks } = await supabase
    .from('todos')
    .select('id, assigned_to, queue_rank, active_started_at, remaining_work_minutes, total_active_minutes')
    .eq('cluster_id', clusterId)
    .eq('scheduler_state', 'active')
    .order('queue_rank', { ascending: true })

  if (!activeTasks || activeTasks.length === 0) return

  // Group by assignee
  const byUser: Record<string, Array<Record<string, unknown>>> = {}
  for (const t of activeTasks as Array<Record<string, unknown>>) {
    const u = t.assigned_to as string
    if (!byUser[u]) byUser[u] = []
    byUser[u].push(t)
  }

  const hallHours = await getClusterOfficeHours(supabase, clusterId)
  const now = new Date().toISOString()

  for (const [, tasks] of Object.entries(byUser)) {
    if (tasks.length <= 1) continue
    // Keep task at rank 1 (or lowest rank) active; move the rest to user_queue
    const sorted = tasks.sort((a, b) => (a.queue_rank as number ?? 999) - (b.queue_rank as number ?? 999))
    const keepActive = sorted[0]
    const toQueue = sorted.slice(1)

    for (const t of toQueue) {
      const activeStartedAt = t.active_started_at as string | null
      const workedMinutes = activeStartedAt
        ? getWorkMinutesInRange(activeStartedAt, now, hallHours)
        : 0
      const storedRemaining = (t.remaining_work_minutes as number | null) ?? 0
      const totalActive = (t.total_active_minutes as number | null) ?? 0
      const newRemaining = Math.max(0, storedRemaining - workedMinutes)

      await supabase.from('todos').update({
        scheduler_state: 'user_queue',
        active_started_at: null,
        task_status: 'todo',
        remaining_work_minutes: newRemaining,
        total_active_minutes: totalActive + workedMinutes,
        updated_at: now,
      }).eq('id', t.id as string)

      await writeHallWorkLog(supabase, {
        todoId: t.id as string,
        username: t.assigned_to as string,
        event: 'setting_enforced',
        minutesDeducted: workedMinutes,
        notes: `Moved to user_queue when single_active_task_per_user was enabled. Kept active: ${keepActive.id as string}`,
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all tasks in the hall inbox for a specific cluster.
 * Hall owners/managers/supervisors (explicit or dept-based) and admins can call this.
 */
export async function getHallInboxTasksAction(clusterId: string): Promise<Todo[]> {
  const user = await getSession()
  if (!user || !clusterId) return []

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  const supabase = createServerClient()

  if (!isAdmin) {
    const { data: membership } = await supabase
      .from('cluster_members').select('cluster_role')
      .eq('cluster_id', clusterId).eq('username', user.username).single()
    const hasExplicitRole = membership && ['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)
    if (!hasExplicitRole) {
      // Dept-based access: Manager/Supervisor whose dept belongs to this hall
      if (!['Manager', 'Supervisor', 'Super Manager'].includes(user.role)) return []
      const userDeptNames = splitDepartmentsCsv(user.department).filter(Boolean)
      if (userDeptNames.length === 0) return []
      const { data: matchedDepts } = await supabase.from('departments').select('id').in('name', userDeptNames)
      const deptIds = ((matchedDepts ?? []) as Array<{ id: string }>).map((d) => d.id)
      if (deptIds.length === 0) return []
      const { data: hallDept } = await supabase.from('cluster_departments').select('cluster_id')
        .eq('cluster_id', clusterId).in('department_id', deptIds).limit(1)
      if (!hallDept || hallDept.length === 0) return []
    }
  }
  const { data } = await supabase
    .from('todos')
    .select('*')
    .eq('cluster_id', clusterId)
    .eq('cluster_inbox', true)
    .order('created_at', { ascending: false })

  return (data ?? []) as Todo[]
}

/**
 * Get the hall scheduler tasks for a specific user: active + queued + paused + blocked.
 * Callable by the user themselves, their hall leader, or admin.
 */
export async function getHallSchedulerTasksForUserAction(
  clusterId: string,
  targetUsername: string
): Promise<Todo[]> {
  const user = await getSession()
  if (!user) return []

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin && user.username !== targetUsername) {
    const supabase = createServerClient()
    const { data: membership } = await supabase
      .from('cluster_members').select('cluster_role')
      .eq('cluster_id', clusterId).eq('username', user.username).single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return []
    }
  }

  const supabase = createServerClient()
  const { data } = await supabase
    .from('todos')
    .select('*')
    .eq('cluster_id', clusterId)
    .eq('assigned_to', targetUsername)
    .eq('completed', false)
    .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
    .order('queue_rank', { ascending: true })

  return (data ?? []) as Todo[]
}

/**
 * Get the hall work-log entries for a specific task.
 * Useful for the task detail view / audit trail.
 */
export async function getHallWorkLogsAction(todoId: string): Promise<HallTaskWorkLog[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const { data } = await supabase
    .from('hall_task_work_logs')
    .select('*')
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true })

  return (data ?? []) as HallTaskWorkLog[]
}

/**
 * Get all users with their scheduler queue for a given hall.
 * Hall leaders can use this for the team queue management view.
 */
export async function getHallTeamQueueAction(clusterId: string): Promise<Array<{
  username: string
  avatar_data: string | null
  tasks: Todo[]
}>> {
  const user = await getSession()
  if (!user || !clusterId) return []

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const supabase = createServerClient()
    const { data: membership } = await supabase
      .from('cluster_members').select('cluster_role, scoped_departments')
      .eq('cluster_id', clusterId).eq('username', user.username).single()
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return []
    }
  }

  const supabase = createServerClient()

  // Fetch single-assign scheduled tasks AND all MA (split_to_multi) tasks in this hall
  const [singleRes, maRes] = await Promise.all([
    supabase
      .from('todos')
      .select('*')
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked', 'waiting_review'])
      .order('queue_rank', { ascending: true }),
    supabase
      .from('todos')
      .select('*')
      .eq('cluster_id', clusterId)
      .eq('completed', false)
      .eq('workflow_state', 'split_to_multi'),
  ])

  // Group by assignee — single-assign tasks use assigned_to directly
  const byUser: Record<string, Todo[]> = {}
  for (const t of (singleRes.data ?? []) as Todo[]) {
    const u = t.assigned_to ?? 'unassigned'
    if (!byUser[u]) byUser[u] = []
    byUser[u].push(t)
  }

  // For MA tasks, project each assignee's per-user JSONB scheduler state
  // and add the projected task to that user's queue bucket
  const singleIds = new Set((singleRes.data ?? []).map((t: Record<string, unknown>) => t.id as string))
  for (const rawTask of (maRes.data ?? []) as Todo[]) {
    if (singleIds.has(rawTask.id)) continue // already in single-assign results
    const raw = rawTask as unknown as Record<string, unknown>
    const ma = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
    if (!ma?.enabled || !Array.isArray(ma.assignees)) continue
    for (const entry of ma.assignees) {
      const state = entry.hall_scheduler_state ?? 'user_queue'
      if (!['active', 'user_queue', 'paused', 'blocked', 'waiting_review'].includes(state)) continue
      const projected: Todo = {
        ...rawTask,
        scheduler_state: state,
        queue_rank: entry.hall_queue_rank ?? 9999,
        remaining_work_minutes: entry.hall_remaining_minutes ?? (
          entry.hall_estimated_hours ? Math.round(entry.hall_estimated_hours * 60) : null
        ),
        active_started_at: entry.hall_active_started_at ?? null,
        effective_due_at: entry.hall_effective_due_at ?? null,
        assigned_to: entry.username, // virtual projection for display
      } as Todo
      if (!byUser[entry.username]) byUser[entry.username] = []
      byUser[entry.username].push(projected)
    }
  }

  if (Object.keys(byUser).length === 0) return []

  // Sort each user's queue by rank
  for (const u of Object.keys(byUser)) {
    byUser[u].sort((a, b) => ((a.queue_rank as number | null) ?? 9999) - ((b.queue_rank as number | null) ?? 9999))
  }

  // Fetch avatar data for each user
  const usernames = Object.keys(byUser).filter((u) => u !== 'unassigned')
  const { data: userRows } = await supabase
    .from('users').select('username, avatar_data').in('username', usernames.length > 0 ? usernames : ['__none__'])
  const avatarMap: Record<string, string | null> = {}
  for (const row of (userRows ?? []) as Array<{ username: string; avatar_data: string | null }>) {
    avatarMap[row.username] = row.avatar_data
  }

  return usernames.map((username) => ({
    username,
    avatar_data: avatarMap[username] ?? null,
    tasks: byUser[username],
  }))
}

// ── Hall Assign Page helpers ──────────────────────────────────────────────────

export type PriorityNum = 1 | 2 | 3 | 4

export interface HallAssignMemberTask {
  id: string
  title: string
  priority: string
  priorityNum: PriorityNum
  task_status: string
  scheduler_state: string | null
  queue_rank: number | null
}

export interface HallAssignMember {
  username: string
  department: string | null
  totalTasks: number
  priorityCounts: Record<PriorityNum, number>
  activeTasks: HallAssignMemberTask[]
}

export interface HallAssignPageData {
  task: { id: string; title: string; requested_due_at: string | null; priority: string }
  clusterName: string
  members: HallAssignMember[]
  officeHours: { office_start: string; office_end: string; break_start: string; break_end: string; friday_break_start: string; friday_break_end: string }
  clusterTimezone: string
  currentUserRole: string
  currentUserDept: string | null
}

export async function getHallAssignPageData(taskId: string): Promise<HallAssignPageData | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = createServerClient()

  const { data: taskRow } = await supabase
    .from('todos')
    .select('id,title,requested_due_at,priority,cluster_id,cluster_inbox,scheduler_state')
    .eq('id', taskId)
    .single()
  if (!taskRow) return null

  const t = taskRow as Record<string, unknown>
  const clusterId = t.cluster_id as string | null
  if (!clusterId) return null

  // Auth: must be admin/SM or a hall owner/manager/supervisor (explicit or dept-based)
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const { data: mem } = await supabase
      .from('cluster_members').select('cluster_role')
      .eq('cluster_id', clusterId).eq('username', user.username).maybeSingle()
    const hasExplicitRole = mem && ['owner', 'manager', 'supervisor'].includes((mem as Record<string, string>).cluster_role)
    if (!hasExplicitRole) {
      // Dept-based access for Manager/Supervisor
      if (!['Manager', 'Supervisor', 'Super Manager'].includes(user.role)) return null
      const userDeptNames = splitDepartmentsCsv(user.department).filter(Boolean)
      if (userDeptNames.length === 0) return null
      const { data: matchedDepts } = await supabase.from('departments').select('id').in('name', userDeptNames)
      const deptIds = ((matchedDepts ?? []) as Array<{ id: string }>).map((d) => d.id)
      if (deptIds.length === 0) return null
      const { data: hallDept } = await supabase.from('cluster_departments').select('cluster_id')
        .eq('cluster_id', clusterId).in('department_id', deptIds).limit(1)
      if (!hallDept || hallDept.length === 0) return null
    }
  }

  const { data: clusterRow } = await supabase.from('clusters').select('name').eq('id', clusterId).single()
  const clusterName = (clusterRow as Record<string, string> | null)?.name ?? 'Hall'

  // Get all cluster members
  const { data: memberRows } = await supabase
    .from('cluster_members').select('username').eq('cluster_id', clusterId)
  const allMemberUsernames = ((memberRows ?? []) as Array<{ username: string }>).map((m) => m.username)

  // --- Filter members: show all hall members except self; Supervisors limited to their dept subordinates ---
  let filteredUsernames: string[]
  const isManager = user.role === 'Manager'
  if (isAdmin || isManager) {
    // Admin/SM/Manager: all cluster members except themselves
    filteredUsernames = allMemberUsernames.filter((u) => u.toLowerCase() !== user.username.toLowerCase())
  } else {
    // Supervisor: only cluster members who are their direct reports
    const [subordinateRes, myRowRes] = await Promise.all([
      supabase.from('users').select('username').ilike('manager_id', `%${user.username}%`),
      supabase.from('users').select('team_members').eq('username', user.username).single(),
    ])
    const subordinateSet = new Set(
      ((subordinateRes.data ?? []) as Array<{ username: string }>).map((r) => r.username.toLowerCase())
    )
    // Also include explicit team_members field from current user's row
    String((myRowRes.data as Record<string, unknown> | null)?.team_members ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((m) => subordinateSet.add(m))

    filteredUsernames = allMemberUsernames.filter(
      (u) => u.toLowerCase() !== user.username.toLowerCase() && subordinateSet.has(u.toLowerCase())
    )
  }

  // Get user info for departments
  const { data: userInfoRows } = await supabase
    .from('users').select('username,department').in('username', filteredUsernames)
  const deptMap: Record<string, string | null> = {}
    ; ((userInfoRows ?? []) as Array<{ username: string; department: string | null }>).forEach((u) => {
      deptMap[u.username] = u.department
    })

  // Get active/queued tasks for each filtered member
  const { data: memberTasks } = await supabase
    .from('todos')
    .select('id,title,priority,task_status,scheduler_state,assigned_to,queue_rank')
    .eq('cluster_id', clusterId)
    .eq('completed', false)
    .eq('archived', false)
    .in('assigned_to', filteredUsernames)
    .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])

  const _priorityNumMap: Record<string, PriorityNum> = { low: 1, medium: 2, high: 3, urgent: 4 }
  const tasksByMember: Record<string, HallAssignMemberTask[]> = {}
  for (const r of ((memberTasks ?? []) as Array<Record<string, unknown>>)) {
    const uname = r.assigned_to as string
    if (!tasksByMember[uname]) tasksByMember[uname] = []
    const pStr = (r.priority as string) ?? 'medium'
    tasksByMember[uname].push({
      id: r.id as string,
      title: r.title as string,
      priority: pStr,
      priorityNum: _priorityNumMap[pStr] ?? 2,
      task_status: r.task_status as string,
      scheduler_state: r.scheduler_state as string | null,
      queue_rank: (r.queue_rank as number | null) ?? null,
    })
  }

  const members: HallAssignMember[] = filteredUsernames.map((username) => {
    const tasks = (tasksByMember[username] ?? []).sort((a, b) => (a.queue_rank ?? 999) - (b.queue_rank ?? 999))
    const priorityCounts: Record<PriorityNum, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
    tasks.forEach((t2) => { priorityCounts[t2.priorityNum] = (priorityCounts[t2.priorityNum] ?? 0) + 1 })
    return {
      username,
      department: deptMap[username] ?? null,
      totalTasks: tasks.length,
      priorityCounts,
      activeTasks: tasks,
    }
  })

  const officeHours = await getClusterOfficeHours(supabase, clusterId)

  return {
    task: {
      id: t.id as string,
      title: t.title as string,
      requested_due_at: (t.requested_due_at as string | null) ?? null,
      priority: (t.priority as string) ?? 'medium',
    },
    clusterName,
    members,
    officeHours,
    clusterTimezone: 'Asia/Karachi',
    currentUserRole: user.role,
    currentUserDept: user.department ?? null,
  }
}

// ── Edit Assignee Page ────────────────────────────────────────────────────────

export interface EditAssigneePageData {
  taskId: string
  title: string
  assignedTo: string
  actualDueDate: string | null
  stepNote: string | null
  isHallTask: boolean
  officeHours: { office_start: string; office_end: string; break_start: string; break_end: string; friday_break_start: string; friday_break_end: string }
  stepOwner: string | null
  availableUsers: Array<{ username: string; role: string; department: string | null }>
}

export async function getEditAssigneePageData(taskId: string): Promise<EditAssigneePageData | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = createServerClient()
  const { data } = await supabase
    .from('todos')
    .select('id,title,assigned_to,actual_due_date,effective_due_at,assignment_chain,cluster_id,workflow_state,completed,approval_status')
    .eq('id', taskId)
    .single()
  if (!data) return null

  const task = data as Record<string, unknown>
  if ((task.completed as boolean) === true) return null

  const assignedTo = (task.assigned_to as string | null) ?? ''
  if (!assignedTo) return null

  const chain = parseJson<AssignmentChainEntry[]>(task.assignment_chain, [])
  const stepOwner = findAssignmentStepOwner(task, assignedTo)

  // Only step owner or admin can access
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin && (stepOwner || '').toLowerCase() !== user.username.toLowerCase()) return null

  const isHallTask =
    !!task.cluster_id && task.workflow_state === 'claimed_by_department'
  const clusterId = isHallTask ? (task.cluster_id as string) : null
  const officeHours = await getClusterOfficeHours(supabase, clusterId)

  // Fetch available users for reassignment (cluster members for hall tasks, otherwise dept)
  let availableUsers: Array<{ username: string; role: string; department: string | null }> = []
  if (isHallTask && clusterId) {
    const { data: members } = await supabase
      .from('cluster_members')
      .select('username')
      .eq('cluster_id', clusterId)
    if (members) {
      const memberNames = (members as Array<{ username: string }>).map((m) => m.username)
      const { data: userRows } = await supabase
        .from('users')
        .select('username,role,department')
        .in('username', memberNames)
        .order('username')
      availableUsers = (userRows || []) as Array<{ username: string; role: string; department: string | null }>
    }
  } else {
    const { data: userRows } = await supabase
      .from('users')
      .select('username,role,department')
      .order('username')
    availableUsers = (userRows || []) as Array<{ username: string; role: string; department: string | null }>
  }

  // Find step note from assignment chain
  const stepEntry = [...chain].reverse().find(
    (e) => (e.next_user || '').toLowerCase() === assignedTo.toLowerCase()
  )
  const stepNote = stepEntry?.feedback ?? null

  return {
    taskId,
    title: task.title as string,
    assignedTo,
    // For hall tasks, effective_due_at is the office-hours-correct due date; prefer it
    actualDueDate: ((task.effective_due_at || task.actual_due_date) as string | null) ?? null,
    stepNote,
    isHallTask,
    officeHours,
    stepOwner,
    availableUsers,
  }
}

/** Removes the current assignee from a hall-scheduled task, returning it to hall inbox. */
export async function removeHallTaskAssigneeAction(
  todoId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('username,assigned_to,task_status,completed,cluster_id,workflow_state,history,assignment_chain,scheduler_state')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  if ((task.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  const clusterId = task.cluster_id as string | null

  if (!isAdmin) {
    // Only hall managers/supervisors/owners or the step owner can do this
    const assignedTo = (task.assigned_to as string | null) ?? ''
    const stepOwner = findAssignmentStepOwner(task, assignedTo)
    const isStepOwner = (stepOwner || '').toLowerCase() === user.username.toLowerCase()
    if (!isStepOwner) {
      // Check cluster role
      if (clusterId) {
        const { data: mem } = await supabase
          .from('cluster_members').select('cluster_role')
          .eq('cluster_id', clusterId).eq('username', user.username).single()
        if (!mem || !['owner', 'manager', 'supervisor'].includes((mem as Record<string, string>).cluster_role)) {
          return { success: false, error: 'Only the assigning manager or hall owner can remove this assignee.' }
        }
      } else {
        return { success: false, error: 'Not authorized to remove this assignee.' }
      }
    }
  }

  const now = new Date().toISOString()
  const history = parseJson<HistoryEntry[]>(task.history, [])
  const removedUser = task.assigned_to as string

  history.push({
    type: 'edit',
    user: user.username,
    details: `${user.username} removed ${removedUser} from task assignment.`,
    timestamp: now,
    icon: '🔄',
    title: 'Assignee Removed',
  })

  const isHallTask = !!clusterId && task.workflow_state === 'claimed_by_department'

  const updatePayload: Record<string, unknown> = {
    assigned_to: null,
    history: JSON.stringify(history),
    updated_at: now,
  }

  if (isHallTask) {
    // Return to cluster hall inbox
    updatePayload.cluster_inbox = true
    updatePayload.queue_status = 'cluster_inbox'
    updatePayload.task_status = 'backlog'
    updatePayload.scheduler_state = 'hall_inbox'
    updatePayload.workflow_state = 'in_cluster_inbox'
    updatePayload.active_started_at = null
    updatePayload.effective_due_at = null
    updatePayload.queue_rank = null
    updatePayload.manager_id = null
  } else {
    // Regular task — just unassign
    updatePayload.task_status = 'backlog'
    updatePayload.queue_status = null
  }

  await supabase.from('todos').update(updatePayload).eq('id', todoId)

  if (isHallTask) {
    await writeHallWorkLog(supabase, {
      todoId,
      username: user.username,
      event: 'unassigned',
      notes: `${user.username} removed ${removedUser} from task, returned to hall inbox.`,
    })
  }

  revalidateTasksData()
  return { success: true }
}

export async function updateTaskPriorityAction(
  taskId: string,
  priorityNum: PriorityNum,
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const isManager = user.role === 'Admin' || user.role === 'Super Manager' || user.role === 'Manager' || user.role === 'Supervisor'
  if (!isManager) return { success: false, error: 'Only managers can change task priorities.' }

  const _numPriorityMap: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' }
  const priority = _numPriorityMap[priorityNum]
  if (!priority) return { success: false, error: 'Invalid priority number.' }

  const supabase = createServerClient()
  const { error } = await supabase.from('todos').update({ priority, updated_at: new Date().toISOString() }).eq('id', taskId)
  if (error) return { success: false, error: error.message }

  revalidateTasksData()
  return { success: true }
}

// ─── Hall Cross-Department Routing ──────────────────────────────────────────

export type RouteClusterPageData = {
  task: {
    id: string
    title: string
    cluster_id: string
    cluster_name: string
    cluster_inbox: boolean
    creator_username: string
    due_date: string | null
    queue_department: string | null
  }
  availableDepartments: { name: string }[]
}

export async function getRouteClusterPageData(taskId: string): Promise<RouteClusterPageData | null> {
  const user = await getSession()
  if (!user) return null
  const supabase = createServerClient()

  // 1. Get the task + its hall context
  const { data: taskRow } = await supabase
    .from('todos')
    .select('id,title,cluster_id,cluster_inbox,username,due_date,expected_due_date,effective_due_at,queue_department')
    .eq('id', taskId)
    .single()
  if (!taskRow) return null
  const t = taskRow as {
    id: string
    title: string
    cluster_id: string | null
    cluster_inbox: boolean | null
    username: string | null
    due_date: string | null
    expected_due_date: string | null
    effective_due_at: string | null
    queue_department: string | null
  }
  if (!t.cluster_id) return null

  // 2. Get current hall name
  const { data: clusterRow } = await supabase
    .from('clusters')
    .select('name')
    .eq('id', t.cluster_id)
    .single()
  const clusterName = (clusterRow as Record<string, string> | null)?.name ?? ''

  // 3. Get departments linked to this hall only.
  const { data: hallDepts } = await supabase
    .from('cluster_departments')
    .select('departments(name)')
    .eq('cluster_id', t.cluster_id)
  const creatorUsername = String(t.username || '').trim()
  const currentQueueDepartment = String(t.queue_department || '').trim()

  const availableDepartments = Array.from(
    new Set(
      ((hallDepts ?? []) as Array<Record<string, unknown>>)
        .map((row) => (row.departments as Record<string, string> | null)?.name ?? '')
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => name.toLowerCase() !== creatorUsername.toLowerCase())
        .filter((name) => name.toLowerCase() !== currentQueueDepartment.toLowerCase())
    )
  )
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name }))

  return {
    task: {
      id: t.id,
      title: t.title,
      cluster_id: t.cluster_id,
      cluster_name: clusterName,
      cluster_inbox: Boolean(t.cluster_inbox),
      creator_username: creatorUsername,
      due_date: t.effective_due_at || t.due_date || t.expected_due_date || null,
      queue_department: currentQueueDepartment || null,
    },
    availableDepartments,
  }
}

/** @deprecated Use getRouteClusterPageData instead */
export async function getAvailableClustersForRoutingAction(
  excludeClusterId?: string | null
): Promise<{ id: string; name: string }[]> {
  const user = await getSession()
  if (!user) return []
  const supabase = createServerClient()
  const { data } = await supabase.from('clusters').select('id,name').order('name')
  if (!data) return []
  return (data as Array<{ id: string; name: string }>).filter((c) => !excludeClusterId || c.id !== excludeClusterId)
}

export async function routeHallTaskToClusterAction(
  taskId: string,
  destClusterId: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  const supabase = createServerClient()

  const { data: taskRow } = await supabase
    .from('todos')
    .select('id,title,cluster_id,completed,history,assignment_chain')
    .eq('id', taskId)
    .single()
  if (!taskRow) return { success: false, error: 'Task not found.' }

  const t = taskRow as Record<string, unknown>
  if ((t.completed as boolean) === true) return { success: false, error: 'Task is already completed.' }

  // Get destination cluster name
  const { data: destCluster } = await supabase.from('clusters').select('name').eq('id', destClusterId).single()
  const destName = (destCluster as Record<string, string> | null)?.name ?? 'Hall'

  const now = new Date().toISOString()
  const history: unknown[] = Array.isArray(t.history) ? [...(t.history as unknown[])] : []
  history.push({
    action: 'routed_to_hall',
    by: user.username,
    at: now,
    note: note || null,
    dest: destName,
  })
  const assignmentChain: unknown[] = Array.isArray(t.assignment_chain) ? [...(t.assignment_chain as unknown[])] : []
  assignmentChain.push({ role: 'sent_to_hall', user: user.username, assignedAt: now, next_user: destName })

  const { error } = await supabase.from('todos').update({
    cluster_id: destClusterId,
    cluster_inbox: true,
    workflow_state: 'queued_cluster',
    queue_status: 'cluster_inbox',
    assigned_to: null,
    task_status: 'backlog',
    scheduler_state: null,
    queue_rank: null,
    history: JSON.stringify(history),
    assignment_chain: JSON.stringify(assignmentChain),
    updated_at: now,
  }).eq('id', taskId)
  if (error) return { success: false, error: error.message }

  // Notify new cluster managers
  const { data: destMembers } = await supabase
    .from('cluster_members')
    .select('username')
    .eq('cluster_id', destClusterId)
    .in('cluster_role', ['owner', 'manager', 'supervisor'])
  if (destMembers && (destMembers as Array<{ username: string }>).length > 0) {
    await notifyUsers(
      supabase,
      (destMembers as Array<{ username: string }>).map((m) => m.username),
      {
        type: 'task_cluster_inbox',
        title: `New Task in ${destName} Hall`,
        body: `${user.username} routed a task to your Hall inbox: "${t.title as string}"`,
        relatedId: taskId,
      },
      user.username,
    )
  }

  revalidateTasksData()
  return { success: true }
}


// -- Queue Priority Page -------------------------------------------------------

export interface QueuePriorityData {
  clusterId: string
  clusterName: string
  isManager: boolean
  /** Manager view: all active/queued tasks per team member. */
  teamQueues: Array<{ username: string; avatar_data: string | null; tasks: Todo[] }>
  /** Personal view: current user's own tasks. */
  myTasks: Todo[]
  hallHours: HallOfficeHours
}

/**
 * Fetches queue priority data for /dashboard/tasks/queue-priority.
 * - Admins / Super Managers / Managers / hall owners/managers/supervisors get full team queues.
 * - Regular users get only their own queue.
 */
export async function getQueuePriorityAction(): Promise<QueuePriorityData | null> {
  const user = await getSession()
  if (!user || user.clusterIds.length === 0) return null

  const clusterId = user.clusterIds[0]
  const supabase = createServerClient()

  const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
  const isManagerRole = user.role === 'Manager'

  let canSeeTeam = isAdminOrSM || isManagerRole
  if (!canSeeTeam) {
    const { data: mem } = await supabase
      .from('cluster_members').select('cluster_role')
      .eq('cluster_id', clusterId).eq('username', user.username).maybeSingle()
    if (mem && ['owner', 'manager', 'supervisor'].includes((mem as Record<string, string>).cluster_role)) {
      canSeeTeam = true
    }
  }

  const [clusterRes, hallHours] = await Promise.all([
    supabase.from('clusters').select('name').eq('id', clusterId).single(),
    getClusterOfficeHours(supabase, clusterId),
  ])
  const clusterName = (clusterRes.data as Record<string, string> | null)?.name ?? 'Hall'

  // Always fetch personal tasks — completed = false to exclude finished tasks
  // Fetch regular scheduled tasks + ALL incomplete MA tasks in parallel.
  // JSONB .contains() (@>) can silently fail when data is stored via JSON.stringify()
  // (double-encoding produces a jsonb string rather than a jsonb object).  Instead of
  // relying on database-side containment, we fetch all split_to_multi tasks and filter
  // for the current user in JavaScript — this is bulletproof regardless of encoding.
  const [myDataRes, allMaRes] = await Promise.all([
    supabase
      .from('todos').select('*')
      .eq('cluster_id', clusterId)
      .eq('assigned_to', user.username)
      .eq('completed', false)
      .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked', 'waiting_review'])
      .order('queue_rank', { ascending: true }),
    supabase
      .from('todos').select('*')
      .eq('completed', false)
      .eq('workflow_state', 'split_to_multi'),
  ])

  // Filter MA tasks for the current user in JavaScript (handles both jsonb objects
  // and double-encoded jsonb strings transparently via parseJson).
  // For each MA task, project the per-user hall scheduler state so the queue-priority
  // view renders the correct state badge, time estimate, and ordering.
  const userLower = user.username.toLowerCase()
  const myMaTasks: Todo[] = ((allMaRes.data ?? []) as Todo[])
    .filter((t) => {
      const raw = t as unknown as Record<string, unknown>
      const ma = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
      if (ma?.enabled && Array.isArray(ma.assignees) &&
          ma.assignees.some((a) => a.username.toLowerCase() === userLower)) return true
      const chain = parseJson<AssignmentChainEntry[]>(raw.assignment_chain, [])
      if (Array.isArray(chain) &&
          chain.some((e) => (e.next_user ?? '').toLowerCase() === userLower)) return true
      return false
    })
    .map((t) => {
      const raw = t as unknown as Record<string, unknown>
      const ma = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
      const myEntry = ma?.assignees?.find((a) => a.username.toLowerCase() === userLower)
      if (!myEntry) return t
      // Derive effective scheduler_state from per-user JSONB fields, falling back
      // to the MA status field so existing tasks without hall_scheduler_state still display properly.
      let projectedState: string
      if (myEntry.hall_scheduler_state) {
        projectedState = myEntry.hall_scheduler_state
      } else if (myEntry.status === 'in_progress') {
        projectedState = 'active'
      } else if (myEntry.status === 'completed') {
        projectedState = 'completed'
      } else {
        projectedState = 'user_queue'
      }
      const projectedRemaining = myEntry.hall_remaining_minutes ?? (
        myEntry.hall_estimated_hours ? Math.round(myEntry.hall_estimated_hours * 60) : null
      )
      // Place MA tasks after regular tasks unless they have an explicit rank
      const projectedRank = myEntry.hall_queue_rank ?? 9999
      return {
        ...t,
        scheduler_state: projectedState,
        queue_rank: projectedRank,
        remaining_work_minutes: projectedRemaining,
        active_started_at: myEntry.hall_active_started_at ?? null,
        effective_due_at: myEntry.hall_effective_due_at ?? null,
        approval_status: myEntry.ma_approval_status ?? t.approval_status,
        pending_approver: myEntry.ma_pending_approver ?? t.pending_approver,
      } as Todo
    })

  const myDataArr = (myDataRes.data ?? []) as Todo[]
  const myDataIds = new Set(myDataArr.map((t) => t.id))
  // Merge regular + MA tasks and sort by queue_rank so the combined queue is ordered correctly
  const myTasks: Todo[] = [
    ...myDataArr,
    ...myMaTasks.filter((ma) => !myDataIds.has(ma.id)),
  ].sort((a, b) => {
    const ra = (a.queue_rank as number | null) ?? 9999
    const rb = (b.queue_rank as number | null) ?? 9999
    return ra - rb
  })

  if (!canSeeTeam) {
    return { clusterId, clusterName, isManager: false, teamQueues: [], myTasks, hallHours }
  }

  const teamQueues = await getHallTeamQueueAction(clusterId)
  return { clusterId, clusterName, isManager: true, teamQueues, myTasks, hallHours }
}
