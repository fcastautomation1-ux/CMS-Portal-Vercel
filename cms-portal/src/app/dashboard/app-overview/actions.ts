
'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'

export interface UserTaskSummary {
  username: string
  count: number
  completed_count: number
  in_progress_count: number
  pending_count: number
  total_minutes: number
  completed_before_deadline_count: number
  completed_after_deadline_count: number
}

export interface DepartmentSummary {
  name: string | null
  task_count: number
  users_count: number
}

export interface AppOverviewRow {
  app_name: string
  task_count: number
  task_by_user: UserTaskSummary[]
  user_stats: UserTaskSummary[]
  users: string[]
  department: string | null
  departments: DepartmentSummary[]
  play_store_url: string | null
  package_id: string | null
}

export interface AppOverviewData {
  rows: AppOverviewRow[]
  total_tasks: number
  total_apps: number
}

type RawTask = {
  id: string
  app_name: string | null
  username: string | null
  assigned_to: string | null
  manager_id: string | null
  package_name: string | null
  category: string | null
  task_status: 'backlog' | 'todo' | 'in_progress' | 'done' | null
  completed_at: string | null
  due_date: string | null
  effective_due_at: string | null
  estimated_work_minutes: number | null
  total_active_minutes: number | null
  multi_assignment: {
    enabled?: boolean
    assignees?: Array<{ username?: string | null }> | null
  } | null
  created_at: string
}

function departmentKey(value: string | null | undefined): string {
  return canonicalDepartmentKey(value ?? '') || '__uncategorized__'
}

function getDirectAssignees(task: RawTask): string[] {
  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees) && task.multi_assignment.assignees.length > 0) {
    return task.multi_assignment.assignees
      .map((entry) => String(entry.username ?? '').trim())
      .filter(Boolean)
  }

  const assignedTo = String(task.assigned_to ?? '').trim()
  return assignedTo ? [assignedTo] : []
}

function getTaskProgress(task: RawTask): 'completed' | 'in_progress' | 'pending' {
  if (task.task_status === 'done' || Boolean(task.completed_at)) return 'completed'
  if (task.task_status === 'in_progress') return 'in_progress'
  return 'pending'
}

function getTaskDeadline(task: RawTask): string | null {
  return task.effective_due_at || task.due_date || null
}

