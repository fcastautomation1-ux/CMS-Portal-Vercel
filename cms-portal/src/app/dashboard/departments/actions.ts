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

export async function getDepartmentMembersWithNames(): Promise<Record<string, string[]>> {
  const supabase = createServerClient()
  const { data } = await supabase.from('users').select('username,department')
  if (!data) return {}
  const map: Record<string, string[]> = {}
  for (const row of data as Array<{ username: string; department: string | null }>) {
    if (row.department) {
      if (!map[row.department]) map[row.department] = []
      map[row.department].push(row.username)
    }
  }
  return map
}

export async function saveDepartment(
  dept: { id?: string; name: string }
): Promise<{ success: boolean; error?: string; department?: Department }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const normalizedName = dept.name.trim()
  if (!normalizedName) return { success: false, error: 'Department name is required.' }

  if (dept.id) {
    // Get old name for cascade rename
    const { data: old } = await supabase.from('departments').select('name').eq('id', dept.id).single()
    const { data, error } = await supabase
      .from('departments')
      .update({ name: normalizedName })
      .eq('id', dept.id)
      .select('*')
      .single()
    if (error) return { success: false, error: error.message }

    // Cascade rename in users + todos
    if (old && old.name !== normalizedName) {
      await supabase.from('users').update({ department: normalizedName }).eq('department', old.name)
      await supabase.from('todos').update({ queue_department: normalizedName }).eq('queue_department', old.name)
    }

    revalidatePath('/dashboard/departments')
    return { success: true, department: data as Department }
  } else {
    const { data, error } = await supabase
      .from('departments')
      .insert({ name: normalizedName })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Department already exists.' }
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard/departments')
    return { success: true, department: data as Department }
  }
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
