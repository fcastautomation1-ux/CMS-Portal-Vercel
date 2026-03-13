'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

export interface OverviewStats {
  accounts: { total: number; running: number; error: number; pending: number }
  campaigns: { total: number; enabled: number }
  users: { total: number; byRole: Record<string, number> }
  tasks: {
    total: number
    completed: number
    inProgress: number
    pending: number
    overdue: number
    dueToday: number
  }
  departments: { total: number }
  topPerformers: Array<{ username: string; completed: number; total: number; completion: number; avatarData: string | null }>
  tasksByStatus: Array<{ label: string; value: number; color: string }>
  tasksByDept: Array<{ label: string; value: number }>
  recentTasks: Array<{
    id: string
    title: string
    username: string
    assigned_to: string | null
    task_status: string
    completed: boolean
    priority: string
    due_date: string | null
    category: string | null
    created_at: string
  }>
  taskRecords: Array<{
    id: string
    title: string
    username: string
    assigned_to: string | null
    completed: boolean
    task_status: string
    priority: string
    due_date: string | null
    category: string | null
    created_at: string
  }>
  userRecords: Array<{ username: string; role: string; avatarData: string | null }>
}

export interface ManagerOverviewStats {
  teamCount: number
  teamTasks: { total: number; completed: number; inProgress: number; pending: number; overdue: number }
  teamMembers: Array<{ username: string; completed: number; total: number; role: string; department: string | null }>
  weeklyProgress: Array<{ day: string; completed: number }>
}

export interface PersonalStats {
  tasks: { total: number; completed: number; inProgress: number; pending: number; overdue: number }
  recentTasks: Array<{
    id: string; title: string; username: string; assigned_to: string | null
    task_status: string; completed: boolean; priority: string; due_date: string | null; category: string | null; created_at: string
  }>
  tasksByStatus: Array<{ label: string; value: number; color: string }>
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const user = await getSession()
  const empty: OverviewStats = {
    accounts: { total: 0, running: 0, error: 0, pending: 0 },
    campaigns: { total: 0, enabled: 0 },
    users: { total: 0, byRole: {} },
    tasks: { total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0, dueToday: 0 },
    departments: { total: 0 },
    topPerformers: [],
    tasksByStatus: [],
    tasksByDept: [],
    recentTasks: [],
    taskRecords: [],
    userRecords: [],
  }
  if (!user) return empty

  const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
  if (!isAdminOrSM) return empty

  const supabase = createServerClient()
  const today = new Date().toISOString().split('T')[0]
  const CAMPAIGN_TABLES = ['campaign_conditions', 'workflow_1', 'workflow_2', 'workflow_3'] as const

  const [accountsRes, usersRes, todosRes, deptsRes, ...campaignResults] = await Promise.all([
    supabase.from('accounts').select('customer_id,enabled,status'),
    supabase.from('users').select('username,role,avatar_data'),
    supabase.from('todos').select('id,title,username,assigned_to,completed,task_status,priority,due_date,category,created_at,archived').eq('archived', false).order('created_at', { ascending: false }),
    supabase.from('departments').select('id'),
    ...CAMPAIGN_TABLES.map(t => supabase.from(t).select('customer_id,enabled', { count: 'exact', head: false })),
  ])

  const accounts = (accountsRes.data ?? []) as Array<{ customer_id: string; enabled: boolean; status: string }>
  const acctStats = {
    total: accounts.length,
    running: accounts.filter(a => (a.status || '').toLowerCase() === 'running').length,
    error: accounts.filter(a => (a.status || '').toLowerCase() === 'error').length,
    pending: accounts.filter(a => (a.status || '').toLowerCase() === 'pending').length,
  }

  const allCampaigns = campaignResults.flatMap(r => (r.data ?? []) as Array<{ customer_id: string; enabled: boolean }>)
  const campStats = {
    total: allCampaigns.length,
    enabled: allCampaigns.filter(c => c.enabled).length,
  }

  const usersData = (usersRes.data ?? []) as Array<{ username: string; role: string; avatar_data: string | null }>
  const byRole: Record<string, number> = {}
  usersData.forEach(u => { byRole[u.role] = (byRole[u.role] || 0) + 1 })
  const avatarMap = Object.fromEntries(usersData.map(u => [u.username, u.avatar_data ?? null]))

  const todos = (todosRes.data ?? []) as Array<{
    id: string; title: string; username: string; assigned_to: string | null
    completed: boolean; task_status: string; priority: string
    due_date: string | null; category: string | null; created_at: string
  }>

  const getTaskBucket = (task: { completed: boolean; task_status: string; due_date: string | null }) => {
    if (task.completed || task.task_status === 'done') return 'completed'
    if (task.due_date && task.due_date < today) return 'overdue'
    if (task.task_status === 'in_progress') return 'in_progress'
    return 'pending'
  }

  let completed = 0
  let inProgress = 0
  let pending = 0
  let overdue = 0
  let dueToday = 0
  const deptMap: Record<string, number> = {}
  const userMap: Record<string, { total: number; completed: number }> = {}

  for (const t of todos) {
    const owner = t.assigned_to || t.username
    if (!userMap[owner]) userMap[owner] = { total: 0, completed: 0 }
    userMap[owner].total++

    const bucket = getTaskBucket(t)
    if (bucket === 'completed') {
      completed++
      userMap[owner].completed++
    } else if (bucket === 'in_progress') {
      inProgress++
    } else if (bucket === 'pending') {
      pending++
    } else {
      overdue++
    }
    if (t.due_date === today) dueToday++
    if (t.category) deptMap[t.category] = (deptMap[t.category] || 0) + 1
  }

