'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Package } from '@/types'

const PACKAGES_CACHE_TAG = 'packages-data'

type PackageAssignmentUser = {
  username: string
  role: string
  department: string | null
}

type UserPackageAssignment = {
  username: string
  package_id: string
}

function canManagePackages(role: string) {
  return ['Admin', 'Super Manager', 'Manager'].includes(role)
}

function normalizePackageName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function isDuplicateKeyError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')
}

async function findExistingPackageByName(
  supabase: ReturnType<typeof createServerClient>,
  packageName: string,
): Promise<{ id: string; name: string } | null> {
  const normalizedTarget = normalizePackageName(packageName)
  if (!normalizedTarget) return null

  const { data, error } = await supabase
    .from('packages')
    .select('id,name')
    .order('name')

  if (error) {
    console.error('findExistingPackageByName error:', error)
    return null
  }

  const rows = (data ?? []) as Array<{ id: string; name: string }>
  return rows.find((row) => normalizePackageName(row.name) === normalizedTarget) ?? null
}

async function getUserPackageRows(supabase: ReturnType<typeof createServerClient>): Promise<Array<{ package_id: string; username: string }>> {
  const byUserId = await supabase.from('user_packages').select('package_id,user_id')
  if (!byUserId.error) {
    return ((byUserId.data ?? []) as Array<{ package_id: string; user_id: string }>).map(r => ({ package_id: r.package_id, username: r.user_id }))
  }

  const byUsername = await supabase.from('user_packages').select('package_id,username')
  if (!byUsername.error) {
    return ((byUsername.data ?? []) as Array<{ package_id: string; username: string }>).map(r => ({ package_id: r.package_id, username: r.username }))
  }

  return []
}

export async function getPackages(): Promise<Package[]> {
  const user = await getSession()
  if (!user || !canManagePackages(user.role)) return []
  return unstable_cache(async () => {
    const supabase = createServerClient()
    const [{ data, error }, assignmentRows] = await Promise.all([
      supabase.from('packages').select('*').order('name'),
      getUserPackageRows(supabase),
    ])

    if (error) { console.error('[getPackages] query error:', error.message); return [] }

    const assignedCountByPackage: Record<string, number> = {}
    for (const row of assignmentRows) {
      if (!row.package_id) continue
      assignedCountByPackage[row.package_id] = (assignedCountByPackage[row.package_id] || 0) + 1
    }

    return ((data as unknown as Package[]) ?? []).map(pkg => ({
      ...pkg,
      assigned_users_count: assignedCountByPackage[pkg.id] || 0,
    }))
  }, ['packages-page'], { revalidate: 60, tags: [PACKAGES_CACHE_TAG] })()
}

export async function getPackageAssignmentUsers(): Promise<PackageAssignmentUser[]> {
  const user = await getSession()
  if (!user || !canManagePackages(user.role)) return []

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const { data } = await supabase
        .from('users')
        .select('username,role,department')
        .order('username')
      return (data as PackageAssignmentUser[] | null) ?? []
    },
    ['package-assignment-users'],
    { revalidate: 60, tags: [PACKAGES_CACHE_TAG] }
  )()
}

export async function getUserPackageAssignments(): Promise<UserPackageAssignment[]> {
  const user = await getSession()
  if (!user || !canManagePackages(user.role)) return []

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const rows = await getUserPackageRows(supabase)
      return rows.map(r => ({ username: r.username, package_id: r.package_id }))
    },
    ['user-package-assignments'],
    { revalidate: 60, tags: [PACKAGES_CACHE_TAG] }
  )()
}

