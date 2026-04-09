
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
  estimated_minutes: number
  total_minutes: number
  completed_before_deadline_count: number
  completed_after_deadline_count: number
  before_deadline_minutes: number
  after_deadline_minutes: number
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
    assignees?: Array<{
      username?: string | null
      hall_estimated_hours?: number | null
      hall_remaining_minutes?: number | null
      hall_active_started_at?: string | null
      hall_effective_due_at?: string | null
    }> | null
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

function getAssignmentMinutes(task: RawTask, username: string): number {
  const lowerUsername = username.trim().toLowerCase()

  if (task.multi_assignment?.enabled && Array.isArray(task.multi_assignment.assignees)) {
    const entry = task.multi_assignment.assignees.find(
      (candidate) => String(candidate.username ?? '').trim().toLowerCase() === lowerUsername,
    )

    if (entry) {
      const estHours = entry.hall_estimated_hours
      if (typeof estHours === 'number' && Number.isFinite(estHours) && estHours > 0) {
        return Math.round(estHours * 60)
      }

      const remMin = entry.hall_remaining_minutes
      if (typeof remMin === 'number' && Number.isFinite(remMin) && remMin > 0) {
        return remMin
      }
    }
  }

  if (typeof task.total_active_minutes === 'number' && task.total_active_minutes > 0) {
    return task.total_active_minutes
  }

  if (typeof task.estimated_work_minutes === 'number' && task.estimated_work_minutes > 0) {
    return task.estimated_work_minutes
  }

  return 0
}

/**
 * Calendar elapsed minutes for a COMPLETED task: completed_at − created_at.
 * Matches the "Time Xd Xh" shown on individual task cards.
 * Only returns > 0 when the task is actually completed.
 */
function getCompletedTaskMinutes(task: RawTask): number {
  if (!task.completed_at) return 0
  const start = new Date(task.created_at).getTime()
  const end = new Date(task.completed_at).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.round((end - start) / 60_000)
}

