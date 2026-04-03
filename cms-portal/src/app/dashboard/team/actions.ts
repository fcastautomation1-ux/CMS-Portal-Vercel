'use server'

import { unstable_cache, revalidateTag } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { resolveStorageUrl } from '@/lib/storage'
import { canonicalDepartmentKey } from '@/lib/department-name'
import type { AssignmentChainEntry, HistoryEntry, MultiAssignment, Todo } from '@/types'

const TEAM_CACHE_TAG = 'team-data'
const TEAM_CACHE_VERSION = 'v2'

// --- Types ---

export interface TeamMember {
  username: string
  role: string
  department: string | null
  email: string
  last_login: string | null
  avatar_data: string | null
  taskStats: { total: number; completed: number; in_progress: number; pending: number; overdue: number }
}

export type TeamTodoStatsRow = {
  id: string
  username: string | null
  assigned_to: string | null
  completed_by?: string | null
  completed: boolean
  task_status?: string | null
  workflow_state?: string | null
  pending_approver?: string | null
  due_date: string | null
  expected_due_date?: string | null
  queue_department?: string | null
  queue_status?: string | null
  cluster_id?: string | null
  cluster_inbox?: boolean | null
  archived: boolean
  multi_assignment?: unknown
  assignment_chain?: unknown
  history?: unknown
  created_at: string
  updated_at: string
  department?: string | null
}

// --- Helpers ---

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T
    } catch {
      return fallback
    }
  }
  return val as T
}

function isTaskCompletedForUsername(task: TeamTodoStatsRow, username: string): boolean {
  const userLower = username.toLowerCase()
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)

  // 1. Multi-Assignment Progress
  if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
    const entry = multiAssignment.assignees.find((a) => (a.username || '').toLowerCase() === userLower)
    if (entry) return entry.status === 'completed' || entry.status === 'accepted'
    
    // Check delegations
    for (const main of multiAssignment.assignees) {
      if (Array.isArray(main.delegated_to)) {
        const del = main.delegated_to.find(d => (d.username || '').toLowerCase() === userLower)
        if (del) return del.status === 'completed' || del.status === 'accepted'
      }
    }
  }

  // 2. Global Done Status
  const isGloballyDone = task.completed || task.task_status === 'done' || task.workflow_state === 'final_approved'
  if (isGloballyDone) return true

  // 3. Current Ownership Check
  const assignee = (task.assigned_to || '').toLowerCase()
  const pendingApprover = (task.pending_approver || '').toLowerCase()
  
  // If the user is currently expected to act, it's not completed for them yet
  if (assignee === userLower && task.task_status !== 'done') return false
  if (pendingApprover === userLower) return false

  // 4. Historical Participation Check (Batton has been passed)
  const isMySubmission = (task.completed_by || '').toLowerCase() === userLower
  if (isMySubmission) return true

  const chain = parseJson<any[]>(task.assignment_chain, [])
  const hasForwarded = chain.some(e => {
    const actor = (e.user || '').toLowerCase()
    const next = (e.next_user || '').toLowerCase()
    // If I was the actor and I assigned it to someone else, OR I was the next_user and I've already acted
    return actor === userLower || (next === userLower && (e.status === 'completed' || e.action === 'complete' || e.action === 'approve'))
  })

  if (hasForwarded) return true

  return false
}

function isCompletedForTeam(task: TeamTodoStatsRow): boolean {
  return task.completed || task.task_status === 'done'
}

