'use server'

import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import { getSession, createSession, getCookieName } from '@/lib/auth'

export async function saveThemePreference(
  theme: 'light' | 'dark'
): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const supabase = createServerClient()
  try {
    await supabase
      .from('users')
      .update({ theme_preference: theme })
      .eq('username', user.username)

    // Refresh the JWT session cookie so the updated preference
    // is available on the next page load without a full re-login.
    const updatedUser = { ...user, themePreference: theme }
    const token = await createSession(updatedUser)
    const cookieStore = await cookies()
    cookieStore.set(getCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    })

    return { success: true }
  } catch {
    return { success: false }
  }
}

// ─── Profile Data ─────────────────────────────────────────────────────────────

export async function getProfileData(): Promise<{
  email: string
  department: string | null
  full_name: string | null
  avatar_data: string | null
  email_notifications_enabled: boolean
} | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('email, department, full_name, avatar_data, email_notifications_enabled')
    .eq('username', user.username)
    .single()

  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    email: (d.email as string) ?? '',
    department: (d.department as string | null) ?? null,
    full_name: (d.full_name as string | null) ?? null,
    avatar_data: (d.avatar_data as string | null) ?? null,
    email_notifications_enabled: (d.email_notifications_enabled as boolean) ?? false,
  }
}

// ─── Update Profile ───────────────────────────────────────────────────────────

export async function updateProfile(data: {
  email?: string
  full_name?: string
  department?: string | null
  avatar_data?: string | null
  email_notifications_enabled?: boolean
}): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated' }

  const supabase = createServerClient()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (data.email !== undefined) updates.email = data.email
  if (data.department !== undefined) updates.department = data.department
  if (data.avatar_data !== undefined) updates.avatar_data = data.avatar_data
  if (data.email_notifications_enabled !== undefined) updates.email_notifications_enabled = data.email_notifications_enabled
  // full_name is optional column — handle gracefully
  if (data.full_name !== undefined) {
    try {
      await supabase.from('users').update({ full_name: data.full_name } as Record<string, unknown>).eq('username', user.username)
    } catch { /* column may not exist */ }
  }

  const { error } = await supabase.from('users').update(updates).eq('username', user.username)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

// ─── Change Password ──────────────────────────────────────────────────────────

export async function changePassword(data: {
  currentPassword: string
  newPassword: string
}): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated' }

  const supabase = createServerClient()
  const { data: userData } = await supabase
    .from('users')
    .select('password')
    .eq('username', user.username)
    .single()

  if (!userData) return { success: false, error: 'User not found' }
  const u = userData as { password: string | null }
  if (u.password !== data.currentPassword) {
    return { success: false, error: 'Current password is incorrect' }
  }
  if (data.newPassword.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' }
  }
  const { error } = await supabase
    .from('users')
    .update({ password: data.newPassword, updated_at: new Date().toISOString() })
    .eq('username', user.username)
  if (error) return { success: false, error: error.message }
  return { success: true }
}
