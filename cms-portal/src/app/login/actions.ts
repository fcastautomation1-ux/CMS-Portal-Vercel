'use server'

import { cookies } from 'next/headers'
import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { createSession, getCookieName } from '@/lib/auth'
import type { SessionUser, UserRole, ModuleAccess, DriveAccessLevel } from '@/types'

// Mirrors old portal: SHA-256(GASv1_ + salt + password) → hex
function verifyHashedPassword(password: string, storedHash: string, storedSalt: string): boolean {
  try {
    const combined = 'GASv1_' + storedSalt + password
    const hash = createHash('sha256').update(combined, 'utf8').digest('hex')
    return hash === storedHash
  } catch {
    return false
  }
}

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

  // Case-insensitive username lookup (ilike) — handles Admin vs admin etc.
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = users[0] as any

  // Password verification — support SHA-256 hashed (new) and plain text (legacy)
  let passwordValid = false
  if (user.password_salt && user.password_hash) {
    // New format: SHA-256(GASv1_ + salt + password)
    passwordValid = verifyHashedPassword(password, user.password_hash, user.password_salt)
  } else {
    // Legacy plain-text (old portal fallback)
    passwordValid = user.password === password
  }

  if (!passwordValid) {
    return { success: false, error: 'Invalid username or password.' }
  }

  // Update last_login (fire and forget)
  supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('username', user.username)
    .then(() => {})

  // Parse CSV allow-lists
  const parseCSV = (val: string | null) =>
    (val ?? '').split(',').map(s => s.trim()).filter(Boolean)

  const sessionUser: SessionUser = {
    username: user.username,
    role: normalizeRole(user.role),
    department: user.department ?? null,
    email: user.email,
    avatarData: user.avatar_data ?? null,
    allowedAccounts: parseCSV(user.allowed_accounts),
    allowedCampaigns: parseCSV(user.allowed_campaigns),
    allowedDriveFolders: parseCSV(user.allowed_drive_folders),
    allowedLookerReports: parseCSV(user.allowed_looker_reports),
    moduleAccess: (user.module_access as ModuleAccess) ?? null,
    teamMembers: parseCSV(user.team_members),
    managerId: user.manager_id ?? null,
    driveAccessLevel: (user.drive_access_level ?? 'none') as DriveAccessLevel,
    themePreference: (user.theme_preference ?? null) as 'light' | 'dark' | null,
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

  // Return success — client-side useEffect will navigate to /dashboard
  // (more reliable than redirect() inside useFormState across all browsers)
  return { success: true }
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(getCookieName())
}
