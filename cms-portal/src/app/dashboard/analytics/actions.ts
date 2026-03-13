'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { resolveStorageUrl } from '@/lib/storage'

export interface AnalyticsTask {
  id: string
  title: string
  username: string
  assigned_to: string | null
  completed: boolean
  task_status: string
  priority: string
  kpi_type: string | null
  due_date: string | null
  category: string | null
  created_at: string
}

export interface AnalyticsData {
  totalTasks: number
  assignedToMe: number
  completed: number
  inProgress: number
  pending: number
  overdue: number
  dueToday: number
  statusBreakdown: Record<string, number>
  priorityBreakdown: Record<string, number>
  departmentBreakdown: Record<string, number>
  topUsers: Array<{ username: string; total: number; completed: number; avatarData: string | null }>
  allTasks: AnalyticsTask[]
}

export async function getAnalytics(): Promise<AnalyticsData> {
  const user = await getSession()
  const empty: AnalyticsData = {
    totalTasks: 0, assignedToMe: 0, completed: 0, inProgress: 0, pending: 0,
    overdue: 0, dueToday: 0, statusBreakdown: {}, priorityBreakdown: {},
    departmentBreakdown: {}, topUsers: [], allTasks: [],
  }
  if (!user) return empty
  if (user.role !== 'Admin' && user.role !== 'Super Manager') return empty

  const supabase = createServerClient()
  const [{ data: todos }, { data: usersData }] = await Promise.all([
    supabase
      .from('todos')
      .select('id, title, username, assigned_to, completed, task_status, priority, kpi_type, due_date, category, archived, created_at')
      .eq('archived', false),
    supabase
      .from('users')
      .select('username, avatar_data'),
  ])

  if (!todos) return empty

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  const tasks = todos as unknown as Array<{
    id: string; title: string; username: string; assigned_to: string | null; completed: boolean;
    task_status: string; priority: string; kpi_type: string | null; due_date: string | null; category: string | null; created_at: string;
  }>

  const statusBreakdown: Record<string, number> = {}
  const priorityBreakdown: Record<string, number> = {}
  const departmentBreakdown: Record<string, number> = {}
  const userMap: Record<string, { total: number; completed: number }> = {}

  let assignedToMe = 0
  let completedCount = 0
  let inProgress = 0
  let pendingCount = 0
  let overdue = 0
  let dueToday = 0

  for (const t of tasks) {
    statusBreakdown[t.task_status] = (statusBreakdown[t.task_status] || 0) + 1
    priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] || 0) + 1
    if (t.category) departmentBreakdown[t.category] = (departmentBreakdown[t.category] || 0) + 1

    const owner = t.assigned_to || t.username
    if (!userMap[owner]) userMap[owner] = { total: 0, completed: 0 }
    userMap[owner].total++

    if (t.completed) {
      completedCount++
      userMap[owner].completed++
    } else {
      if (t.task_status === 'in_progress') inProgress++
      else pendingCount++
      if (t.due_date && t.due_date < todayStr) overdue++
      if (t.due_date && t.due_date === todayStr) dueToday++
    }

    if (t.assigned_to === user.username) assignedToMe++
  }

  const topUsers = Object.entries(userMap)
    .map(([username, stats]) => ({ username, ...stats, avatarData: null as string | null }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  const avatarPathMap = Object.fromEntries(
    ((usersData ?? []) as Array<{ username: string; avatar_data: string | null }>).map((entry) => [entry.username, entry.avatar_data ?? null])
  )
  const resolvedTopUserAvatars = await Promise.all(
    topUsers.map(async (entry) => [
      entry.username,
      await resolveStorageUrl(supabase, avatarPathMap[entry.username] ?? null),
    ] as const)
  )
  const avatarMap = Object.fromEntries(resolvedTopUserAvatars)
  topUsers.forEach((entry) => {
    entry.avatarData = avatarMap[entry.username] ?? null
  })

  return {
    totalTasks: tasks.length,
    assignedToMe,
    completed: completedCount,
    inProgress,
    pending: pendingCount,
    overdue,
    dueToday,
    statusBreakdown,
    priorityBreakdown,
    departmentBreakdown,
    topUsers,
    allTasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      username: t.username,
      assigned_to: t.assigned_to,
      completed: t.completed,
      task_status: t.task_status,
      priority: t.priority,
      kpi_type: t.kpi_type,
      due_date: t.due_date,
      category: t.category,
      created_at: t.created_at,
    })),
  }
}
