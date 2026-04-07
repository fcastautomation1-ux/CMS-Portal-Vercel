'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Rule } from '@/types'

const RULES_CACHE_TAG = 'rules-data'

/** Rules are only visible to Admin/SM, or Managers with 'all' account access */
function canAccessRules(user: Awaited<ReturnType<typeof getSession>>): boolean {
  if (!user) return false
  if (user.role === 'Admin' || user.role === 'Super Manager') return true
  return user.role === 'Manager' && user.moduleAccess?.googleAccount?.accessLevel === 'all'
}

export async function getRules(): Promise<Rule[]> {
  const user = await getSession()
  if (!canAccessRules(user)) return []

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const { data, error } = await supabase
        .from('removal_condition_definitions')
        .select('id, name, description')
        .order('name')
      if (error) { console.error('getRules error:', error); return [] }
      return (data as unknown as Rule[]) ?? []
    },
    ['rules-list'],
    { revalidate: 60, tags: [RULES_CACHE_TAG] }
  )()
}

export async function saveRule(
  rule: { id?: string; name: string; description: string }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canAccessRules(user)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()

  if (rule.id) {
    const { error } = await supabase
      .from('removal_condition_definitions')
      .update({ name: rule.name, description: rule.description })
      .eq('id', rule.id)
    if (error) return { success: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('removal_condition_definitions')
      .insert({ name: rule.name, description: rule.description })
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/rules')
  revalidateTag(RULES_CACHE_TAG)
  return { success: true }
}

export async function deleteRule(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canAccessRules(user)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('removal_condition_definitions')
    .delete()
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/rules')
  revalidateTag(RULES_CACHE_TAG)
  return { success: true }
}
