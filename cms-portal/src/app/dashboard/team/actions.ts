'use server'

import { unstable_cache, revalidateTag } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { resolveStorageUrl } from '@/lib/storage'
import { canonicalDepartmentKey } from '@/lib/department-name'
import type { AssignmentChainEntry, HistoryEntry, MultiAssignment, Todo } from '@/types'

const TEAM_CACHE_TAG = 'team-data'

const TEAM_TASK_LIST_SELECT = [
  'id',
  'username',
  'title',
  'description',
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
].join(',')

export interface TeamMember {
  username: string
  role: string
  department: string | null
  email: string
  last_login: string | null
  avatar_data: string | null
  taskStats: { total: number; completed: number; pending: number; overdue: number }
}

type TeamTodoStatsRow = {
  username: string | null
  assigned_to: string | null
  completed: boolean
  task_status?: string | null
  due_date: string | null
  archived: boolean
  multi_assignment?: unknown
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

/** Converts old GAS-format assignment_chain entries to the new Next.js format. */
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
  if (normalized.length === 0 && assignedTo && creatorUsername) {
    normalized.push({ user: creatorUsername, role: 'assignee', assignedAt: undefined, next_user: assignedTo })
  }
  return normalized
}


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
    if (user.teamMembers) user.teamMembers.forEach((member) => { if (member) set.add(member) })
    memberUsernames = Array.from(set)
  }

  return { user, memberUsernames }
}

