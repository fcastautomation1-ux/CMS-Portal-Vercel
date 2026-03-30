'use server'

import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import { createSession, getCookieName } from '@/lib/auth'
import { buildLegacyPasswordFields, verifyPasswordRecord } from '@/lib/password'
import type { SessionUser, UserRole, ModuleAccess, DriveAccessLevel } from '@/types'

function normalizeRole(role: unknown): UserRole {
  const value = String(role ?? '').trim().toLowerCase()

  if (value === 'admin') return 'Admin'
  if (value === 'super manager' || value === 'super_manager' || value === 'supermanager') return 'Super Manager'
  if (value === 'manager') return 'Manager'
  if (value === 'supervisor') return 'Supervisor'
  return 'User'
}

type LoginResult =
  | { success: true }
  | { success: false; error: string }

export async function loginAction(
  _prev: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  const username = (formData.get('username') as string | null)?.trim() ?? ''
  const password = (formData.get('password') as string | null) ?? ''

  if (!username || !password) {
    return { success: false, error: 'Username and password are required.' }
  }

  const supabase = createServerClient()
  const { data: users, error } = await supabase
    .from('users')
    .select('username, role, department, email, avatar_data, allowed_accounts, allowed_campaigns, allowed_drive_folders, allowed_looker_reports, module_access, team_members, manager_id, drive_access_level, theme_preference, password, password_hash, password_salt')
    .ilike('username', username)
    .limit(1)

  if (error) {
    console.error('Login DB error:', error)
    return { success: false, error: 'Login failed. Please try again.' }
  }

  if (!users || users.length === 0) {
    return { success: false, error: 'Invalid username or password.' }
  }

  const user = users[0] as Record<string, unknown>
  const passwordCheck = verifyPasswordRecord(password, {
    password: user.password as string | null,
    password_hash: user.password_hash as string | null,
    password_salt: user.password_salt as string | null,
  })

  if (!passwordCheck.valid) {
    return { success: false, error: 'Invalid username or password.' }
  }

  if (passwordCheck.needsUpgrade) {
    supabase
      .from('users')
      .update(buildLegacyPasswordFields(password))
      .eq('username', user.username as string)
      .then(() => {})
  }

  supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('username', user.username as string)
    .then(() => {})

  const parseCSV = (val: string | null) =>
    (val ?? '').split(',').map(s => s.trim()).filter(Boolean)

  const explicitTeamMembers = parseCSV((user.team_members as string | null) ?? null)

  // Also collect users who list this person as their manager_id
  const managedUsername = (user.username as string).toLowerCase()
  const { data: managedUsers } = await supabase
    .from('users')
    .select('username')
    .ilike('manager_id', `%${managedUsername}%`)
  const managedUsernames = ((managedUsers ?? []) as Array<{ username: string }>)
    .map((u) => u.username)
    .filter((u) => u.toLowerCase() !== managedUsername)

  const allTeamMembers = Array.from(new Set([...explicitTeamMembers, ...managedUsernames]))

  const sessionUser: SessionUser = {
    username: user.username as string,
    role: normalizeRole(user.role),
    department: (user.department as string | null) ?? null,
    email: (user.email as string) ?? '',
    avatarData: (user.avatar_data as string | null) ?? null,
    allowedAccounts: parseCSV((user.allowed_accounts as string | null) ?? null),
    allowedCampaigns: parseCSV((user.allowed_campaigns as string | null) ?? null),
    allowedDriveFolders: parseCSV((user.allowed_drive_folders as string | null) ?? null),
    allowedLookerReports: parseCSV((user.allowed_looker_reports as string | null) ?? null),
    moduleAccess: (user.module_access as ModuleAccess) ?? null,
    teamMembers: allTeamMembers,
    managerId: (user.manager_id as string | null) ?? null,
    driveAccessLevel: ((user.drive_access_level as string | null) ?? 'none') as DriveAccessLevel,
    themePreference: ((user.theme_preference as string | null) ?? null) as 'light' | 'dark' | null,
  }

  const token = await createSession(sessionUser)

  const cookieStore = await cookies()
  cookieStore.set(getCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  })

  return { success: true }
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(getCookieName())
}
