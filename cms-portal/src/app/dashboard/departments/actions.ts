'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Department } from '@/types'
import { canonicalDepartmentKey, mapDepartmentCsvToOfficial, splitDepartmentsCsv } from '@/lib/department-name'

const DEPARTMENTS_CACHE_TAG = 'departments-data'

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

function appendDepartmentToCsv(source: string | null | undefined, departmentName: string) {
  const nextName = departmentName.trim()
  if (!nextName) return (source ?? '').trim()

  const values = splitDepartmentsCsv(source ?? '')
  const nextKey = canonicalDepartmentKey(nextName)
  const withoutSame = values.filter((value) => canonicalDepartmentKey(value) !== nextKey)
  return [...withoutSame, nextName].join(', ')
}

export async function getDepartments(): Promise<Department[]> {
  const user = await getSession()
  if (!user) return []
  return unstable_cache(async () => {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('departments')
      .select('id, name, description, created_at')
      .order('name')

    if (error) { console.error('getDepartments error:', error); return [] }
    return (data as unknown as Department[]) ?? []
  }, ['departments-page'], { revalidate: 60, tags: [DEPARTMENTS_CACHE_TAG] })()
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
  return unstable_cache(async () => {
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
  }, ['department-member-names'], { revalidate: 60, tags: [DEPARTMENTS_CACHE_TAG] })()
}

export async function getUsersForDepartmentAssignment(): Promise<Array<{ username: string; department: string | null }>> {
  const user = await getSession()
  if (!user) return []
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) return []

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const { data, error } = await supabase
        .from('users')
        .select('username,department')
        .order('username', { ascending: true })
      if (error) return []
      return (data as Array<{ username: string; department: string | null }>) ?? []
    },
    ['dept-assignment-users'],
    { revalidate: 60, tags: [DEPARTMENTS_CACHE_TAG] }
  )()
}

export async function assignUsersToDepartment(
  departmentName: string,
  usernames: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const cleanDepartment = departmentName.trim()
  const cleanUsernames = Array.from(new Set(usernames.map((u) => u.trim()).filter(Boolean)))
  if (!cleanDepartment) return { success: false, error: 'Department is required.' }
  if (!cleanUsernames.length) return { success: false, error: 'Select at least one user.' }

  const supabase = createServerClient()
  const { data: users, error } = await supabase
    .from('users')
    .select('username,department')
    .in('username', cleanUsernames)

  if (error) return { success: false, error: error.message }

  const updateResults = await Promise.all(
    ((users ?? []) as Array<{ username: string; department: string | null }>).map(row => {
      const nextCsv = appendDepartmentToCsv(row.department, cleanDepartment)
      return supabase
        .from('users')
        .update({ department: nextCsv || null })
        .eq('username', row.username)
    })
  )
  const firstError = updateResults.find(r => r.error)
  if (firstError?.error) return { success: false, error: firstError.error.message }

  revalidatePath('/dashboard/departments')
  revalidatePath('/dashboard/users')
  revalidateTag(DEPARTMENTS_CACHE_TAG)
  return { success: true }
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
      .select('id, name, description, created_at')
      .single()

    const fallback = primary.error
      ? await supabase
        .from('departments')
        .update({ name: normalizedName })
        .eq('id', dept.id)
        .select('id, name, description, created_at')
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

      await Promise.all(
        updates.map(row =>
          supabase
            .from('users')
            .update({ department: row.next || null })
            .eq('username', row.username)
        )
      )

      const { data: queued } = await supabase
        .from('todos')
        .select('id,queue_department')
        .not('queue_department', 'is', null)

      const oldKey = canonicalDepartmentKey(old.name)
      const matchingIds = ((queued ?? []) as Array<{ id: string; queue_department: string | null }>)
        .filter(task => {
          const current = task.queue_department ?? ''
          return current && canonicalDepartmentKey(current) === oldKey
        })
        .map(task => task.id)

      if (matchingIds.length > 0) {
        await supabase
          .from('todos')
          .update({ queue_department: normalizedName })
          .in('id', matchingIds)
      }
    }

    revalidatePath('/dashboard/departments')
    revalidateTag(DEPARTMENTS_CACHE_TAG)
    return { success: true, department: data as Department }
  } else {
    const primary = await supabase
      .from('departments')
      .insert({ name: normalizedName, description: normalizedDescription })
      .select('id, name, description, created_at')
      .single()

    const fallback = primary.error
      ? await supabase
        .from('departments')
        .insert({ name: normalizedName })
        .select('id, name, description, created_at')
        .single()
      : null

    const error = primary.error ?? fallback?.error
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Department already exists.' }
      return { success: false, error: error.message }
    }

    const data = (primary.data ?? fallback?.data) as Department

    revalidatePath('/dashboard/departments')
    revalidateTag(DEPARTMENTS_CACHE_TAG)
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
  revalidateTag(DEPARTMENTS_CACHE_TAG)
  return { success: true }
}

/**
 * One-time sync: normalizes users.department CSV values to match official
 * department names using canonical key matching. Fixes stale/old names.
 * Returns a summary of what was updated.
 */
export async function syncUserDepartmentNamesAction(): Promise<{
  success: boolean
  updated: number
  errors: number
  error?: string
}> {
  const user = await getSession()
  if (!user) return { success: false, updated: 0, errors: 0, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager'].includes(user.role)) {
    return { success: false, updated: 0, errors: 0, error: 'Permission denied. Admin or Super Manager required.' }
  }

  const supabase = createServerClient()

  const [{ data: departments }, { data: users }] = await Promise.all([
    supabase.from('departments').select('name'),
    supabase.from('users').select('username, department'),
  ])

  if (!departments || !users) {
    return { success: false, updated: 0, errors: 0, error: 'Failed to fetch data.' }
  }

  // Build canonical key → official name map
  const keyToOfficial: Record<string, string> = {}
  for (const dept of departments as Array<{ name: string }>) {
    const key = canonicalDepartmentKey(dept.name)
    if (key && !keyToOfficial[key]) keyToOfficial[key] = dept.name
  }

  let updated = 0
  let errors = 0

  const toUpdate = (users as Array<{ username: string; department: string | null }>)
    .filter(row => {
      const original = row.department ?? ''
      const fixed = mapDepartmentCsvToOfficial(original, keyToOfficial)
      return fixed !== original
    })

  const updateResults = await Promise.all(
    toUpdate.map(row => {
      const fixed = mapDepartmentCsvToOfficial(row.department ?? '', keyToOfficial)
      return supabase
        .from('users')
        .update({ department: fixed || null })
        .eq('username', row.username)
    })
  )

  for (const r of updateResults) {
    if (r.error) errors++
    else updated++
  }

  revalidatePath('/dashboard/users')
  revalidatePath('/dashboard/departments')
  revalidateTag(DEPARTMENTS_CACHE_TAG)

  return { success: true, updated, errors }
}