function getUserTaskState(task: TeamTodoStatsRow, username: string) {
  const userLower = username.toLowerCase()
  const creatorLower = (task.username || '').toLowerCase()
  const assigneeLower = (task.assigned_to || '').toLowerCase()
  const completedByLower = (task.completed_by || '').toLowerCase()
  const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)
  const chain = parseJson<any[]>(task.assignment_chain, [])

  // 1. Multi-Assignment logic
  if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
    const directEntry = multiAssignment.assignees.find(
      (entry) => (entry.username || '').toLowerCase() === userLower,
    )
    if (directEntry) {
      const dueDate = directEntry.actual_due_date || task.due_date || null
      const isCompleted = directEntry.status === 'completed' || directEntry.status === 'accepted'
      return { included: true, isCompleted, dueDate, taskStatus: task.task_status || null }
    }

    for (const entry of multiAssignment.assignees) {
      const delegatedEntry = Array.isArray(entry.delegated_to)
        ? entry.delegated_to.find((sub) => (sub.username || '').toLowerCase() === userLower)
        : null
      if (delegatedEntry) {
        return { 
          included: true, 
          isCompleted: delegatedEntry.status === 'completed' || delegatedEntry.status === 'accepted', 
          dueDate: task.due_date || null, 
          taskStatus: task.task_status || null 
        }
      }
    }
  }

  // 2. Historical & Direct logic
  const inChain = chain.some(
    (entry: any) => (entry.user || '').toLowerCase() === userLower || (entry.next_user || '').toLowerCase() === userLower
  )

  if (completedByLower === userLower || assigneeLower === userLower || creatorLower === userLower || inChain) {
    return {
      included: true,
      isCompleted: isTaskCompletedForUsername(task, username),
      dueDate: task.due_date || null,
      taskStatus: task.task_status || null,
    }
  }

  return { included: false, isCompleted: false, dueDate: null as string | null, taskStatus: null as string | null }
}

function normalizeChainEntries(
  chain: AssignmentChainEntry[],
  creatorUsername: string,
  assignedTo: string | null,
): AssignmentChainEntry[] {
  if (!Array.isArray(chain) || chain.length === 0) return chain
  const hasNewFormat = chain.some((entry) => entry.next_user !== undefined || (entry.role !== undefined && !entry.action))
  if (hasNewFormat) {
    return chain.map((entry) => ({
      ...entry,
      assignedAt: entry.assignedAt ?? entry.timestamp ?? undefined,
    }))
  }
  const normalized: AssignmentChainEntry[] = []
  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i]
    const actorUsername = String(entry.user || '').trim()
    if (!actorUsername) continue
    const assignerUsername = i === 0 ? creatorUsername : String(chain[i - 1].user || '').trim() || creatorUsername
    normalized.push({
      user: assignerUsername,
      role: 'assignee',
      assignedAt: entry.timestamp ?? undefined,
      next_user: actorUsername,
      feedback: entry.feedback ?? undefined,
      action: entry.action,
      timestamp: entry.timestamp,
      level: entry.level,
      status: entry.status,
      review_status: entry.review_status,
    })
  }
  return normalized
}

const TEAM_TASK_LIST_SELECT = [
  'id', 'username', 'title', 'description', 'completed', 'task_status', 'priority', 'category', 'kpi_type',
  'due_date', 'expected_due_date', 'actual_due_date', 'notes', 'package_name', 'app_name', 'position',
  'archived', 'queue_department', 'queue_status', 'multi_assignment', 'assigned_to', 'manager_id',
  'completed_by', 'completed_at', 'approval_status', 'workflow_state', 'pending_approver', 'approved_at',
  'approved_by', 'declined_at', 'declined_by', 'decline_reason', 'assignment_chain', 'history',
  'cluster_id', 'cluster_inbox', 'created_at', 'updated_at',
  'cluster_origin_id', 'cluster_routed_by', 'scheduler_state', 'requested_due_at', 'effective_due_at'
].join(',')

// --- Exported Actions ---

