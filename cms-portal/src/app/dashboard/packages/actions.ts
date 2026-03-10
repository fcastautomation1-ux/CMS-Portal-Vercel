'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Package } from '@/types'

export async function getPackages(): Promise<Package[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('packages')
    .select('*')
    .order('name')

  if (error) { console.error('getPackages error:', error); return [] }
  return (data as unknown as Package[]) ?? []
}

export async function savePackage(
  pkg: { id?: string; name: string; description: string; category: string; price: number | null; is_active: boolean }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()

  if (pkg.id) {
    const { error } = await supabase
      .from('packages')
      .update({
        name: pkg.name,
        description: pkg.description || null,
        category: pkg.category || null,
        price: pkg.price,
        is_active: pkg.is_active,
      })
      .eq('id', pkg.id)
    if (error) return { success: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('packages')
      .insert({
        name: pkg.name,
        description: pkg.description || null,
        category: pkg.category || null,
        price: pkg.price,
        is_active: pkg.is_active,
        created_by: user.username,
      })
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/packages')
  return { success: true }
}

export async function deletePackage(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('packages').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/packages')
  return { success: true }
}