export async function getAppOverviewData(opts?: {
  from?: string
  to?: string
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

  if (opts?.from) query = query.gte('created_at', opts.from)
  if (opts?.to) query = query.lte('created_at', opts.to + 'T23:59:59.999Z')

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
        estimated_minutes: 0,
        total_minutes: 0,
        completed_before_deadline_count: 0,
        completed_after_deadline_count: 0,
        before_deadline_minutes: 0,
        after_deadline_minutes: 0,
      }

      existing.count += 1

      const progress = getTaskProgress(assignment.task)
      if (progress === 'completed') existing.completed_count += 1
      else if (progress === 'in_progress') existing.in_progress_count += 1
      else existing.pending_count += 1

      // Time is loaded lazily via getAppBreakdownTimes — skip here

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

/* ────────────────────────────────────────────────────────────────────────
 *  On-demand: fetch time breakdown per app (called lazily when user expands)
 * ──────────────────────────────────────────────────────────────────────── */

export interface UserBreakdownTime {
  username: string
  total_minutes: number
  actual_minutes: number
  before_deadline_minutes: number
  after_deadline_minutes: number
  start_date: string | null   // earliest created_at among completed tasks
  end_date: string | null     // latest due_date among completed tasks
}

export async function getAppBreakdownTimes(opts: {
  appName: string
  from?: string
  to?: string
}): Promise<UserBreakdownTime[]> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) return []

  const supabase = createServerClient()

  let query = supabase
    .from('todos')
    .select('id,assigned_to,task_status,completed_at,created_at,due_date,effective_due_at,estimated_work_minutes,total_active_minutes,multi_assignment,history')
    .eq('archived', false)
    .eq('app_name', opts.appName)

  if (opts.from) query = query.gte('created_at', opts.from)
  if (opts.to) query = query.lte('created_at', opts.to + 'T23:59:59.999Z')

  const { data, error } = await query
  if (error || !data) return []

  type HistoryEventRaw = { type?: string; user?: string; title?: string; timestamp?: string }

  type BreakdownTask = {
    id: string
    assigned_to: string | null
    task_status: string | null
    completed_at: string | null
    created_at: string
    due_date: string | null
    effective_due_at: string | null
    estimated_work_minutes: number | null
    total_active_minutes: number | null
    multi_assignment: RawTask['multi_assignment']
    history: HistoryEventRaw[] | null
  }

  /**
   * Returns the Unix ms timestamp when `assignee` first moved this task to in-progress.
   * Parses history events:
   *   - Regular tasks: type === 'started'
   *   - MA tasks:      type === 'status_change' + title === 'Assignment Activated' + user === assignee
   * Falls back to created_at if no event found.
   */
  function getInProgressTs(history: HistoryEventRaw[], assignee: string, isMA: boolean): number | null {
    const lower = assignee.toLowerCase()
    if (isMA) {
      const entry = history.find(
        (e) => e.type === 'status_change' && e.title === 'Assignment Activated' &&
          String(e.user ?? '').toLowerCase() === lower && e.timestamp,
      )
      if (entry?.timestamp) {
        const ts = new Date(entry.timestamp).getTime()
        if (Number.isFinite(ts)) return ts
      }
    }
    const entry = history.find((e) => e.type === 'started' && e.timestamp)
    if (entry?.timestamp) {
      const ts = new Date(entry.timestamp).getTime()
      if (Number.isFinite(ts)) return ts
    }
    return null
  }

  const tasks = data as BreakdownTask[]
  const userMap = new Map<string, UserBreakdownTime>()

  for (const task of tasks) {
    const rawTask = task as unknown as RawTask

    // Only count completed tasks
    const progress = getTaskProgress(rawTask)
    if (progress !== 'completed') continue

    // Total time = due_date − created_at (the allocated/planned window for the task)
    const deadline = task.effective_due_at || task.due_date
    const createdTs = new Date(task.created_at).getTime()
    const dueTs = deadline ? new Date(deadline).getTime() : NaN
    if (!Number.isFinite(dueTs) || !Number.isFinite(createdTs) || dueTs <= createdTs) continue
    const allocatedMinutes = Math.round((dueTs - createdTs) / 60_000)

    // Before/after deadline = how early or late the task was completed
    const completedTs = task.completed_at ? new Date(task.completed_at).getTime() : NaN

    const assignees = getDirectAssignees(rawTask)
    const isMA = !!(rawTask.multi_assignment?.enabled)
    const taskHistory: HistoryEventRaw[] = Array.isArray(task.history) ? task.history : []

    for (const assignee of assignees) {
      const key = assignee.toLowerCase()
      const existing = userMap.get(key) ?? {
        username: assignee,
        total_minutes: 0,
        actual_minutes: 0,
        before_deadline_minutes: 0,
        after_deadline_minutes: 0,
        start_date: null,
        end_date: null,
      }

      // Track date range
      if (!existing.start_date || task.created_at < existing.start_date) existing.start_date = task.created_at
      if (deadline && (!existing.end_date || deadline > existing.end_date)) existing.end_date = deadline

      existing.total_minutes += allocatedMinutes

      // Actual time = completed_at − in_progress_started_at
      // Use history events to find when the task truly became in-progress for this assignee.
      // Falls back to created_at if no history entry found.
      if (Number.isFinite(completedTs)) {
        const inProgressTs = getInProgressTs(taskHistory, assignee, isMA) ?? createdTs
        existing.actual_minutes += Math.max(0, Math.round((completedTs - inProgressTs) / 60_000))
      }

      if (Number.isFinite(completedTs)) {
        if (completedTs <= dueTs) {
          // Completed early — time saved = due_date − completed_at
          existing.before_deadline_minutes += Math.round((dueTs - completedTs) / 60_000)
        } else {
          // Completed late — overrun = completed_at − due_date
          existing.after_deadline_minutes += Math.round((completedTs - dueTs) / 60_000)
        }
      }

      userMap.set(key, existing)
    }
  }

  return Array.from(userMap.values())
}

