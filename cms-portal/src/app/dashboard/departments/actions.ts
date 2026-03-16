'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Department } from '@/types'
import { canonicalDepartmentKey, mapDepartmentCsvToOfficial, splitDepartmentsCsv } from '@/lib/department-name'

function replaceDepartmentInCsv(source: string, oldName: string, nextName: string) {
  const oldKey = canonicalDepartmentKey(oldName)
  if (!oldKey) return source

  const values = splitDepartmentsCsv(source)

  const replaced = values.map((value) => (
    canonicalDepartmentKey(value) === oldKey ? nextName : value
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
  const [{ data: users }, { data: departments }] = await Promise.all([
    supabase.from('users').select('department'),
    supabase.from('departments').select('name'),
  ])
  if (!users) return {}

  const canonicalToOfficial: Record<string, string> = {}
  for (const row of (departments ?? []) as Array<{ name: string }>) {
    const key = canonicalDepartmentKey(row.name)
    if (key && !canonicalToOfficial[key]) canonicalToOfficial[key] = row.name
  }

  const counts: Record<string, number> = {}
  for (const row of users) {
    const mappedCsv = mapDepartmentCsvToOfficial((row as { department: string | null }).department, canonicalToOfficial)
    const depts = splitDepartmentsCsv(mappedCsv)
    for (const dept of depts) {
      counts[dept] = (counts[dept] || 0) + 1
    }
  }
  return counts
}

export async function getDepartmentMembersWithNames(): Promise<Record<string, string[]>> {
  const supabase = createServerClient()
  const [{ data: users }, { data: departments }] = await Promise.all([
    supabase.from('users').select('username,department'),
    supabase.from('departments').select('name'),
  ])
  if (!users) return {}

  const canonicalToOfficial: Record<string, string> = {}
  for (const row of (departments ?? []) as Array<{ name: string }>) {
    const key = canonicalDepartmentKey(row.name)
    if (key && !canonicalToOfficial[key]) canonicalToOfficial[key] = row.name
  }

  const map: Record<string, string[]> = {}
  for (const row of users as Array<{ username: string; department: string | null }>) {
    const mappedCsv = mapDepartmentCsvToOfficial(row.department, canonicalToOfficial)
    const depts = splitDepartmentsCsv(mappedCsv)

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

      const { data: queued } = await supabase
        .from('todos')
        .select('id,queue_department')
        .not('queue_department', 'is', null)

      const oldKey = canonicalDepartmentKey(old.name)
      for (const task of (queued ?? []) as Array<{ id: string; queue_department: string | null }>) {
        const current = task.queue_department ?? ''
        if (!current) continue
        if (canonicalDepartmentKey(current) !== oldKey) continue
        await supabase
          .from('todos')
          .update({ queue_department: normalizedName })
          .eq('id', task.id)
      }
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
