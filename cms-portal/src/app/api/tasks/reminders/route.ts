import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendEmail, renderTaskReminderEmail } from '@/lib/email'

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

type ApprovalReminderTask = {
  id: string
  title: string
  pending_approver: string | null
  approval_sla_due_at: string | null
  approval_status: string | null
  archived: boolean
  completed: boolean
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

  const { data: approvalTasks, error: approvalError } = await supabase
    .from('todos')
    .select('id,title,pending_approver,approval_sla_due_at,approval_status,archived,completed')
    .eq('completed', false)
    .eq('archived', false)
    .eq('approval_status', 'pending_approval')
    .not('pending_approver', 'is', null)
    .not('approval_sla_due_at', 'is', null)
    .lt('approval_sla_due_at', now.toISOString())

  if (approvalError) {
    return NextResponse.json({ success: false, error: approvalError.message }, { status: 500 })
  }

  const taskList = (tasks || []) as ReminderTask[]
  const approvalTaskList = (approvalTasks || []) as ApprovalReminderTask[]
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

  // Fetch email addresses + notification preferences for all recipients in one query
  const allRecipientsArr = Array.from(allRecipients)
  const approvalRecipients = approvalTaskList
    .map((task) => String(task.pending_approver || '').trim())
    .filter(Boolean)
  const allUsernamesForEmail = [...new Set([...allRecipientsArr, ...approvalRecipients])]

  const { data: usersForEmail } = allUsernamesForEmail.length
    ? await supabase
        .from('users')
        .select('username, email, email_notifications_enabled')
        .in('username', allUsernamesForEmail)
    : { data: [] as Array<{ username: string; email: string; email_notifications_enabled: boolean }> }

  const userEmailMap = new Map<string, { email: string; emailEnabled: boolean }>(
    ((usersForEmail ?? []) as Array<{ username: string; email: string; email_notifications_enabled: boolean }>).map((u) => [
      u.username.toLowerCase(),
      { email: u.email, emailEnabled: u.email_notifications_enabled ?? false },
    ])
  )

  const portalUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  const reminderTaskIds = [
    ...taskIds,
    ...approvalTaskList.map((task) => task.id),
  ]
  const reminderRecipients = [
    ...allRecipientsArr,
    ...approvalRecipients,
  ]

  const { data: todayReminders } = reminderTaskIds.length && reminderRecipients.length
    ? await supabase
        .from('notifications')
        .select('related_id,user_id,type,created_at')
        .in('type', ['reminder', 'approval_reminder'])
        .in('related_id', reminderTaskIds)
        .in('user_id', reminderRecipients)
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
  let approvalRemindersSent = 0

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

      // Send email if user has notifications enabled
      const userInfo = userEmailMap.get(username.toLowerCase())
      if (userInfo?.emailEnabled && userInfo.email) {
        const { html, text } = renderTaskReminderEmail(username, task.title, getDaysText(daysRemaining), portalUrl)
        sendEmail({ to: userInfo.email, subject: `Task Reminder: ${task.title}`, html, text }).catch(() => {})
      }
    }
  }

  for (const task of approvalTaskList) {
    const approver = String(task.pending_approver || '').trim()
    const dueAt = task.approval_sla_due_at ? new Date(task.approval_sla_due_at) : null
    if (!approver || !dueAt || Number.isNaN(dueAt.getTime())) continue

    const overdueDays = Math.max(1, Math.floor((today.getTime() - startOfUtcDay(dueAt).getTime()) / 86_400_000))
    const dedupeKey = `${task.id}:${approver.toLowerCase()}`
    if (sentKeys.has(dedupeKey)) continue
    sentKeys.add(dedupeKey)

    await supabase.from('notifications').insert({
      user_id: approver,
      title: `Approval SLA overdue: ${task.title}`,
      message: `Approval for "${task.title}" is ${overdueDays === 1 ? '1 day' : `${overdueDays} days`} overdue.`,
      body: `Approval for "${task.title}" is ${overdueDays === 1 ? '1 day' : `${overdueDays} days`} overdue and needs your action.`,
      type: 'approval_reminder',
      link: task.id,
      related_id: task.id,
      read: false,
      is_read: false,
      created_at: new Date().toISOString(),
    })
    approvalRemindersSent += 1

    // Send email if approver has notifications enabled
    const approverInfo = userEmailMap.get(approver.toLowerCase())
    if (approverInfo?.emailEnabled && approverInfo.email) {
      const daysText = `${overdueDays === 1 ? '1 day' : `${overdueDays} days`} overdue`
      const { html, text } = renderTaskReminderEmail(approver, task.title, daysText, portalUrl)
      sendEmail({ to: approverInfo.email, subject: `Approval Overdue: ${task.title}`, html, text }).catch(() => {})
    }
  }

  return NextResponse.json({
    success: true,
    remindersSent,
    approvalRemindersSent,
    tasksChecked: (tasks || []).length,
    approvalTasksChecked: approvalTaskList.length,
    route: '/api/tasks/reminders',
  })
}
