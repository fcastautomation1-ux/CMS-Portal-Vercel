import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServerClient()

  // Get tasks for "Anti Virus: Virus Cleaner" specifically
  const { data, error } = await supabase
    .from('todos')
    .select('id,app_name,username,assigned_to,task_status,completed_at,created_at,due_date,effective_due_at,estimated_work_minutes,total_active_minutes,multi_assignment')
    .eq('archived', false)
    .eq('app_name', 'Anti Virus: Virus Cleaner')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const tasks = data ?? []

  // Replicate the exact logic from getAppOverviewData
  type RawTask = typeof tasks[number]

  function getDirectAssignees(task: RawTask): string[] {
    const ma = task.multi_assignment as { enabled?: boolean; assignees?: Array<{ username?: string | null }> } | null
    if (ma?.enabled && Array.isArray(ma.assignees) && ma.assignees.length > 0) {
      return ma.assignees.map((e) => String(e.username ?? '').trim()).filter(Boolean)
    }
    const assignedTo = String(task.assigned_to ?? '').trim()
    return assignedTo ? [assignedTo] : []
  }

  function getTaskProgress(task: RawTask): 'completed' | 'in_progress' | 'pending' {
    if (task.task_status === 'done' || Boolean(task.completed_at)) return 'completed'
    if (task.task_status === 'in_progress') return 'in_progress'
    return 'pending'
  }

  function getTaskElapsedMinutes(task: RawTask): number {
    const tam = task.total_active_minutes as number | null
    if (typeof tam === 'number' && tam > 0) return tam
    const ewm = task.estimated_work_minutes as number | null
    if (typeof ewm === 'number' && ewm > 0) return ewm
    if (task.completed_at && task.created_at) {
      const s = new Date(task.created_at).getTime()
      const e = new Date(task.completed_at).getTime()
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 60000)
    }
    return 0
  }

  // Build per-user stats
  const userMap = new Map<string, { username: string; count: number; total_minutes: number; before_deadline_minutes: number; after_deadline_minutes: number }>()

  for (const task of tasks) {
    const assignees = getDirectAssignees(task)
    for (const assignee of assignees) {
      const key = assignee.toLowerCase()
      const existing = userMap.get(key) ?? { username: assignee, count: 0, total_minutes: 0, before_deadline_minutes: 0, after_deadline_minutes: 0 }
      existing.count += 1
      const elapsed = getTaskElapsedMinutes(task)
      existing.total_minutes += elapsed

      const progress = getTaskProgress(task)
      if (progress === 'completed') {
        const completedTs = task.completed_at ? new Date(task.completed_at).getTime() : NaN
        const deadline = task.effective_due_at || task.due_date
        const dueTs = deadline ? new Date(deadline).getTime() : NaN
        if (Number.isFinite(completedTs) && Number.isFinite(dueTs)) {
          if (completedTs <= dueTs) existing.before_deadline_minutes += elapsed
          else existing.after_deadline_minutes += elapsed
        }
      }

      userMap.set(key, existing)
    }
  }

  const perUser = Array.from(userMap.values()).sort((a, b) => b.count - a.count)

  return NextResponse.json({
    total_tasks: tasks.length,
    per_user: perUser,
    sample_raw: tasks.slice(0, 3).map(t => ({
      id: t.id,
      assigned_to: t.assigned_to,
      task_status: t.task_status,
      completed_at: t.completed_at,
      created_at: t.created_at,
      total_active_minutes: t.total_active_minutes,
      estimated_work_minutes: t.estimated_work_minutes,
    })),
  })
}
