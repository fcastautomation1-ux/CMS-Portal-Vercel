'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Notification } from '@/types'

export async function getNotifications(): Promise<Notification[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.username)
    .order('created_at', { ascending: false })
    .limit(30)

  return (data as unknown as Notification[]) ?? []
}

export async function getUnreadCount(): Promise<number> {
  const user = await getSession()
  if (!user) return 0

  const supabase = createServerClient()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.username)
    .eq('is_read', false)

  return count ?? 0
}

export async function markNotificationRead(
  id: string
): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', user.username)

  return { success: !error }
}

export async function markAllNotificationsRead(): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.username)
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
