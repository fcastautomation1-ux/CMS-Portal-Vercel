'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
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
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .in('user_id', userKeys)
    .order('created_at', { ascending: false })

  return (data as unknown as Notification[]) ?? []
}

export async function getUnreadCount(): Promise<number> {
  const user = await getSession()
  if (!user) return 0

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .in('user_id', userKeys)
    .eq('is_read', false)

  return count ?? 0
}

export async function markNotificationRead(
  id: string
): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .in('user_id', userKeys)

  return { success: !error }
}

export async function markAllNotificationsRead(): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const userKeys = getNotificationUserKeys(user)
  const supabase = createServerClient()
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .in('user_id', userKeys)
    .eq('is_read', false)

  return { success: !error }
}

export async function createNotification(data: {
  user_id: string
  title: string
  body?: string
  type?: string
  related_id?: string
}): Promise<{ success: boolean }> {
  const supabase = createServerClient()
  const { error } = await supabase.from('notifications').insert({
    user_id: data.user_id,
    title: data.title,
    body: data.body ?? null,
    type: data.type ?? 'info',
    related_id: data.related_id ?? null,
    is_read: false,
  })

  return { success: !error }
}