export async function getTeamStats(): Promise<{
  users: number
  tasks_all: number
  tasks_completed: number
  tasks_pending: number
  tasks_overdue: number
  tasks_queue: number
}> {
  const empty = { users: 0, tasks_all: 0, tasks_completed: 0, tasks_pending: 0, tasks_overdue: 0, tasks_queue: 0 }
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user) return empty

  if (memberUsernames.length === 0) return { ...empty, users: 0 }

  const tasks = await getTeamTodos()
  const now = new Date()

  return {
    users: memberUsernames.length,
    tasks_all: tasks.length,
    tasks_completed: tasks.filter((t) => t.completed || t.task_status === 'done').length,
    tasks_pending: tasks.filter((t) => {
      if (t.completed || t.task_status === 'done') return false
      if (t.due_date && new Date(t.due_date) < now) return false
      return true
    }).length,
    tasks_overdue: tasks.filter((t) => !t.completed && !!t.due_date && new Date(t.due_date) < now).length,
    tasks_queue: tasks.filter((t) => t.queue_status === 'queued' && !!t.queue_department).length,
  }
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user) return []
  if (memberUsernames.length === 0) return []

  const scopeKey = [user.role, user.username, ...memberUsernames.slice().sort()].join('|')

  return unstable_cache(
    async () => {
      const supabase = createServerClient()

      // Fetch user details and todos relevant to team members in parallel
      const [usersRes, assignedTodosRes, createdTodosRes, maTodosRes] = await Promise.all([
        supabase
          .from('users')
          .select('username, role, department, email, last_login, avatar_data')
          .in('username', memberUsernames),
        // Tasks directly assigned to a team member
        supabase
          .from('todos')
          .select('id, username, assigned_to, completed, task_status, due_date, archived, multi_assignment')
          .eq('archived', false)
          .in('assigned_to', memberUsernames),
        // Tasks created by a team member (catches self-assigned + unassigned creator tasks)
        supabase
          .from('todos')
          .select('id, username, assigned_to, completed, task_status, due_date, archived, multi_assignment')
          .eq('archived', false)
          .in('username', memberUsernames),
        // Multi-assignment tasks involving team members
        supabase
          .from('todos')
          .select('id, username, assigned_to, completed, task_status, due_date, archived, multi_assignment')
          .eq('archived', false)
          .not('multi_assignment', 'is', null),
      ])

      const usersData = usersRes.data
      if (!usersData) return []

      // Merge assigned + created + multi_assignment todos, deduplicate by id
      const teamSet = new Set(memberUsernames.map((u) => u.toLowerCase()))
      const todoMap = new Map<string, TeamTodoStatsRow>()
      ;((assignedTodosRes.data ?? []) as unknown as Array<TeamTodoStatsRow & { id: string }>).forEach((t) =>
        todoMap.set(String(t.id), t),
      )
      ;((createdTodosRes.data ?? []) as unknown as Array<TeamTodoStatsRow & { id: string }>).forEach((t) =>
        todoMap.set(String(t.id), t),
      )
      ;((maTodosRes.data ?? []) as unknown as Array<TeamTodoStatsRow & { id: string }>).forEach((t) => {
        const ma = parseJson<MultiAssignment | null>(t.multi_assignment, null)
        if (!ma?.enabled || !Array.isArray(ma.assignees)) return
        const isRelevant = ma.assignees.some(
          (entry) =>
            teamSet.has((entry.username || '').toLowerCase()) ||
            (Array.isArray(entry.delegated_to) &&
              entry.delegated_to.some((sub) => teamSet.has((sub.username || '').toLowerCase()))),
        )
        if (isRelevant) todoMap.set(String(t.id), t)
      })
      const todos = Array.from(todoMap.values())

      const now = new Date().toISOString().split('T')[0]

      const getUserTaskState = (task: TeamTodoStatsRow, username: string) => {
        const userLower = username.toLowerCase()
        const creatorLower = (task.username || '').toLowerCase()
        const assigneeLower = (task.assigned_to || '').toLowerCase()
        const multiAssignment = parseJson<MultiAssignment | null>(task.multi_assignment, null)

        if (multiAssignment?.enabled && Array.isArray(multiAssignment.assignees)) {
          const directEntry = multiAssignment.assignees.find(
            (entry) => (entry.username || '').toLowerCase() === userLower,
          )
          if (directEntry) {
            const dueDate = directEntry.actual_due_date || task.due_date || null
            const isCompleted = directEntry.status === 'completed' || directEntry.status === 'accepted'
            return { included: true, isCompleted, dueDate }
          }

          for (const entry of multiAssignment.assignees) {
            const delegatedEntry = Array.isArray(entry.delegated_to)
              ? entry.delegated_to.find((sub) => (sub.username || '').toLowerCase() === userLower)
              : null
            if (delegatedEntry) {
              const dueDate = task.due_date || null
              const isCompleted = delegatedEntry.status === 'completed' || delegatedEntry.status === 'accepted'
              return { included: true, isCompleted, dueDate }
            }
          }

          return { included: false, isCompleted: false, dueDate: null as string | null }
        }

        if (assigneeLower === userLower) {
          return {
            included: true,
            isCompleted: task.completed || task.task_status === 'done',
            dueDate: task.due_date || null,
          }
        }

        if (creatorLower === userLower && !(task.assigned_to || '').trim()) {
          return {
            included: true,
            isCompleted: task.completed || task.task_status === 'done',
            dueDate: task.due_date || null,
          }
        }

        return { included: false, isCompleted: false, dueDate: null as string | null }
      }

      return Promise.all(
        (
          usersData as unknown as Array<{
            username: string
            role: string
            department: string | null
            email: string
            last_login: string | null
            avatar_data: string | null
          }>
        ).map(async (u) => {
          const taskStates = (todos as TeamTodoStatsRow[])
            .map((task) => getUserTaskState(task, u.username))
            .filter((state) => state.included)

          const completed = taskStates.filter((state) => state.isCompleted).length
          const overdue = taskStates.filter((state) => !state.isCompleted && !!state.dueDate && state.dueDate < now).length
          const total = taskStates.length
          const pending = total - completed - overdue

          return {
            ...u,
            avatar_data: await resolveStorageUrl(supabase, u.avatar_data),
            taskStats: { total, completed, pending, overdue },
          }
        }),
      )
    },
    ['team-members-page', user.username, scopeKey],
    { revalidate: 60, tags: [TEAM_CACHE_TAG] },
  )()
}

