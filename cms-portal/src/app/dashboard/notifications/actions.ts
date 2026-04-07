'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { resolveStorageUrl } from '@/lib/storage'
import type { Notification } from '@/types'

function getNotificationUserKeys(user: { username: string; email: string }): string[] {
  const keys = [
    user.username,
    user.email,
    user.username.toLowerCase(),
    user.email.toLowerCase(),
  ].filter(Boolean)
  return Array.from(new Set(keys))
}

export async function getNotifications(): Promise<Notification[]> {
  const user = await getSession()
  if (!user) return []

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()

  // Use select('*') so the query never fails due to a missing 'read' or 'is_read'
  // column variance across deployments. Both columns are normalised later via norm().
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .in('user_id', userKeys)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[getNotifications] query error:', error.message)
    return []
  }

  const notifications = (data as unknown as Notification[]) ?? []
  const senderNames = Array.from(
    new Set(
      notifications
        .map((notification) => String(notification.created_by || '').trim())
        .filter(Boolean)
    )
  )

  const { data: senderRows } = senderNames.length > 0
    ? await supabase.from('users').select('username,avatar_data').in('username', senderNames)
    : { data: [] as Array<{ username: string; avatar_data: string | null }> }

  const avatarMap = new Map<string, string | null>()
  await Promise.all(
    (senderRows || []).map(async (row) => {
      avatarMap.set(
        row.username,
        row.avatar_data ? await resolveStorageUrl(supabase, row.avatar_data) : null
      )
    })
  )

  return notifications.map((notification) => ({
    ...notification,
    sender_avatar: notification.created_by ? (avatarMap.get(notification.created_by) ?? null) : null,
  }))
}

export async function getUnreadCount(): Promise<number> {
  const user = await getSession()
  if (!user) return 0

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()

  // Query both schemas simultaneously and take the max to handle tables with
  // either `read` (legacy) or `is_read` (modern) or both columns.
  const [res1, res2] = await Promise.all([
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .in('user_id', userKeys)
      .eq('read', false),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .in('user_id', userKeys)
      .eq('is_read', false),
  ])

  const count1 = res1.error ? null : (res1.count ?? 0)
  const count2 = res2.error ? null : (res2.count ?? 0)

  if (count1 !== null && count2 !== null) return Math.max(count1, count2)
  if (count1 !== null) return count1
  if (count2 !== null) return count2
  return 0
}

export async function markNotificationRead(id: string): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .in('user_id', userKeys)

  if (error) {
    const { error: err2 } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .in('user_id', userKeys)
    return { success: !err2 }
  }
  return { success: true }
}

export async function markAllNotificationsRead(): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .in('user_id', userKeys)
    .eq('read', false)

  if (error) {
    const { error: err2 } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('user_id', userKeys)
      .eq('is_read', false)
    return { success: !err2 }
  }
  return { success: true }
}

export async function deleteNotification(id: string): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .in('user_id', userKeys)

  return { success: !error }
}

export async function sendNotificationReply(data: {
  to_user: string
  reply_message: string
  original_link: string | null
  from_user: string
}): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const supabase = createServerClient()
  const { error } = await supabase.from('notifications').insert({
    user_id: data.to_user,
    type: 'reply',
    title: `\u21A9\uFE0F Reply from ${data.from_user}`,
    message: data.reply_message,
    link: data.original_link ?? null,
    read: false,
    created_by: data.from_user,
  })
  return { success: !error }
}

export async function createNotification(data: {
  user_id: string
  title: string
  body?: string
  type?: string
  related_id?: string
  created_by?: string
}): Promise<{ success: boolean }> {
  const supabase = createServerClient()
  const payload = {
    user_id: data.user_id,
    title: data.title,
    message: data.body ?? null,
    body: data.body ?? null,
    type: data.type ?? 'info',
    link: data.related_id ?? null,
    related_id: data.related_id ?? null,
    read: false,
    is_read: false,
    created_by: data.created_by ?? null,
  }
  const { error } = await supabase.from('notifications').insert(payload)
  return { success: !error }
}