  const topPerformers = Object.entries(userMap)
    .map(([username, s]) => ({
      username,
      completed: s.completed,
      total: s.total,
      completion: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
      avatarData: avatarMap[username] ?? null,
    }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 8)

  const tasksByStatus = [
    { label: 'Completed', value: completed, color: '#10B981' },
    { label: 'In Progress', value: inProgress, color: '#3B82F6' },
    { label: 'Pending', value: pending, color: '#F59E0B' },
    { label: 'Overdue', value: overdue, color: '#EF4444' },
  ]

  const tasksByDept = Object.entries(deptMap)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const recentTasks = todos.slice(0, 8).map(t => ({
    id: t.id,
    title: t.title,
    username: t.username,
    assigned_to: t.assigned_to,
    task_status: t.task_status,
    completed: t.completed,
    priority: t.priority,
    due_date: t.due_date,
    category: t.category,
    created_at: t.created_at,
  }))

  return {
    accounts: acctStats,
    campaigns: campStats,
    users: { total: usersData.length, byRole },
    tasks: { total: todos.length, completed, inProgress, pending, overdue, dueToday },
    departments: { total: (deptsRes.data ?? []).length },
    topPerformers,
    tasksByStatus,
    tasksByDept,
    recentTasks,
    taskRecords: todos,
    userRecords: usersData.map(u => ({ username: u.username, role: u.role, avatarData: u.avatar_data ?? null })),
  }
}

export async function getUserPersonalStats(): Promise<PersonalStats> {
  const empty: PersonalStats = {
    tasks: { total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 },
    recentTasks: [],
    tasksByStatus: [],
  }
  const user = await getSession()
  if (!user) return empty

  const supabase = createServerClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: todosRaw } = await supabase
    .from('todos')
    .select('id,title,username,assigned_to,completed,task_status,priority,due_date,category,created_at')
    .eq('archived', false)
    .or(`username.eq.${user.username},assigned_to.eq.${user.username}`)
    .order('created_at', { ascending: false })

  const todos = (todosRaw ?? []) as Array<{
    id: string; title: string; username: string; assigned_to: string | null
    completed: boolean; task_status: string; priority: string; due_date: string | null; category: string | null; created_at: string
  }>

  let completed = 0
  let inProgress = 0
  let pending = 0
  let overdue = 0
  for (const t of todos) {
    if (t.completed || t.task_status === 'done') { completed++; continue }
    if (t.due_date && t.due_date < today) { overdue++; continue }
    if (t.task_status === 'in_progress') { inProgress++; continue }
    pending++
  }

  return {
    tasks: { total: todos.length, completed, inProgress, pending, overdue },
    recentTasks: todos.slice(0, 8),
    tasksByStatus: [
      { label: 'Completed', value: completed, color: '#10B981' },
      { label: 'In Progress', value: inProgress, color: '#3B82F6' },
      { label: 'Pending', value: pending, color: '#F59E0B' },
      { label: 'Overdue', value: overdue, color: '#EF4444' },
    ],
  }
}

export async function getManagerOverview(): Promise<ManagerOverviewStats> {
  const user = await getSession()
  const empty: ManagerOverviewStats = {
    teamCount: 0,
    teamTasks: { total: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0 },
    teamMembers: [],
    weeklyProgress: [],
  }
  if (!user || (user.role !== 'Manager' && user.role !== 'Supervisor')) return empty

  const supabase = createServerClient()
  const today = new Date().toISOString().split('T')[0]

  const teamSet = new Set<string>()
  if (user.teamMembers) user.teamMembers.forEach(m => { if (m) teamSet.add(m) })
  const { data: managed } = await supabase.from('users').select('username,role,department').eq('manager_id', user.username)
  if (managed) managed.forEach((u: Record<string, unknown>) => teamSet.add(u.username as string))

  const memberList = Array.from(teamSet)
  if (memberList.length === 0) return empty

  const { data: usersData } = await supabase.from('users').select('username,role,department').in('username', memberList)
  const { data: todos } = await supabase.from('todos').select('username,assigned_to,completed,task_status,due_date,archived').eq('archived', false).in('assigned_to', memberList)

  const todoList = (todos ?? []) as Array<{ username: string; assigned_to: string | null; completed: boolean; task_status: string; due_date: string | null }>

  let completed = 0
  let inProgress = 0
  let pending = 0
  let overdue = 0
  const userMap: Record<string, { completed: number; total: number }> = {}

  for (const t of todoList) {
    const owner = t.assigned_to || t.username
    if (!userMap[owner]) userMap[owner] = { completed: 0, total: 0 }
    userMap[owner].total++
    if (t.completed) {
      completed++
      userMap[owner].completed++
    } else {
      if (t.task_status === 'in_progress') inProgress++
      else pending++
      if (t.due_date && t.due_date < today) overdue++
    }
  }

  const teamMembers = (usersData ?? []).map((u: Record<string, unknown>) => ({
    username: u.username as string,
    role: u.role as string,
    department: u.department as string | null,
    completed: userMap[u.username as string]?.completed ?? 0,
    total: userMap[u.username as string]?.total ?? 0,
  }))

  const weeklyProgress = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const dayStr = d.toISOString().split('T')[0]
    const label = d.toLocaleDateString('en', { weekday: 'short' })
    return { day: label, completed: 0, date: dayStr }
  })

  return {
    teamCount: memberList.length,
    teamTasks: { total: todoList.length, completed, inProgress, pending, overdue },
    teamMembers,
    weeklyProgress: weeklyProgress.map(({ day, completed: dayCompleted }) => ({ day, completed: dayCompleted })),
  }
}