export async function assignPackagesToUser(
  username: string,
  packageIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canManagePackages(user.role)) return { success: false, error: 'Permission denied.' }

  const supabase = createServerClient()

  const deleteByUserId = await supabase.from('user_packages').delete().eq('user_id', username)
  if (deleteByUserId.error) {
    const deleteByUsername = await supabase.from('user_packages').delete().eq('username', username)
    if (deleteByUsername.error) return { success: false, error: deleteByUsername.error.message }
  }

  const cleanIds = Array.from(new Set(packageIds.filter(Boolean)))
  if (cleanIds.length > 0) {
    const rowsWithUserId = cleanIds.map(packageId => ({
      user_id: username,
      package_id: packageId,
      assigned_by: user.username,
    }))

    const insertByUserId = await supabase.from('user_packages').insert(rowsWithUserId)
    if (insertByUserId.error) {
      const rowsWithUsername = cleanIds.map(packageId => ({
        username,
        package_id: packageId,
        assigned_by: user.username,
      }))
      const insertByUsername = await supabase.from('user_packages').insert(rowsWithUsername)
      if (insertByUsername.error) return { success: false, error: insertByUsername.error.message }
    }
  }

  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/tasks')
  revalidateTag(PACKAGES_CACHE_TAG)
  return { success: true }
}

export async function addPackagesBulk(
  packageNames: string[],
  department: string
): Promise<{ success: boolean; total?: number; inserted?: number; skipped?: number; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canManagePackages(user.role)) return { success: false, error: 'Permission denied.' }

  const normalized = Array.from(new Set(
    (packageNames || []).map(n => (n || '').trim()).filter(Boolean)
  ))

  if (normalized.length === 0) {
    return { success: false, error: 'No valid package names found.' }
  }

  const supabase = createServerClient()
  const { data: exactExisting, error: existingError } = await supabase
    .from('packages')
    .select('id,name')
    .in('name', normalized)

  if (existingError) return { success: false, error: existingError.message }

  const { data: allExisting, error: allExistingError } = await supabase
    .from('packages')
    .select('id,name')
    .order('name')

  if (allExistingError) return { success: false, error: allExistingError.message }

  const existingSet = new Set(
    ([...((exactExisting ?? []) as Array<{ id: string; name: string }>), ...((allExisting ?? []) as Array<{ id: string; name: string }>)])
      .map(p => normalizePackageName(p.name))
      .filter(Boolean)
  )
  const toInsert = normalized
    .filter(name => !existingSet.has(normalizePackageName(name)))
    .map(name => ({
      name,
      app_name: null,
      description: '',
      department: department || null,
      created_by: user.username,
    }))

  if (toInsert.length > 0) {
    const { error } = await supabase.from('packages').insert(toInsert)
    if (error) {
      console.error('addPackagesBulk insert error:', error)
      return { success: false, error: error.message }
    }
  }

  revalidatePath('/dashboard/packages')
  revalidateTag(PACKAGES_CACHE_TAG)
  return {
    success: true,
    total: normalized.length,
    inserted: toInsert.length,
    skipped: normalized.length - toInsert.length,
  }
}

export async function savePackage(
  pkg: {
    id?: string
    name: string
    app_name: string
    playconsole_account: string
    marketer: string
    product_owner: string
    monetization: string
    admob: string
    description: string
    department: string
  }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canManagePackages(user.role)) return { success: false, error: 'Permission denied.' }

  if (!pkg.name?.trim()) return { success: false, error: 'Package name is required.' }
  if (!pkg.app_name?.trim()) return { success: false, error: 'APP/Games name is required.' }

  const supabase = createServerClient()
  const normalizedPackageName = pkg.name.trim()

  const existingPackage = await findExistingPackageByName(supabase, normalizedPackageName)
  if (existingPackage && existingPackage.id !== pkg.id) {
    return { success: false, error: `Package name already exists: ${existingPackage.name}` }
  }

  if (pkg.id) {
    const { error } = await supabase
      .from('packages')
      .update({
        app_name: pkg.app_name.trim(),
        description: (pkg.description || '').trim(),
        department: pkg.department || null,
        playconsole_account: (pkg.playconsole_account || '').trim(),
        marketer: (pkg.marketer || '').trim(),
        product_owner: (pkg.product_owner || '').trim(),
        monetization: (pkg.monetization || '').trim(),
        admob: (pkg.admob || '').trim(),
      })
      .eq('id', pkg.id)

    if (error) {
      console.error('savePackage update error:', error)
      if (isDuplicateKeyError(error)) {
        return { success: false, error: `Package name already exists: ${normalizedPackageName}` }
      }
      return { success: false, error: error.message }
    }
  } else {
    const { error } = await supabase
      .from('packages')
      .insert({
        name: normalizedPackageName,
        app_name: pkg.app_name.trim(),
        description: (pkg.description || '').trim(),
        department: pkg.department || null,
        playconsole_account: (pkg.playconsole_account || '').trim(),
        marketer: (pkg.marketer || '').trim(),
        product_owner: (pkg.product_owner || '').trim(),
        monetization: (pkg.monetization || '').trim(),
        admob: (pkg.admob || '').trim(),
        created_by: user.username,
      })

    if (error) {
      console.error('savePackage insert error:', error)
      if (isDuplicateKeyError(error)) {
        return { success: false, error: `Package name already exists: ${normalizedPackageName}` }
      }
      return { success: false, error: error.message }
    }
  }

  revalidatePath('/dashboard/packages')
  revalidateTag(PACKAGES_CACHE_TAG)
  return { success: true }
}