async function getTeamUsernames() {
  const user = await getSession()
  if (!user) return { user: null, memberUsernames: [] as string[] }

  const supabase = createServerClient()
  let memberUsernames: string[] = []

  if (user.role === 'Admin' || user.role === 'Super Manager') {
    const { data } = await supabase.from('users').select('username')
    memberUsernames = (data ?? []).map((u) => (u as { username: string }).username)
  } else {
    const set = new Set<string>()
    const { data: managed } = await supabase.from('users').select('username, manager_id')
    ;((managed ?? []) as Array<{ username: string; manager_id: string | null }>).forEach((row) => {
      const managers = String(row.manager_id || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
      if (managers.includes(user.username.toLowerCase())) {
        set.add(row.username)
      }
    })
    if (user.teamMembers) user.teamMembers.forEach((m) => { if (m) set.add(m) })
    memberUsernames = Array.from(set)
  }

  return { user, memberUsernames }
}

export async function getTeamStats(): Promise<{
  users: number
  tasks_all: number
  tasks_completed: number
  tasks_in_progress: number
  tasks_pending: number
  tasks_overdue: number
  tasks_queue: number
}> {
  const empty = { users: 0, tasks_all: 0, tasks_completed: 0, tasks_in_progress: 0, tasks_pending: 0, tasks_overdue: 0, tasks_queue: 0 }
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user) return empty

  const tasks = await getTeamTodos()
  const now = new Date()
  const memberSet = new Set(memberUsernames.map(u => u.toLowerCase()))

  const relevantTasks = tasks.map(t => t as unknown as TeamTodoStatsRow).filter(t => {
    const creator = (t.username || '').toLowerCase()
    const assignee = (t.assigned_to || '').toLowerCase()
    const completer = (t.completed_by || '').toLowerCase()
    const chain = parseJson<any[]>(t.assignment_chain, [])
    const ma = parseJson<MultiAssignment | null>(t.multi_assignment, null)

    if (memberSet.has(creator) || memberSet.has(assignee) || memberSet.has(completer)) return true
    if (chain.some(e => memberSet.has((e.user || '').toLowerCase()) || memberSet.has((e.next_user || '').toLowerCase()))) return true
    if (ma?.enabled && ma.assignees.some(e => memberSet.has((e.username || '').toLowerCase()))) return true
    return false
  })

  return {
    users: memberUsernames.length,
    tasks_all: relevantTasks.length,
    tasks_completed: relevantTasks.filter(t => isTaskCompletedForUsername(t, user.username)).length, // Simple count for stats
    tasks_in_progress: relevantTasks.filter(t => !isCompletedForTeam(t) && t.task_status === 'in_progress').length,
    tasks_pending: relevantTasks.filter(t => !isCompletedForTeam(t) && t.task_status !== 'in_progress').length,
    tasks_overdue: relevantTasks.filter(t => !isCompletedForTeam(t) && !!t.due_date && new Date(t.due_date) < now).length,
    tasks_queue: tasks.filter(t => t.cluster_inbox === true).length
  }
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user || memberUsernames.length === 0) return []

  const scopeKey = [TEAM_CACHE_VERSION, user.role, user.username, ...(user.clusterIds || []).slice().sort(), ...memberUsernames.slice().sort()].join('|')

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

      const [usersRes, createdRes, assignedRes, completedRes, chainRes, maRes] = await Promise.all([
        supabase.from('users').select('username, role, department, email, last_login, avatar_data').in('username', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('username', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('assigned_to', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('completed_by', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).not('assignment_chain', 'is', null).gte('updated_at', sixtyDaysAgo),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).not('multi_assignment', 'is', null).gte('updated_at', sixtyDaysAgo)
      ])

      const todoMap = new Map<string, TeamTodoStatsRow>()
      const memberSet = new Set(memberUsernames.map(u => u.toLowerCase()))

      const merge = (data: any[] | null) => {
        if (!data) return
        data.forEach(t => {
          if (todoMap.has(t.id)) return
          const row = t as TeamTodoStatsRow
          const chain = parseJson<any[]>(row.assignment_chain, [])
          const ma = parseJson<MultiAssignment | null>(row.multi_assignment, null)
          
          const isRelevant = 
            memberSet.has((row.username || '').toLowerCase()) ||
            memberSet.has((row.assigned_to || '').toLowerCase()) ||
            memberSet.has((row.completed_by || '').toLowerCase()) ||
            chain.some(e => memberSet.has((e.user || '').toLowerCase()) || memberSet.has((e.next_user || '').toLowerCase())) ||
            (ma?.enabled && ma.assignees.some(e => memberSet.has((e.username || '').toLowerCase())))

          if (isRelevant) todoMap.set(t.id, row)
        })
      }

      merge(createdRes.data); merge(assignedRes.data); merge(completedRes.data); merge(chainRes.data); merge(maRes.data)

      const todos = Array.from(todoMap.values())
      const now = new Date().toISOString().split('T')[0]

      return Promise.all(
        (usersRes.data || []).map(async (u) => {
          const taskStates = todos.map(t => getUserTaskState(t, u.username)).filter(s => s.included)
          const total = taskStates.length
          const completed = taskStates.filter(s => s.isCompleted).length
          const overdue = taskStates.filter(s => !s.isCompleted && !!s.dueDate && s.dueDate < now).length
          const in_progress = taskStates.filter(s => !s.isCompleted && s.taskStatus === 'in_progress').length
          
          return {
            ...u,
            avatar_data: await resolveStorageUrl(supabase, u.avatar_data),
            taskStats: { total, completed, in_progress, overdue, pending: total - completed - overdue - in_progress }
          } as TeamMember
        })
      )
    },
    ['team-members-page', user.username, scopeKey],
    { revalidate: 60, tags: [TEAM_CACHE_TAG] }
  )()
}

