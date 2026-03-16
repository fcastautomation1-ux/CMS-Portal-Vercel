'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { resolveStorageUrl } from '@/lib/storage'
import type { AssignmentChainEntry, HistoryEntry, MultiAssignment, Todo } from '@/types'

export interface TeamMember {
  username: string
  role: string
  department: string | null
  email: string
  last_login: string | null
  avatar_data: string | null
  taskStats: { total: number; completed: number; pending: number; overdue: number }
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
    const { data: managed } = await supabase.from('users').select('username').eq('manager_id', user.username)
    if (managed) managed.forEach((u) => set.add((u as { username: string }).username))
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
}> {
  const empty = { users: 0, tasks_all: 0, tasks_completed: 0, tasks_pending: 0, tasks_overdue: 0 }
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user) return empty

  const supabase = createServerClient()

  if (memberUsernames.length === 0) return { ...empty, users: 0 }

  const { data: todos } = await supabase
    .from('todos')
    .select('username, completed, due_date, archived')
    .eq('archived', false)
    .in('username', memberUsernames)

  const now = new Date().toISOString().split('T')[0]
  const tasks = (todos ?? []) as Array<{ username: string; completed: boolean; due_date: string | null; archived: boolean }>
  return {
    users: memberUsernames.length,
    tasks_all: tasks.length,
    tasks_completed: tasks.filter(t => t.completed).length,
    tasks_pending: tasks.filter(t => !t.completed).length,
    tasks_overdue: tasks.filter(t => !t.completed && !!t.due_date && t.due_date < now).length,
  }
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user) return []

  const supabase = createServerClient()

  if (memberUsernames.length === 0) return []

  // Get user details
  const { data: usersData } = await supabase
    .from('users')
    .select('username, role, department, email, last_login, avatar_data')
    .in('username', memberUsernames)

  if (!usersData) return []

  // Get task stats for each member
  const { data: todos } = await supabase
    .from('todos')
    .select('username, assigned_to, completed, task_status, due_date, archived')
    .eq('archived', false)

  const now = new Date().toISOString().split('T')[0]

  return Promise.all((usersData as unknown as Array<{ username: string; role: string; department: string | null; email: string; last_login: string | null; avatar_data: string | null }>).map(async (u) => {
    const myTasks = (todos ?? []).filter((t: Record<string, unknown>) => t.username === u.username || t.assigned_to === u.username)
    const completed = myTasks.filter((t: Record<string, unknown>) => t.completed).length
    const pending = myTasks.filter((t: Record<string, unknown>) => !t.completed).length
    const overdue = myTasks.filter((t: Record<string, unknown>) => !t.completed && t.due_date && (t.due_date as string) < now).length

    return {
      ...u,
      avatar_data: await resolveStorageUrl(supabase, u.avatar_data),
      taskStats: { total: myTasks.length, completed, pending, overdue },
    }
  }))
}

export async function getTeamTodos(): Promise<Todo[]> {
  const { user, memberUsernames } = await getTeamUsernames()
  if (!user || memberUsernames.length === 0) return []

  const supabase = createServerClient()

  const { data: usersData } = await supabase
    .from('users')
    .select('username, department')

  const deptMap = new Map<string, string | null>()
  ;(usersData ?? []).forEach((row) => {
    const userRow = row as { username: string; department: string | null }
    deptMap.set(userRow.username.toLowerCase(), userRow.department)
  })

  const { data } = await supabase
    .from('todos')
    .select('*')
    .eq('archived', false)

  const teamSet = new Set(memberUsernames.map((username) => username.toLowerCase()))
  const tasks = ((data ?? []) as Record<string, unknown>[])
    .filter((raw) => {
      const creator = String(raw.username || '').toLowerCase()
      const assignee = String(raw.assigned_to || '').toLowerCase()
      if (teamSet.has(creator) || teamSet.has(assignee)) return true

      const multiAssignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
      if (!multiAssignment?.enabled || !Array.isArray(multiAssignment.assignees)) return false

      return multiAssignment.assignees.some((entry) => {
        const username = (entry.username || '').toLowerCase()
        if (teamSet.has(username)) return true
        return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => teamSet.has((sub.username || '').toLowerCase()))
      })
    })
    .map((raw) => {
      const task = raw as unknown as Todo
      task.history = parseJson<HistoryEntry[]>(raw.history, [])
      task.assignment_chain = parseJson<AssignmentChainEntry[]>(raw.assignment_chain, [])
      task.multi_assignment = parseJson<MultiAssignment | null>(raw.multi_assignment, null)
      task.creator_department = deptMap.get((task.username || '').toLowerCase()) ?? null
      task.assignee_department = deptMap.get((task.assigned_to || '').toLowerCase()) ?? null
      if (!task.due_date && task.expected_due_date) {
        task.due_date = task.expected_due_date
      }
      return task
    })

  tasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return tasks
}