export async function getAppOverviewData(opts?: {
  year?: number
  quarter?: number
}): Promise<AppOverviewData> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { rows: [], total_tasks: 0, total_apps: 0 }
  }

  const supabase = createServerClient()

  let query = supabase
    .from('todos')
    .select('id,app_name,username,assigned_to,manager_id,package_name,category,task_status,completed_at,due_date,effective_due_at,estimated_work_minutes,total_active_minutes,multi_assignment,created_at')
    .eq('archived', false)
    .not('app_name', 'is', null)
    .neq('app_name', '')

  if (opts?.year && opts?.quarter) {
    const startMonth = (opts.quarter - 1) * 3 + 1
    const endMonth = startMonth + 2
    const fromDate = `${opts.year}-${String(startMonth).padStart(2, '0')}-01`
    const lastDay = new Date(opts.year, endMonth, 0).getDate()
    const toDate = `${opts.year}-${String(endMonth).padStart(2, '0')}-${lastDay}`
    query = query.gte('created_at', fromDate).lte('created_at', toDate + 'T23:59:59.999Z')
  } else if (opts?.year) {
    query = query
      .gte('created_at', `${opts.year}-01-01`)
      .lte('created_at', `${opts.year}-12-31T23:59:59.999Z`)
  }

  const [tasksResult, pkgsResult, usersResult] = await Promise.all([
    query,
    supabase.from('packages').select('name,app_name'),
    supabase.from('users').select('username,department').order('username'),
  ])

  if (tasksResult.error) {
    console.error('[getAppOverviewData]', tasksResult.error.message)
    return { rows: [], total_tasks: 0, total_apps: 0 }
  }

  const tasks = (tasksResult.data ?? []) as RawTask[]
  const packages = (pkgsResult.data ?? []) as Array<{ name: string | null; app_name: string | null }>
  const userDeptMap = new Map<string, string>()
  if (Array.isArray(usersResult.data)) {
    for (const row of usersResult.data as Array<{ username: string | null; department: string | null }>) {
      const username = String(row.username ?? '').trim().toLowerCase()
      if (!username) continue
      userDeptMap.set(username, row.department ?? '')
    }
  }

  // Build package lookup: app_name (lowercase) → bundle_id
  const bundleByAppName = new Map<string, string>()
  for (const pkg of packages) {
    if (pkg.app_name && pkg.name) bundleByAppName.set(pkg.app_name.toLowerCase().trim(), pkg.name)
  }

  // Group tasks by app_name
  const grouped = new Map<string, RawTask[]>()
  for (const task of tasks) {
    const key = task.app_name!.trim()
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(task)
  }

  const rows: AppOverviewRow[] = []

  for (const [app_name, group] of grouped) {
    const directAssignments: Array<{ username: string; departments: string[]; task: RawTask }> = []

    for (const task of group) {
      const assignees = getDirectAssignees(task)
      for (const assignee of assignees) {
        const deptValue = userDeptMap.get(assignee.toLowerCase()) ?? ''
        const departmentsForUser = splitDepartmentsCsv(deptValue)
        directAssignments.push({
          username: assignee,
          departments: departmentsForUser.length > 0 ? departmentsForUser : [],
          task,
        })
      }
    }

    if (directAssignments.length === 0) continue

    const taskByUserMap = new Map<string, UserTaskSummary>()
    const userSet = new Set<string>()
    const departmentMap = new Map<string, { name: string | null; task_count: number; users: Set<string> }>()

    for (const assignment of directAssignments) {
      const username = assignment.username.trim()
      if (!username) continue

      userSet.add(username)

      const userKey = username.toLowerCase()
      const existing = taskByUserMap.get(userKey) ?? {
        username,
        count: 0,
        completed_count: 0,
        in_progress_count: 0,
        pending_count: 0,
        total_minutes: 0,
        completed_before_deadline_count: 0,
        completed_after_deadline_count: 0,
      }

      existing.count += 1

      const progress = getTaskProgress(assignment.task)
      if (progress === 'completed') existing.completed_count += 1
      else if (progress === 'in_progress') existing.in_progress_count += 1
      else existing.pending_count += 1

      existing.total_minutes += Math.max(0, Number(assignment.task.total_active_minutes ?? assignment.task.estimated_work_minutes ?? 0))

      if (progress === 'completed') {
        const completedAt = assignment.task.completed_at ? new Date(assignment.task.completed_at).getTime() : NaN
        const deadline = getTaskDeadline(assignment.task)
        const dueAt = deadline ? new Date(deadline).getTime() : NaN
        if (Number.isFinite(completedAt) && Number.isFinite(dueAt)) {
          if (completedAt <= dueAt) existing.completed_before_deadline_count += 1
          else existing.completed_after_deadline_count += 1
        }
      }

      taskByUserMap.set(userKey, existing)

      const assignmentDepartments = assignment.departments.length > 0 ? assignment.departments : [null]
      for (const dept of assignmentDepartments) {
        const key = departmentKey(dept)
        const existing = departmentMap.get(key) ?? {
          name: dept,
          task_count: 0,
          users: new Set<string>(),
        }
        existing.task_count += 1
        existing.users.add(username)
        departmentMap.set(key, existing)
      }
    }

    const task_count = directAssignments.length
    const userStats = Array.from(taskByUserMap.values())
    const users = Array.from(userSet).sort()
    const task_by_user = userStats
      .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))

    const departments = Array.from(departmentMap.values())
      .map((dept) => ({
        name: dept.name,
        task_count: dept.task_count,
        users_count: dept.users.size,
      }))
      .sort((a, b) => b.users_count - a.users_count || b.task_count - a.task_count || (a.name ?? '').localeCompare(b.name ?? ''))

    const department = departments[0]?.name ?? null

    // Play Store URL
    const pkgName = group.find((t) => t.package_name)?.package_name || null
    const bundleId = bundleByAppName.get(app_name.toLowerCase()) ?? pkgName ?? null
    const play_store_url = bundleId
      ? `https://play.google.com/store/apps/details?id=${bundleId}`
      : null

    rows.push({
      app_name,
      task_count,
      task_by_user,
      user_stats: task_by_user,
      users,
      department,
      departments,
      play_store_url,
      package_id: bundleId,
    })
  }

  // Sort by task count descending
  rows.sort((a, b) => b.task_count - a.task_count)

  return {
    rows,
    total_tasks: rows.reduce((s, r) => s + r.task_count, 0),
    total_apps: rows.length,
  }
}

