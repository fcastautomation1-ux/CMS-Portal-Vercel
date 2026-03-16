'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { buildLegacyPasswordFields } from '@/lib/password'
import { resolveStorageUrl } from '@/lib/storage'
import type { ModuleAccess, User } from '@/types'

export interface UserFormOptions {
  accounts: Array<{ customer_id: string; account_name: string | null }>
  lookerReports: Array<{ id: string; title: string }>
  managers: Array<{ username: string; role: string }>
  teamMembers: Array<{ username: string; role: string; department: string | null }>
}

export async function getUsers(): Promise<User[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const withResolvedAvatars = async (rows: User[]) =>
    Promise.all(
      rows.map(async (row) => ({
        ...row,
        avatar_data: await resolveStorageUrl(supabase, row.avatar_data),
      }))
    )

  // Admin and Super Manager see ALL users
  if (user.role === 'Admin' || user.role === 'Super Manager') {
    const { data } = await supabase.from('users').select('*').order('username')
    return withResolvedAvatars((data as unknown as User[]) ?? [])
  }

  // Manager sees a restricted set
  if (user.role === 'Manager') {
    const { data } = await supabase.from('users').select('*').order('username')
    if (!data) return []
    const all = data as unknown as User[]

    // If department-restricted: only same-department users
    if (user.moduleAccess?.users?.departmentRestricted && user.department) {
      return withResolvedAvatars(all.filter(u => u.department === user.department))
    }

    // Default Manager: see self + users where manager_id === me + team_members list
    const teamList = user.teamMembers.map(t => t.toLowerCase())
    return withResolvedAvatars(all.filter(u =>
      u.username === user.username ||
      u.manager_id === user.username ||
      teamList.includes(u.username.toLowerCase())
    ))
  }

  // Supervisor / User: no access to Users module
  return []
}

