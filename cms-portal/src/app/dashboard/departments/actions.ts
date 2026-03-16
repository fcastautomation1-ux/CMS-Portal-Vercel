'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Department } from '@/types'

function replaceDepartmentInCsv(source: string, oldName: string, nextName: string) {
  const oldKey = oldName.trim().toLowerCase()
  if (!oldKey) return source

  const values = source
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const replaced = values.map((value) => (
    value.toLowerCase() === oldKey ? nextName : value
  ))

  // de-duplicate while preserving order
  const unique = Array.from(new Set(replaced))
  return unique.join(', ')
}

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
    const depts = ((row as { department: string | null }).department ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    for (const dept of depts) {
      counts[dept] = (counts[dept] || 0) + 1
    }
  }
  return counts
}

export async function getDepartmentMembersWithNames(): Promise<Record<string, string[]>> {
  const supabase = createServerClient()
  const { data } = await supabase.from('users').select('username,department')
  if (!data) return {}
  const map: Record<string, string[]> = {}
  for (const row of data as Array<{ username: string; department: string | null }>) {
    const depts = (row.department ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    for (const dept of depts) {
      if (!map[dept]) map[dept] = []
      map[dept].push(row.username)
    }
  }
  return map
}

export async function saveDepartment(
  dept: { id?: string; name: string; description?: string }
): Promise<{ success: boolean; error?: string; department?: Department }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const normalizedName = dept.name.trim()
  const normalizedDescription = dept.description?.trim() || null
  if (!normalizedName) return { success: false, error: 'Department name is required.' }

  if (dept.id) {
    // Get old name for cascade rename
    const { data: old } = await supabase.from('departments').select('name').eq('id', dept.id).single()
    const primary = await supabase
      .from('departments')
      .update({ name: normalizedName, description: normalizedDescription })
      .eq('id', dept.id)
      .select('*')
      .single()

    const fallback = primary.error
      ? await supabase
        .from('departments')
        .update({ name: normalizedName })
        .eq('id', dept.id)
        .select('*')
        .single()
      : null

    if (primary.error && fallback?.error) return { success: false, error: fallback.error.message }
    const data = (primary.data ?? fallback?.data) as Department

    // Cascade rename in users + todos
    if (old && old.name !== normalizedName) {
      const { data: impactedUsers } = await supabase
        .from('users')
        .select('username,department')
        .ilike('department', `%${old.name}%`)

      const updates = ((impactedUsers ?? []) as Array<{ username: string; department: string | null }>)
        .map((row) => {
          const current = row.department ?? ''
          const next = replaceDepartmentInCsv(current, old.name, normalizedName)
          return { username: row.username, next }
        })
        .filter((row) => row.next !== ((impactedUsers ?? []) as Array<{ username: string; department: string | null }>).find(x => x.username === row.username)?.department)

      for (const row of updates) {
        await supabase
          .from('users')
          .update({ department: row.next || null })
          .eq('username', row.username)
      }

      await supabase.from('todos').update({ queue_department: normalizedName }).eq('queue_department', old.name)
    }

    revalidatePath('/dashboard/departments')
    return { success: true, department: data as Department }
  } else {
    const primary = await supabase
      .from('departments')
      .insert({ name: normalizedName, description: normalizedDescription })
      .select('*')
      .single()

    const fallback = primary.error
      ? await supabase
        .from('departments')
        .insert({ name: normalizedName })
        .select('*')
        .single()
      : null

    const error = primary.error ?? fallback?.error
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Department already exists.' }
      return { success: false, error: error.message }
    }

    const data = (primary.data ?? fallback?.data) as Department

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