export async function getTeamTodos(): Promise<Todo[]> {
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user) return []

  const scopeKey = [TEAM_CACHE_VERSION, user.role, user.username, ...(user.clusterIds || []).slice().sort(), ...memberUsernames.slice().sort()].join('|')

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

      const [
        createdRes, assignedRes, completedRes, maRes, deptQueueRes, clusterInboxRes, chainRes, deptsRes, clusterMembershipsRes, usersDeptsRes
      ] = await Promise.all([
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('username', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('assigned_to', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('completed_by', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).not('multi_assignment', 'is', null).gte('updated_at', sixtyDaysAgo),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).eq('queue_status', 'queued').or('assigned_to.is.null,assigned_to.eq.'),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).eq('cluster_inbox', true),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).not('assignment_chain', 'is', null).gte('updated_at', sixtyDaysAgo),
        supabase.from('departments').select('name'),
        supabase.from('cluster_members').select('cluster_id').eq('username', user.username).in('cluster_role', ['owner', 'manager', 'supervisor']),
        supabase.from('users').select('username, department'),
      ])

      const todoMap = new Map<string, TeamTodoStatsRow>()
      const merge = (data: any[] | null) => {
        if (!data) return
        data.forEach(t => { if (!todoMap.has(t.id)) todoMap.set(t.id, t as TeamTodoStatsRow) })
      }
      [createdRes, assignedRes, completedRes, maRes, deptQueueRes, clusterInboxRes, chainRes].forEach(r => merge(r.data))

      const allTasks = Array.from(todoMap.values())
      const memberSet = new Set(memberUsernames.map(u => u.toLowerCase()))
      const isGlobalAdmin = user.role === 'Admin' || user.role === 'Super Manager'
      const clusterIdSet = new Set<string>([
        ...(user.clusterIds || []),
        ...((clusterMembershipsRes.data ?? []).map(m => m.cluster_id).filter(Boolean)),
      ])
      const officialDeptMap = new Map((deptsRes.data ?? []).map(d => [canonicalDepartmentKey(d.name), d.name]))

      // Build user→department lookup for enriching tasks
      const userDeptMap: Record<string, string> = {}
      ;((usersDeptsRes.data ?? []) as Array<{ username: string; department: string | null }>).forEach(u => {
        if (u.department) userDeptMap[u.username.toLowerCase()] = u.department
      })

      // Filter tasks for team visibility
      const filtered = allTasks.filter(t => {
        const creator = (t.username || '').toLowerCase()
        const assignee = (t.assigned_to || '').toLowerCase()
        const completer = (t.completed_by || '').toLowerCase()
        const chain = parseJson<any[]>(t.assignment_chain, [])
        const ma = parseJson<MultiAssignment | null>(t.multi_assignment, null)

        if (memberSet.has(creator) || memberSet.has(assignee) || memberSet.has(completer)) return true
        if (chain.some(e => memberSet.has((e.user || '').toLowerCase()) || memberSet.has((e.next_user || '').toLowerCase()))) return true
        if (ma?.enabled && ma.assignees.some(e => memberSet.has((e.username || '').toLowerCase()))) return true
        // Admins/Super Managers see all cluster inbox tasks; others see only their clusters
        if (t.cluster_inbox && isGlobalAdmin) return true
        if (t.cluster_id && clusterIdSet.has(t.cluster_id)) return true
        
        return false
      })

      return filtered.map(t => {
        const todo = t as unknown as Todo
        todo.history = parseJson<HistoryEntry[]>(t.history, [])
        todo.assignment_chain = normalizeChainEntries(parseJson<AssignmentChainEntry[]>(t.assignment_chain, []), String(t.username), t.assigned_to)
        todo.multi_assignment = parseJson<MultiAssignment | null>(t.multi_assignment, null)
        todo.creator_department = userDeptMap[(t.username || '').toLowerCase()] || null
        todo.assignee_department = userDeptMap[(t.assigned_to || '').toLowerCase()] || null
        if (t.queue_department) {
          const norm = officialDeptMap.get(canonicalDepartmentKey(t.queue_department))
          if (norm) todo.queue_department = norm
        }
        return todo
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    },
    ['team-todos-list', user.username, scopeKey],
    { revalidate: 60, tags: [TEAM_CACHE_TAG] }
  )()
}

