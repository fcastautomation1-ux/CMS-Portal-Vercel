'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
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

  // Admin and Super Manager see ALL users
  if (user.role === 'Admin' || user.role === 'Super Manager') {
    const { data } = await supabase.from('users').select('*').order('username')
    return (data as unknown as User[]) ?? []
  }

  // Manager sees a restricted set
  if (user.role === 'Manager') {
    const { data } = await supabase.from('users').select('*').order('username')
    if (!data) return []
    const all = data as unknown as User[]

    // If department-restricted: only same-department users
    if (user.moduleAccess?.users?.departmentRestricted && user.department) {
      return all.filter(u => u.department === user.department)
    }

    // Default Manager: see self + users where manager_id === me + team_members list
    const teamList = user.teamMembers.map(t => t.toLowerCase())
    return all.filter(u =>
      u.username === user.username ||
      u.manager_id === user.username ||
      teamList.includes(u.username.toLowerCase())
    )
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
    password: userData.password,
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
  if (userData.password) update.password = userData.password

  const { error } = await supabase.from('users').update(update).eq('username', username)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/users')
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
  const [accountsRes, lookerRes, managersRes, usersRes] = await Promise.all([
    supabase.from('accounts').select('customer_id,account_name').order('customer_id'),
    supabase.from('looker_reports').select('id,title').order('sort_order'),
    supabase.from('users').select('username,role').in('role', ['Admin', 'Super Manager', 'Manager']).order('username'),
    supabase.from('users').select('username,role,department').order('username'),
  ])

  return {
    accounts: (accountsRes.data as Array<{ customer_id: string; account_name: string | null }>) ?? [],
    lookerReports: (lookerRes.data as Array<{ id: string; title: string }>) ?? [],
    managers: (managersRes.data as Array<{ username: string; role: string }>) ?? [],
    teamMembers: (usersRes.data as Array<{ username: string; role: string; department: string | null }>) ?? [],
  }
}