export async function getTeamTodos(): Promise<Todo[]> {
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user || memberUsernames.length === 0) return []

  const scopeKey = [user.role, user.username, ...memberUsernames.slice().sort()].join('|')

  return unstable_cache(
    async () => {
      const supabase = createServerClient()

      const [usersRes, createdRes, assignedRes, maRes, deptQueueRes, deptsRes] = await Promise.all([
        supabase.from('users').select('username, department'),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('username', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).in('assigned_to', memberUsernames),
        supabase.from('todos').select(TEAM_TASK_LIST_SELECT).eq('archived', false).not('multi_assignment', 'is', null),
        supabase
          .from('todos')
          .select(TEAM_TASK_LIST_SELECT)
          .eq('archived', false)
          .eq('queue_status', 'queued')
          .or('assigned_to.is.null,assigned_to.eq.'),
        supabase.from('departments').select('name'),
      ])

      // Build canonical key → official name map for queue_department normalization
      const officialDeptNameMap = new Map<string, string>()
      ;((deptsRes.data ?? []) as Array<{ name: string }>).forEach((d) => {
        const key = canonicalDepartmentKey(d.name)
        if (key && !officialDeptNameMap.has(key)) officialDeptNameMap.set(key, d.name)
      })

      const deptMap = new Map<string, string | null>()
      ;(usersRes.data ?? []).forEach((row) => {
        const userRow = row as { username: string; department: string | null }
        deptMap.set(userRow.username.toLowerCase(), userRow.department)
      })

      const teamSet = new Set(memberUsernames.map((username) => username.toLowerCase()))
      const teamDeptCanonicalSet = new Set(
        memberUsernames
          .flatMap((username) => {
            const csv = (deptMap.get(username.toLowerCase()) || '').toString()
            return csv.split(',').map((d) => canonicalDepartmentKey(d)).filter((d) => d.length > 0)
          })
      )
      const canViewAllQueueTasks = user.role === 'Admin' || user.role === 'Super Manager'
      const taskMap = new Map<string, Record<string, unknown>>()
      ;((createdRes.data ?? []) as unknown as Record<string, unknown>[]).forEach((row) => taskMap.set(String(row.id), row))
      ;((assignedRes.data ?? []) as unknown as Record<string, unknown>[]).forEach((row) => taskMap.set(String(row.id), row))
      ;((maRes.data ?? []) as unknown as Record<string, unknown>[]).forEach((raw) => {
        const multiAssignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
        if (!multiAssignment?.enabled || !Array.isArray(multiAssignment.assignees)) return

        const isRelevant = multiAssignment.assignees.some((entry) => {
          const username = (entry.username || '').toLowerCase()
          if (teamSet.has(username)) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => teamSet.has((sub.username || '').toLowerCase()))
        })

        if (isRelevant) {
          taskMap.set(String(raw.id), raw)
        }
      })

      ;((deptQueueRes.data ?? []) as unknown as Record<string, unknown>[]).forEach((raw) => {
        if (canViewAllQueueTasks) {
          taskMap.set(String(raw.id), raw)
          return
        }

        const queueDeptKey = canonicalDepartmentKey(String(raw.queue_department || ''))
        if (queueDeptKey && teamDeptCanonicalSet.has(queueDeptKey)) {
          taskMap.set(String(raw.id), raw)
        }
      })

      const tasks = Array.from(taskMap.values())
        .map((raw) => {
          const task = raw as unknown as Todo
          task.history = parseJson<HistoryEntry[]>(raw.history, [])
          const rawChain = parseJson<AssignmentChainEntry[]>(raw.assignment_chain, [])
          task.assignment_chain = normalizeChainEntries(
            rawChain,
            String(raw.username || '').trim(),
            raw.assigned_to ? String(raw.assigned_to).trim() : null,
          )
          task.multi_assignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
          task.creator_department = deptMap.get((task.username || '').toLowerCase()) ?? null
          task.assignee_department = deptMap.get((task.assigned_to || '').toLowerCase()) ?? null
          if (!task.due_date && task.expected_due_date) {
            task.due_date = task.expected_due_date
          }
          // Normalize queue_department to official name (fixes stale old dept names)
          if (task.queue_department) {
            const normalized = officialDeptNameMap.get(canonicalDepartmentKey(task.queue_department))
            if (normalized) task.queue_department = normalized
          }
          return task
        })

      tasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      return tasks
    },
    ['team-todos-page', user.username, scopeKey],
    { revalidate: 60, tags: [TEAM_CACHE_TAG] },
  )()
}

export async function revalidateTeamCache() {
  revalidateTag(TEAM_CACHE_TAG)
}
