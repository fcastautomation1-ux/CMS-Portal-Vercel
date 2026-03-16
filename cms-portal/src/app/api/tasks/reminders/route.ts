import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getDaysText(daysRemaining: number) {
  if (daysRemaining <= 0) return 'today'
  if (daysRemaining === 1) return 'tomorrow'
  return `in ${daysRemaining} days`
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
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
    .select('id,title,due_date,username,assigned_to,manager_id,archived,completed')
    .eq('completed', false)
    .eq('archived', false)
    .not('due_date', 'is', null)
    .gte('due_date', today.toISOString())
    .lt('due_date', end.toISOString())

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const sentKeys = new Set<string>()
  let remindersSent = 0

  for (const task of tasks || []) {
    if (!task.due_date) continue
    const dueDate = new Date(task.due_date)
    const daysRemaining = Math.floor((startOfUtcDay(dueDate).getTime() - today.getTime()) / 86_400_000)
    if (daysRemaining < 0 || daysRemaining > 3) continue

    const recipients = new Set<string>()
    if (task.username) recipients.add(task.username)
    if (task.assigned_to) recipients.add(task.assigned_to)
    String(task.manager_id || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => recipients.add(value))

    for (const username of recipients) {
      const dedupeKey = `${task.id}:${username}:${today.toISOString().slice(0, 10)}`
      if (sentKeys.has(dedupeKey)) continue
      sentKeys.add(dedupeKey)

      await supabase.from('notifications').insert({
        user_id: username,
        title: `Task Reminder: ${task.title}`,
        body: `Task "${task.title}" is due ${getDaysText(daysRemaining)}.`,
        type: 'reminder',
        related_id: task.id,
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
