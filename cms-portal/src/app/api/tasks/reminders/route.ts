import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getDaysText(daysRemaining: number) {
  if (daysRemaining < 0) {
    const overdueDays = Math.abs(daysRemaining)
    return overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`
  }
  if (daysRemaining === 0) return 'today'
  if (daysRemaining === 1) return 'tomorrow'
  return `in ${daysRemaining} days`
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
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

type ReminderTask = {
  id: string
  title: string
  due_date: string | null
  username: string | null
  assigned_to: string | null
  manager_id: string | null
  archived: boolean
  completed: boolean
  multi_assignment?: unknown
}

type MultiAssignmentLike = {
  assignees?: Array<{
    username?: string
    delegated_to?: Array<{ username?: string }>
  }>
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && bearer !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const now = new Date()
  const today = startOfUtcDay(now)
  const end = new Date(today)
  end.setUTCDate(end.getUTCDate() + 4)

  const { data: tasks, error } = await supabase
    .from('todos')
    .select('id,title,due_date,username,assigned_to,manager_id,archived,completed,multi_assignment')
    .eq('completed', false)
    .eq('archived', false)
    .not('due_date', 'is', null)
    // Include upcoming (next 3 days) and overdue tasks.
    .lt('due_date', end.toISOString())

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const taskList = (tasks || []) as ReminderTask[]
  const recipientsByTask = new Map<string, Set<string>>()
  const allRecipients = new Set<string>()
  const taskIds = taskList.map((task) => task.id)

  for (const task of taskList) {
    const recipients = new Set<string>()
    if (task.username) recipients.add(task.username)
    if (task.assigned_to) recipients.add(task.assigned_to)
    String(task.manager_id || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => recipients.add(value))

    const ma = parseJson<MultiAssignmentLike | null>(task.multi_assignment, null)
    ;(ma?.assignees || []).forEach((assignee) => {
      if (assignee.username) recipients.add(assignee.username)
      ;(assignee.delegated_to || []).forEach((subAssignee) => {
        if (subAssignee.username) recipients.add(subAssignee.username)
      })
    })

    recipientsByTask.set(task.id, recipients)
    recipients.forEach((username) => allRecipients.add(username))
  }

  const todayIso = today.toISOString()
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowIso = tomorrow.toISOString()
  const { data: todayReminders } = taskIds.length && allRecipients.size
    ? await supabase
        .from('notifications')
        .select('related_id,user_id,type,created_at')
        .eq('type', 'reminder')
        .in('related_id', taskIds)
        .in('user_id', Array.from(allRecipients))
        .gte('created_at', todayIso)
        .lt('created_at', tomorrowIso)
    : { data: [] as Array<{ related_id: string | null; user_id: string | null }> }

  const existingToday = new Set(
    (todayReminders || [])
      .map((row) => `${String(row.related_id || '')}:${String(row.user_id || '').toLowerCase()}`)
      .filter((value) => !value.startsWith(':'))
  )

  const sentKeys = new Set<string>(existingToday)
  let remindersSent = 0

  for (const task of taskList) {
    if (!task.due_date) continue
    const dueDate = new Date(task.due_date)
    const daysRemaining = Math.floor((startOfUtcDay(dueDate).getTime() - today.getTime()) / 86_400_000)
    if (daysRemaining > 3) continue

    const recipients = recipientsByTask.get(task.id) || new Set<string>()

    for (const username of recipients) {
      const dedupeKey = `${task.id}:${username.toLowerCase()}`
      if (sentKeys.has(dedupeKey)) continue
      sentKeys.add(dedupeKey)

      await supabase.from('notifications').insert({
        user_id: username,
        title: `Task Reminder: ${task.title}`,
        message: `Task "${task.title}" is due ${getDaysText(daysRemaining)}.`,
        body: `Task "${task.title}" is due ${getDaysText(daysRemaining)}.`,
        type: 'reminder',
        link: task.id,
        related_id: task.id,
        read: false,
        is_read: false,
        created_at: new Date().toISOString(),
      })
      remindersSent += 1
    }
  }

  return NextResponse.json({
    success: true,
    remindersSent,
    tasksChecked: (tasks || []).length,
    route: '/api/tasks/reminders',
  })
}