export async function createUser(
  userData: {
    username: string; email: string; role: string; department: string;
    password: string; allowed_accounts: string; allowed_campaigns: string;
    allowed_drive_folders: string; allowed_looker_reports: string;
    drive_access_level: string; manager_id: string; team_members?: string; module_access?: ModuleAccess | null; email_notifications_enabled: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(session.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  // Managers cannot create Admin/Super Manager/Manager roles — only User or Supervisor
  if (session.role === 'Manager' && ['Admin', 'Super Manager', 'Manager'].includes(userData.role)) {
    return { success: false, error: 'Managers can only create User or Supervisor accounts.' }
  }
  // Only Admin or Super Manager can create Super Manager accounts
  if (userData.role === 'Super Manager' && !['Admin', 'Super Manager'].includes(session.role)) {
    return { success: false, error: 'Only Super Managers can create Super Manager accounts.' }
  }
  const { error } = await supabase.from('users').insert({
    username: userData.username.trim(),
    email: userData.email.trim(),
    role: userData.role,
    department: userData.department || null,
    ...buildLegacyPasswordFields(userData.password),
    allowed_accounts: userData.allowed_accounts || '',
    allowed_campaigns: userData.allowed_campaigns || '',
    allowed_drive_folders: userData.allowed_drive_folders || '',
    allowed_looker_reports: userData.allowed_looker_reports || '',
    drive_access_level: userData.drive_access_level || 'none',
    manager_id: userData.manager_id || null,
    team_members: userData.team_members || '',
    module_access: userData.module_access || null,
    email_notifications_enabled: userData.email_notifications_enabled,
  })

  if (error) {
    if (error.code === '23505') return { success: false, error: 'Username already exists.' }
    return { success: false, error: error.message }
  }
  revalidatePath('/dashboard/users')
  revalidatePath('/dashboard/departments')
  return { success: true }
}

export async function updateUser(
  username: string,
  userData: {
    email: string; role: string; department: string;
    password?: string; allowed_accounts: string; allowed_campaigns: string;
    allowed_drive_folders: string; allowed_looker_reports: string;
    drive_access_level: string; manager_id: string; team_members?: string; module_access?: ModuleAccess | null; email_notifications_enabled: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(session.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  // Prevent role changes to/from Super Manager by non-Super Managers/Admins
  if (userData.role === 'Super Manager' && !['Admin', 'Super Manager'].includes(session.role)) {
    return { success: false, error: 'Only Super Managers can assign the Super Manager role.' }
  }
  // Managers can only edit users they directly manage (manager_id = them or in teamMembers)
  if (session.role === 'Manager') {
    const teamList = session.teamMembers.map(t => t.toLowerCase())
    const isSelf = username === session.username
    const isManagedUser = await (async () => {
      const { data } = await supabase.from('users').select('manager_id').eq('username', username).single()
      return data?.manager_id === session.username || teamList.includes(username.toLowerCase())
    })()
    if (!isSelf && !isManagedUser) {
      return { success: false, error: 'You can only edit users you directly manage.' }
    }
  }
  const update: Record<string, unknown> = {
    email: userData.email.trim(),
    role: userData.role,
    department: userData.department || null,
    allowed_accounts: userData.allowed_accounts || '',
    allowed_campaigns: userData.allowed_campaigns || '',
    allowed_drive_folders: userData.allowed_drive_folders || '',
    allowed_looker_reports: userData.allowed_looker_reports || '',
    drive_access_level: userData.drive_access_level || 'none',
    manager_id: userData.manager_id || null,
    team_members: userData.team_members || '',
    module_access: userData.module_access || null,
    email_notifications_enabled: userData.email_notifications_enabled,
  }
  if (userData.password) Object.assign(update, buildLegacyPasswordFields(userData.password))

  const { error } = await supabase.from('users').update(update).eq('username', username)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/users')
  revalidatePath('/dashboard/departments')
  return { success: true }
}

export async function deleteUser(
  username: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session) return { success: false, error: 'Not authenticated.' }
  if (username === 'admin') return { success: false, error: 'Cannot delete admin user.' }
  if (!['Admin', 'Super Manager'].includes(session.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('users').delete().eq('username', username)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/users')
  revalidatePath('/dashboard/departments')
  return { success: true }
}

export async function getDepartmentsList(): Promise<string[]> {
  const supabase = createServerClient()
  const { data } = await supabase.from('departments').select('name').order('name')
  return data?.map(d => d.name) ?? []
}

export async function getUserFormOptions(): Promise<UserFormOptions> {
  const session = await getSession()
  if (!session) {
    return { accounts: [], lookerReports: [], managers: [], teamMembers: [] }
  }

  const supabase = createServerClient()
  const [accountsPrimary, lookerPrimaryBySort, managersRes, usersRes] = await Promise.all([
    supabase.from('accounts').select('customer_id,account_name').order('customer_id'),
    supabase.from('looker_reports').select('id,title,name').order('sort_order'),
    supabase.from('users').select('username,role').in('role', ['Admin', 'Super Manager', 'Manager']).order('username'),
    supabase.from('users').select('username,role,department').order('username'),
  ])

  const accountsFallback = accountsPrimary.error
    ? await supabase.from('accounts').select('*').order('customer_id')
    : null

  const lookerResByUpdatedAt = lookerPrimaryBySort.error
    ? await supabase.from('looker_reports').select('id,title,name').order('updated_at', { ascending: false })
    : lookerPrimaryBySort

  const lookerFallbackAny = lookerResByUpdatedAt.error
    ? await supabase.from('looker_reports').select('*').order('id')
    : null

  const rawAccounts = ((accountsPrimary.data ?? accountsFallback?.data ?? []) as Array<{
    customer_id?: string | null
    account_name?: string | null
    name?: string | null
    id?: string | null
  }>)

  const accounts = rawAccounts
    .map((a) => {
      const customerId = String(a.customer_id ?? a.id ?? '').trim()
      if (!customerId) return null
      return {
        customer_id: customerId,
        account_name: a.account_name ?? a.name ?? null,
      }
    })
    .filter((a): a is { customer_id: string; account_name: string | null } => Boolean(a))

  const uniqueAccountsMap = new Map<string, { customer_id: string; account_name: string | null }>()
  for (const account of accounts) uniqueAccountsMap.set(account.customer_id, account)

  const rawLookerReports = ((lookerResByUpdatedAt.data ?? lookerFallbackAny?.data ?? []) as Array<{
    id?: string | null
    title?: string | null
    name?: string | null
  }>)

  const lookerReports = rawLookerReports
    .map((r) => {
      const id = String(r.id ?? r.name ?? r.title ?? '').trim()
      const title = (r.title ?? r.name ?? '').trim() || 'Untitled Report'
      if (!id) return null
      return { id, title }
    })
    .filter((r): r is { id: string; title: string } => Boolean(r))

  const uniqueLookerMap = new Map<string, { id: string; title: string }>()
  for (const report of lookerReports) uniqueLookerMap.set(report.id, report)

  return {
    accounts: Array.from(uniqueAccountsMap.values()),
    lookerReports: Array.from(uniqueLookerMap.values()),
    managers: (managersRes.data as Array<{ username: string; role: string }>) ?? [],
    teamMembers: (usersRes.data as Array<{ username: string; role: string; department: string | null }>) ?? [],
  }
}
