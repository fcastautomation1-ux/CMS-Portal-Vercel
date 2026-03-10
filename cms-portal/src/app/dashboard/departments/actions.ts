'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Department } from '@/types'

export async function getDepartments(): Promise<Department[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .order('name')

  if (error) { console.error('getDepartments error:', error); return [] }
  return (data as unknown as Department[]) ?? []
}

export async function getDepartmentMembers(): Promise<Record<string, number>> {
  const supabase = createServerClient()
  const { data } = await supabase.from('users').select('department')
  if (!data) return {}
  const counts: Record<string, number> = {}
  for (const row of data) {
    const dept = (row as { department: string | null }).department
    if (dept) counts[dept] = (counts[dept] || 0) + 1
  }
  return counts
}

export async function saveDepartment(
  dept: { id?: string; name: string }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()

  if (dept.id) {
    // Get old name for cascade rename
    const { data: old } = await supabase.from('departments').select('name').eq('id', dept.id).single()
    const { error } = await supabase.from('departments').update({ name: dept.name }).eq('id', dept.id)
    if (error) return { success: false, error: error.message }

    // Cascade rename in users + todos
    if (old && old.name !== dept.name) {
      await supabase.from('users').update({ department: dept.name }).eq('department', old.name)
      await supabase.from('todos').update({ queue_department: dept.name }).eq('queue_department', old.name)
    }
  } else {
    const { error } = await supabase.from('departments').insert({ name: dept.name })
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Department already exists.' }
      return { success: false, error: error.message }
    }
  }

  revalidatePath('/dashboard/departments')
  return { success: true }
}

export async function deleteDepartment(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('departments').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/departments')
  return { success: true }
}
