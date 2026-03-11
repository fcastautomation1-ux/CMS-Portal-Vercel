'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Package } from '@/types'

type PackageAssignmentUser = {
  username: string
  role: string
  department: string | null
}

export async function getPackages(): Promise<Package[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const [{ data, error }, { data: assignmentRows }] = await Promise.all([
    supabase
      .from('packages')
      .select('*')
      .order('name'),
    supabase
      .from('user_packages')
      .select('package_id,user_id'),
  ])

  if (error) { console.error('getPackages error:', error); return [] }

  const assignedCountByPackage: Record<string, number> = {}
  for (const row of (assignmentRows ?? []) as Array<{ package_id?: string }>) {
    if (!row.package_id) continue
    assignedCountByPackage[row.package_id] = (assignedCountByPackage[row.package_id] || 0) + 1
  }

  return ((data as unknown as Package[]) ?? []).map(pkg => ({
    ...pkg,
    assigned_users_count: assignedCountByPackage[pkg.id] || 0,
  }))
}

export async function savePackage(
  pkg: {
    id?: string
    name: string
    app_name: string
    description: string
    category: string
    price: number | null
    is_active: boolean
  }
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
        app_name: pkg.app_name || null,
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
        app_name: pkg.app_name || null,
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

export async function getPackageAssignmentUsers(): Promise<PackageAssignmentUser[]> {
  const user = await getSession()
  if (!user) return []
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) return []

  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('username,role,department')
    .order('username')

  return (data as PackageAssignmentUser[] | null) ?? []
}

export async function getAssignedUsersForPackage(packageId: string): Promise<string[]> {
  const user = await getSession()
  if (!user) return []
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) return []

  const supabase = createServerClient()
  const { data } = await supabase
    .from('user_packages')
    .select('user_id')
    .eq('package_id', packageId)

  return ((data ?? []) as Array<{ user_id: string }>).map(r => r.user_id)
}

export async function setAssignedUsersForPackage(
  packageId: string,
  usernames: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error: deleteError } = await supabase
    .from('user_packages')
    .delete()
    .eq('package_id', packageId)

  if (deleteError) return { success: false, error: deleteError.message }

  const cleanUsers = Array.from(new Set(usernames.map(u => u.trim()).filter(Boolean)))
  if (cleanUsers.length > 0) {
    const rows = cleanUsers.map(username => ({
      user_id: username,
      package_id: packageId,
      assigned_by: user.username,
    }))

    const { error: insertError } = await supabase.from('user_packages').insert(rows)
    if (insertError) {
      const fallbackRows = cleanUsers.map(username => ({ user_id: username, package_id: packageId }))
      const { error: fallbackError } = await supabase.from('user_packages').insert(fallbackRows)
      if (fallbackError) return { success: false, error: fallbackError.message }
    }
  }

  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/users')
  revalidatePath('/dashboard/tasks')
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
  await supabase.from('user_packages').delete().eq('package_id', id)
  const { error } = await supabase.from('packages').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/packages')
  return { success: true }
}