export async function deletePackage(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canManagePackages(user.role)) return { success: false, error: 'Permission denied.' }

  const supabase = createServerClient()
  await supabase.from('user_packages').delete().eq('package_id', id)
  const { error } = await supabase.from('packages').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/packages')
  revalidateTag(PACKAGES_CACHE_TAG)
  return { success: true }
}

// ─── Bulk assign departments to packages ──────────────────────
// Sets/merges the department field for all given package IDs.
export async function bulkAssignDepartments(
  packageIds: string[],
  departments: string[]   // multi-select list of department names
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canManagePackages(user.role)) return { success: false, error: 'Permission denied.' }
  if (!packageIds.length) return { success: false, error: 'No packages selected.' }

  const supabase = createServerClient()
  const deptStr = departments.join(', ')   // stored as comma-separated string

  const { error } = await supabase
    .from('packages')
    .update({ department: deptStr || null })
    .in('id', packageIds)

  if (error) {
    console.error('bulkAssignDepartments update error:', error)
    return { success: false, error: error.message }
  }
  revalidatePath('/dashboard/packages')
  revalidateTag(PACKAGES_CACHE_TAG)
  return { success: true }
}

// ─── Bulk assign packages to multiple users ───────────────────
// For each username, REPLACES their package list with a union of
// their existing assignments + the newly selected packageIds.
export async function bulkAssignPackagesToUsers(
  usernames: string[],
  packageIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canManagePackages(user.role)) return { success: false, error: 'Permission denied.' }
  if (!usernames.length || !packageIds.length) {
    return { success: false, error: 'Select at least one user and one package.' }
  }

  const supabase = createServerClient()
  const cleanIds = Array.from(new Set(packageIds.filter(Boolean)))

  // Fetch all existing assignments once instead of per-user
  const allExistingRows = await getUserPackageRows(supabase)

  for (const username of usernames) {
    const existing = allExistingRows
      .filter(r => r.username === username)
      .map(r => r.package_id)
    const merged = Array.from(new Set([...existing, ...cleanIds]))

    // Delete & re-insert (use same dual-column fallback as assignPackagesToUser)
    const delById = await supabase.from('user_packages').delete().eq('user_id', username)
    if (delById.error) {
      await supabase.from('user_packages').delete().eq('username', username)
    }

    if (merged.length > 0) {
      const rows = merged.map(packageId => ({
        user_id: username,
        package_id: packageId,
        assigned_by: user.username,
      }))
      const ins = await supabase.from('user_packages').insert(rows)
      if (ins.error) {
        const rowsFallback = merged.map(packageId => ({
          username,
          package_id: packageId,
          assigned_by: user.username,
        }))
        const insFallback = await supabase.from('user_packages').insert(rowsFallback)
        if (insFallback.error) return { success: false, error: insFallback.error.message }
      }
    }
  }

  revalidatePath('/dashboard/packages')
  revalidateTag(PACKAGES_CACHE_TAG)
  return { success: true }
}

