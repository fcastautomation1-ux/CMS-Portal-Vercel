'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

export async function saveThemePreference(
  theme: 'light' | 'dark'
): Promise<{ success: boolean }> {
  const user = await getSession()
  if (!user) return { success: false }

  const supabase = createServerClient()
  // Gracefully handle case where theme_preference column doesn't exist yet
  try {
    await supabase
      .from('users')
      .update({ theme_preference: theme } as Record<string, unknown>)
      .eq('username', user.username)
    return { success: true }
  } catch {
    return { success: false }
  }
}