export async function getFreshHallQueueTodos(): Promise<Todo[]> {
  const user = await getSession()
  if (!user) return []

  const isGlobalAdmin = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isGlobalAdmin && (!Array.isArray(user.clusterIds) || user.clusterIds.length === 0)) return []

  const supabase = createServerClient()
  const [{ data: deptsRes }, { data: usersRes }] = await Promise.all([
    supabase.from('departments').select('name'),
    supabase.from('users').select('username, department'),
  ])
  const officialDeptMap = new Map((deptsRes ?? []).map(d => [canonicalDepartmentKey(d.name), d.name]))
  const userDeptMap: Record<string, string> = {}
  ;((usersRes ?? []) as Array<{ username: string; department: string | null }>).forEach(u => {
    if (u.department) userDeptMap[u.username.toLowerCase()] = u.department
  })

  let query = supabase
    .from('todos')
    .select(TEAM_TASK_LIST_SELECT)
    .eq('archived', false)
    .eq('cluster_inbox', true)
    .order('created_at', { ascending: false })

  if (!isGlobalAdmin) {
    query = query.in('cluster_id', user.clusterIds)
  }

  const { data } = await query

  return ((data ?? []) as unknown as TeamTodoStatsRow[]).map((t) => {
    const todo = t as unknown as Todo
    todo.history = parseJson<HistoryEntry[]>(t.history, [])
    todo.assignment_chain = normalizeChainEntries(parseJson<AssignmentChainEntry[]>(t.assignment_chain, []), String(t.username), t.assigned_to)
    todo.multi_assignment = parseJson<MultiAssignment | null>(t.multi_assignment, null)
    todo.creator_department = userDeptMap[(t.username || '').toLowerCase()] || null
    todo.assignee_department = userDeptMap[(t.assigned_to || '').toLowerCase()] || null
    if (t.queue_department) {
      const norm = officialDeptMap.get(canonicalDepartmentKey(t.queue_department))
      if (norm) todo.queue_department = norm
    }
    return todo
  })
}

export async function revalidateTeamCache() {
  revalidateTag(TEAM_CACHE_TAG)
}
