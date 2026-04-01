import { cache } from 'react'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { canonicalDepartmentKey, splitDepartmentsCsv } from '@/lib/department-name'
import type { SessionUser, UserRole, ModuleAccess, DriveAccessLevel } from '@/types'

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? 'fallback-dev-secret-please-set-auth-secret'
)
const COOKIE_NAME = 'cms_session'
const EXPIRY = '24h'

type SessionPayload = {
  username: string
}

function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function normalizeRole(role: unknown): UserRole {
  const value = String(role ?? '').trim().toLowerCase()

  if (value === 'admin') return 'Admin'
  if (value === 'super manager' || value === 'super_manager' || value === 'supermanager') return 'Super Manager'
  if (value === 'manager') return 'Manager'
  if (value === 'supervisor') return 'Supervisor'
  return 'User'
}

function parseCSV(val: string | null) {
  return (val ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

const hydrateSessionUser = cache(async (username: string): Promise<SessionUser | null> => {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('username, role, department, email, avatar_data, allowed_accounts, allowed_campaigns, allowed_drive_folders, allowed_looker_reports, module_access, team_members, manager_id, drive_access_level, theme_preference')
    .eq('username', username)
    .single()

  if (error || !data) return null

  const row = data as Record<string, unknown>
  const explicitTeamMembers = parseCSV((row.team_members as string | null) ?? null)

  // Also collect users who list this person as their manager_id
  const managedUsername = (row.username as string).toLowerCase()
  const { data: managedUsers } = await supabase
    .from('users')
    .select('username, department')
    .ilike('manager_id', `%${managedUsername}%`)
  const managedUsersTyped = ((managedUsers ?? []) as Array<{ username: string; department: string | null }>)
    .filter((u) => u.username.toLowerCase() !== managedUsername)
  const managedUsernames = managedUsersTyped.map((u) => u.username)

  const allTeamMembers = Array.from(new Set([...explicitTeamMembers, ...managedUsernames]))
  const teamMemberDeptKeys = Array.from(new Set(
    managedUsersTyped.flatMap((u) =>
      splitDepartmentsCsv(u.department).map((d) => canonicalDepartmentKey(d)).filter(Boolean)
    )
  ))

  // Fetch which clusters this user belongs to
  const { data: clusterMemberships } = await supabase
    .from('cluster_members')
    .select('cluster_id')
    .eq('username', row.username as string)
  const clusterIds = ((clusterMemberships ?? []) as Array<{ cluster_id: string }>).map((m) => m.cluster_id).filter(Boolean)

  return {
    username: row.username as string,
    role: normalizeRole(row.role),
    department: (row.department as string | null) ?? null,
    email: (row.email as string) ?? '',
    avatarData: (row.avatar_data as string | null) ?? null,
    allowedAccounts: parseCSV((row.allowed_accounts as string | null) ?? null),
    allowedCampaigns: parseCSV((row.allowed_campaigns as string | null) ?? null),
    allowedDriveFolders: parseCSV((row.allowed_drive_folders as string | null) ?? null),
    allowedLookerReports: parseCSV((row.allowed_looker_reports as string | null) ?? null),
    moduleAccess: (row.module_access as ModuleAccess) ?? null,
    teamMembers: allTeamMembers,
    teamMemberDeptKeys,
    managerId: (row.manager_id as string | null) ?? null,
    driveAccessLevel: ((row.drive_access_level as string | null) ?? 'none') as DriveAccessLevel,
    themePreference: ((row.theme_preference as string | null) ?? null) as 'light' | 'dark' | null,
    clusterIds,
  }
})

export async function createSession(user: Pick<SessionUser, 'username'>): Promise<string> {
  return await new SignJWT({ username: user.username } satisfies SessionPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(SECRET)
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    const username = (payload as { username?: string; user?: { username?: string } }).username
      ?? (payload as { user?: { username?: string } }).user?.username

    if (!username) return null
    return { username }
  } catch {
    return null
  }
}

export const getSession = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  const payload = await verifySession(token)
  if (!payload?.username) return null

  return hydrateSessionUser(payload.username)
})

export function getCookieName() {
  return COOKIE_NAME
}
