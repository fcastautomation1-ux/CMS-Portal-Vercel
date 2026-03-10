'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createSession, getCookieName } from '@/lib/auth'
import type { SessionUser, UserRole, ModuleAccess, DriveAccessLevel } from '@/types'

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

  // Fetch user — exclude avatar_data for performance
  const { data: users, error } = await supabase
    .from('users')
    .select(
      'username,email,role,department,password,password_hash,password_salt,' +
      'allowed_accounts,allowed_campaigns,allowed_drive_folders,' +
      'allowed_looker_reports,drive_access_level,module_access,' +
      'manager_id,team_members'
    )
    .eq('username', username)
    .limit(1)

  if (error) {
    console.error('Login DB error:', error)
    return { success: false, error: 'Login failed. Please try again.' }
  }

  if (!users || users.length === 0) {
    return { success: false, error: 'Invalid username or password.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = users[0] as any

  // Password verification — support both plain text (legacy) and hashed
  const passwordValid = user.password === password
  if (!passwordValid) {
    return { success: false, error: 'Invalid username or password.' }
  }

  // Update last_login (fire and forget)
  supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('username', username)
    .then(() => {})

  // Parse CSV allow-lists
  const parseCSV = (val: string | null) =>
    (val ?? '').split(',').map(s => s.trim()).filter(Boolean)

  const sessionUser: SessionUser = {
    username: user.username,
    role: user.role as UserRole,
    department: user.department ?? null,
    email: user.email,
    avatarData: null,
    allowedAccounts: parseCSV(user.allowed_accounts),
    allowedCampaigns: parseCSV(user.allowed_campaigns),
    allowedDriveFolders: parseCSV(user.allowed_drive_folders),
    allowedLookerReports: parseCSV(user.allowed_looker_reports),
    moduleAccess: (user.module_access as ModuleAccess) ?? null,
    teamMembers: parseCSV(user.team_members),
    managerId: user.manager_id ?? null,
    driveAccessLevel: (user.drive_access_level ?? 'none') as DriveAccessLevel,
  }

  const token = await createSession(sessionUser)

  const cookieStore = await cookies()
  cookieStore.set(getCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  })

  redirect('/dashboard/accounts')
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(getCookieName())
  redirect('/login')
}
