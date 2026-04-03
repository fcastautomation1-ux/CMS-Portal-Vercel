'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
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
  'effective_due_at',
].join(',')

const SIDEBAR_TASK_SELECT = 'id,username,assigned_to,completed_by,completed,task_status,due_date,archived,queue_status,queue_department,multi_assignment,scheduler_state,effective_due_at'

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

  ;((ownedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r))
  ;((assignedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_assigned_to_me: true }))
  ;((completedByRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_completed_by_me: true }))
  ;((pendingApproverRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_chain_member: true }))
  {
    const deptRows = (deptQueueRes as { data: Record<string, unknown>[] | null }).data || []
    // For regular Users, check cluster_settings.allow_dept_users_see_queue for Hall-routed tasks
    let blockedClusterIds = new Set<string>()
    if (!canViewAllQueues && user.role === 'User') {
      const hallClusterIds = [...new Set(
        deptRows
          .map((r) => r.cluster_id as string | null)
          .filter((id): id is string => !!id)
      )]
      if (hallClusterIds.length > 0) {
        const { data: settingsRows } = await supabase
          .from('cluster_settings')
          .select('cluster_id,allow_dept_users_see_queue')
          .in('cluster_id', hallClusterIds)
        ;(settingsRows || []).forEach((s: Record<string, unknown>) => {
          if (!s.allow_dept_users_see_queue) {
            blockedClusterIds.add(s.cluster_id as string)
          }
        })
      }
    }
    deptRows.forEach((r) => {
      if (canViewAllQueues) {
        addTask(r, { is_department_queue: true })
        return
      }
      // Block User-role from viewing Hall dept queue tasks when setting disallows it
      if (user.role === 'User' && r.cluster_id && blockedClusterIds.has(r.cluster_id as string)) {
        return
      }
      const queueDept = String(r.queue_department || '')
      const queueDeptKey = canonicalDepartmentKey(queueDept)
      if (userDeptKeys.length === 0 || (queueDeptKey && userDeptKeys.includes(queueDeptKey))) {
        addTask(r, { is_department_queue: true })
      }
    })
  }

  ;((managedDataRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    const managers = String(r.manager_id || '').split(',').map((m) => m.trim().toLowerCase())
    if (managers.includes(user.username.toLowerCase())) {
      addTask(r, { is_managed: true })
    }
  })

  ;((teamCreatedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_team_task: true }))
  ;((teamAssignedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_team_task: true }))

  // Shared tasks — sequential because IDs come from the mega-batch sharedRes
  const sharedIds = (sharedRes.data || [])
    .map((s: Record<string, unknown>) => s.todo_id as string)
    .filter((id: string) => !taskIds.has(id))
  if (sharedIds.length > 0) {
    const { data: sharedTasks } = await supabase.from('todos').select(TASK_LIST_SELECT).eq('archived', false).in('id', sharedIds)
    ;((sharedTasks || []) as unknown as Record<string, unknown>[]).forEach((r) => addTask(r, { is_shared: true }))
  }

  ;((maAssigneeRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    addTask(r, { is_multi_assigned: true })
  })
  ;((maDelegatedRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    addTask(r, { is_multi_assigned: true, is_delegated_to_me: true })
  })
  ;((chainMemberRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    addTask(r, { is_chain_member: true })
  })
  ;((chainAssigneeRes.data || []) as unknown as Record<string, unknown>[]).forEach((r) => {
    addTask(r, { is_chain_member: true })
  })

  // Cluster inbox — sequential because cluster IDs come from the mega-batch clusterMembershipsRes
  {
    const clusterIds = (clusterMembershipsRes.data || []).map((m: Record<string, unknown>) => m.cluster_id as string).filter(Boolean)
    if (clusterIds.length > 0) {
      const { data: inboxTasks } = await supabase
        .from('todos')
        .select(TASK_LIST_SELECT)
        .eq('archived', false)
        .eq('cluster_inbox', true)
        .in('cluster_id', clusterIds)
      ;((inboxTasks || []) as unknown as Record<string, unknown>[]).forEach((r) => {
        addTask(r, { is_cluster_inbox: true })
      })
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

  if (deptQueueRes.data) {
    deptQueueRes.data.forEach((r: any) => {
      const qDept = canonicalDepartmentKey(r.queue_department || '')
      if (qDept && userDeptKeys.includes(qDept)) uniqueMap.set(r.id, r)
    })
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

/** Use in server components (page.tsx) for initial load. Keep this uncached because
 * task visibility is user-specific and changes immediately during handoff/approval flows.
 */
export async function getCachedTodos(): Promise<Todo[]> {
  return getTodos()
}

/** Direct wrapper — unstable_cache cannot be used here because getSidebarTaskCounts reads cookies() internally. React Query staleTime handles client-side caching. */
export async function getCachedSidebarTaskCounts(): Promise<SidebarTaskCounts> {
  return getSidebarTaskCounts()
}

/** Bust the tasks server-side cache and revalidate the page. Call after any mutation. */
function revalidateTasksData() {
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

  const isEdit = Boolean(input.id)

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
    .select('username,assigned_to,multi_assignment,history,title,assignment_chain')
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
      ;(a.delegated_to || []).forEach((sub) => { if (sub.username) commentParticipants.add(sub.username) })
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
  ;(allDepartments || []).forEach((d) => {
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
  ;(usersData || []).forEach((u: any) => {
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
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only cluster owners, managers, or supervisors can assign cluster inbox tasks.' }
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
    office_start:       (data as Record<string, string>).office_start       ?? '09:00',
    office_end:         (data as Record<string, string>).office_end         ?? '18:00',
    break_start:        (data as Record<string, string>).break_start        ?? '13:00',
    break_end:          (data as Record<string, string>).break_end          ?? '14:00',
    friday_break_start: (data as Record<string, string>).friday_break_start ?? '12:30',
    friday_break_end:   (data as Record<string, string>).friday_break_end   ?? '14:30',
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
    single_active_task_per_user: (row.single_active_task_per_user as boolean) ?? false,
    auto_start_next_task: (row.auto_start_next_task as boolean) ?? true,
    require_pause_reason: (row.require_pause_reason as boolean) ?? false,
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
    single_active_task_per_user?: boolean
    auto_start_next_task?: boolean
    require_pause_reason?: boolean
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
  if (settings.allow_dept_users_see_queue !== undefined)  payload.allow_dept_users_see_queue  = settings.allow_dept_users_see_queue
  if (settings.single_active_task_per_user !== undefined) payload.single_active_task_per_user = settings.single_active_task_per_user
  if (settings.auto_start_next_task !== undefined)        payload.auto_start_next_task        = settings.auto_start_next_task
  if (settings.require_pause_reason !== undefined)        payload.require_pause_reason        = settings.require_pause_reason

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
  require_pause_reason: boolean
}> {
  const { data } = await supabase
    .from('cluster_settings')
    .select('single_active_task_per_user, auto_start_next_task, require_pause_reason')
    .eq('cluster_id', clusterId)
    .single()
  const row = (data ?? {}) as Record<string, unknown>
  return {
    single_active_task_per_user: (row.single_active_task_per_user as boolean) ?? false,
    auto_start_next_task:        (row.auto_start_next_task as boolean)        ?? true,
    require_pause_reason:        (row.require_pause_reason as boolean)        ?? false,
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
  if (!candidates || candidates.length === 0) return null

  const next = candidates[0] as Record<string, unknown>
  const nextId = next.id as string
  const now = new Date().toISOString()
  const storedRemaining = (next.remaining_work_minutes as number | null) ?? null

  // Calculate effective_due_at from now
  const effectiveDueAt = storedRemaining != null && storedRemaining > 0
    ? calculateEffectiveDueAt(now, storedRemaining, hallHours).toISOString()
    : null

  const wasResumed = (next.scheduler_state as string) === 'paused'

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
    .select('username,cluster_id,cluster_inbox,task_status,completed,approval_status,title,history,assignment_chain,scheduler_state')
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
    if (!membership || !['owner', 'manager', 'supervisor'].includes((membership as Record<string, string>).cluster_role)) {
      return { success: false, error: 'Only hall owners, managers, or supervisors can assign hall tasks.' }
    }
    callerRole = (membership as Record<string, string>).cluster_role

    // Supervisor scope check
    if (callerRole === 'supervisor') {
      const scopedDepts = ((membership as Record<string, unknown>).scoped_departments as string[] | null) ?? []
      if (scopedDepts.length > 0) {
        const { data: targetUser } = await supabase
          .from('users')
          .select('department')
          .eq('username', toUsername)
          .single()
        if (!targetUser) return { success: false, error: 'Target user not found.' }
        const targetDept = ((targetUser as Record<string, string>).department ?? '').toLowerCase()
        const inScope = scopedDepts.some((d) => d.toLowerCase() === targetDept)
        if (!inScope) {
          return { success: false, error: 'As a supervisor, you can only assign to users in your scoped departments.' }
        }
      }
    }
  }

  const estimatedWorkMinutes = Math.round(estimatedHours * 60)
  const settings = await getHallSettingsForTask(supabase, clusterId)
  const hallHours = await getClusterOfficeHours(supabase, clusterId)
  const now = new Date().toISOString()

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

/**
 * Manually activate a task that is in user_queue or paused state.
 * Used when auto_start_next_task is OFF, or for manually resuming a paused task.
 * Only the task assignee, their manager, or a hall leader may call this.
 */
export async function activateHallTaskAction(todoId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = createServerClient()
  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, remaining_work_minutes, history')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const state = task.scheduler_state as string | null
  if (!['user_queue', 'paused'].includes(state ?? '')) {
    return { success: false, error: `Cannot activate a task in state "${state}".` }
  }

  const assignedTo = task.assigned_to as string | null
  const clusterId  = task.cluster_id  as string | null
  const isAdmin    = user.role === 'Admin' || user.role === 'Super Manager'

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

  // If this user already has an active task in this cluster, refuse
  if (assignedTo && clusterId) {
    const settings = await getHallSettingsForTask(supabase, clusterId)
    if (settings.single_active_task_per_user) {
      const { data: activeCheck } = await supabase
        .from('todos')
        .select('id')
        .eq('assigned_to', assignedTo)
        .eq('cluster_id', clusterId)
        .eq('completed', false)
        .eq('scheduler_state', 'active')
        .neq('id', todoId)
        .limit(1)
      if (activeCheck && activeCheck.length > 0) {
        return { success: false, error: 'User already has an active task. Complete or block it first.' }
      }
    }
  }

  const now = new Date().toISOString()
  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const hallHours = clusterId ? await getClusterOfficeHours(supabase, clusterId) : DEFAULT_OFFICE_HOURS
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
 *  - If require_pause_reason is ON, a reason is required.
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

  const settings = await getHallSettingsForTask(supabase, clusterId)

  if (settings.require_pause_reason && !reason?.trim()) {
    return { success: false, error: 'A pause reason is required for this hall.' }
  }

  // Check if there are other queued tasks — required for a simple pause
  const { data: otherQueued } = await supabase
    .from('todos')
    .select('id')
    .eq('assigned_to', assignedTo)
    .eq('cluster_id', clusterId)
    .in('scheduler_state', ['user_queue', 'paused'])
    .neq('id', todoId)
    .limit(1)

  const hasOtherQueued = (otherQueued ?? []).length > 0
  if (!hasOtherQueued) {
    return {
      success: false,
      error: 'No queued tasks to hand off to. Use "Mark as Blocked" with a reason instead.',
    }
  }

  // Calculate worked minutes since activation
  const activeStartedAt = task.active_started_at as string | null
  const hallHours = await getClusterOfficeHours(supabase, clusterId)
  const workedMinutes = activeStartedAt
    ? getWorkMinutesInRange(activeStartedAt, new Date().toISOString(), hallHours)
    : 0

  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const totalActive     = (task.total_active_minutes   as number | null) ?? 0
  const newRemaining    = Math.max(0, storedRemaining - workedMinutes)
  const newTotal        = totalActive + workedMinutes

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

  // Pause the task, keeping its queue_rank intact
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

  // Auto-start the next candidate task (excludes the just-paused task)
  if (settings.auto_start_next_task) {
    await autoActivateNextTask(supabase, assignedTo, clusterId, todoId, hallHours)
  }

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

  // Deduct worked minutes if task was active
  let workedMinutes = 0
  if (state === 'active') {
    const activeStartedAt = task.active_started_at as string | null
    if (activeStartedAt) {
      workedMinutes = getWorkMinutesInRange(activeStartedAt, new Date().toISOString(), hallHours)
    }
  }

  const storedRemaining = (task.remaining_work_minutes as number | null) ?? 0
  const totalActive     = (task.total_active_minutes   as number | null) ?? 0
  const newRemaining    = Math.max(0, storedRemaining - workedMinutes)
  const newTotal        = totalActive + workedMinutes

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

  // Try to activate next queued task
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
  const clusterId  = task.cluster_id  as string | null
  const isAdmin    = user.role === 'Admin' || user.role === 'Super Manager'

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
  const { data: existing } = await supabase
    .from('todos')
    .select('assigned_to, cluster_id, scheduler_state, active_started_at, remaining_work_minutes, total_active_minutes, history, title')
    .eq('id', todoId)
    .single()
  if (!existing) return { success: false, error: 'Task not found.' }

  const task = existing as Record<string, unknown>
  const state = task.scheduler_state as string | null

  if (!state || !['active', 'user_queue', 'paused'].includes(state)) {
    return { success: false, error: `Cannot complete a task in state "${state ?? 'unknown'}".` }
  }

  const assignedTo = task.assigned_to as string | null
  const isAdmin    = user.role === 'Admin' || user.role === 'Super Manager'
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
  const newTotal    = totalActive + workedMinutes
  const now         = new Date().toISOString()

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

  // Verify all IDs belong to this user and cluster
  const { data: queuedTasks } = await supabase
    .from('todos')
    .select('id, scheduler_state, queue_rank')
    .eq('assigned_to', targetUsername)
    .eq('cluster_id', clusterId)
    .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])

  const ownedIds = new Set((queuedTasks ?? []).map((t: Record<string, unknown>) => t.id as string))
  const invalid  = orderedTodoIds.filter((id) => !ownedIds.has(id))
  if (invalid.length > 0) {
    return { success: false, error: `Task IDs not found in this user's queue: ${invalid.join(', ')}` }
  }

  // Apply new ranks; active task always stays at rank 1
  const updates: Array<PromiseLike<unknown>> = []
  orderedTodoIds.forEach((id, index) => {
    const task = (queuedTasks ?? []).find((t: Record<string, unknown>) => t.id === id) as Record<string, unknown> | undefined
    // Active tasks cannot be reordered past rank 1
    const newRank = task?.scheduler_state === 'active' ? 1 : index + 1
    updates.push(
      supabase.from('todos').update({ queue_rank: newRank, updated_at: new Date().toISOString() }).eq('id', id) as unknown as PromiseLike<unknown>
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
    const toQueue    = sorted.slice(1)

    for (const t of toQueue) {
      const activeStartedAt = t.active_started_at as string | null
      const workedMinutes = activeStartedAt
        ? getWorkMinutesInRange(activeStartedAt, now, hallHours)
        : 0
      const storedRemaining = (t.remaining_work_minutes as number | null) ?? 0
      const totalActive     = (t.total_active_minutes   as number | null) ?? 0
      const newRemaining    = Math.max(0, storedRemaining - workedMinutes)

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
 * Only hall leaders (owner/manager/supervisor) and admins can call this.
 */
export async function getHallInboxTasksAction(clusterId: string): Promise<Todo[]> {
  const user = await getSession()
  if (!user || !clusterId) return []

  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
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

  const { data: tasks } = await supabase
    .from('todos')
    .select('*')
    .eq('cluster_id', clusterId)
    .in('scheduler_state', ['active', 'user_queue', 'paused', 'blocked'])
    .order('queue_rank', { ascending: true })

  if (!tasks || tasks.length === 0) return []

  // Group by assignee
  const byUser: Record<string, Todo[]> = {}
  for (const t of tasks as Todo[]) {
    const u = t.assigned_to ?? 'unassigned'
    if (!byUser[u]) byUser[u] = []
    byUser[u].push(t)
  }

  // Fetch avatar data for each user
  const usernames = Object.keys(byUser).filter((u) => u !== 'unassigned')
  const { data: userRows } = await supabase
    .from('users').select('username, avatar_data').in('username', usernames)
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

  // Auth: must be admin/SM or a hall owner/manager/supervisor
  const isAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdmin) {
    const { data: mem } = await supabase
      .from('cluster_members').select('cluster_role')
      .eq('cluster_id', clusterId).eq('username', user.username).single()
    if (!mem || !['owner', 'manager', 'supervisor'].includes((mem as Record<string, string>).cluster_role)) return null
  }

  const { data: clusterRow } = await supabase.from('clusters').select('name').eq('id', clusterId).single()
  const clusterName = (clusterRow as Record<string, string> | null)?.name ?? 'Hall'

  // Get all cluster members
  const { data: memberRows } = await supabase
    .from('cluster_members').select('username').eq('cluster_id', clusterId)
  const allMemberUsernames = ((memberRows ?? []) as Array<{ username: string }>).map((m) => m.username)

  // --- Filter members: only show the current user's subordinates, excluding self ---
  let filteredUsernames: string[]
  if (isAdmin) {
    // Admin/SM: all cluster members except themselves
    filteredUsernames = allMemberUsernames.filter((u) => u.toLowerCase() !== user.username.toLowerCase())
  } else {
    // Manager/Supervisor: only cluster members who are their direct reports
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
  ;((userInfoRows ?? []) as Array<{ username: string; department: string | null }>).forEach((u) => {
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

