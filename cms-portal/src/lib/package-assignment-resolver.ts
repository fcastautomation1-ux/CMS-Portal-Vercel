/**
 * Package-based automatic department task assignment resolver.
 *
 * Given a comma-separated list of package names stored on a task and a target
 * department, this module inspects the user_packages table and returns one of:
 *   - { type: 'single',  username }   — all packages map to exactly one user in target dept
 *   - { type: 'multi',   usernames }  — packages map to 2+ distinct users (all unambiguous)
 *   - { type: 'queue' }               — any package is unresolved / ambiguous → queue fallback
 *
 * Business rules applied here:
 *  Rule 5a  All packages → same single user          → single
 *  Rule 5b  All packages → different single users    → multi
 *  Rule  6  Any package  → 0 users in target dept    → queue
 *  Rule  7  Any package  → >1 users in target dept   → queue
 *  Rule  8  Partial resolution (some unresolved)     → queue (no partial auto-assign)
 *  Rule  9  Deduplication of multi users             → handled via Set
 */

import { createServerClient } from '@/lib/supabase/server'
import { splitTaskMeta } from '@/lib/task-metadata'
import { canonicalDepartmentKey } from '@/lib/department-name'
import type { MultiAssignment, MultiAssignmentEntry } from '@/types'

// ─── Public types ─────────────────────────────────────────────────────────────

export type AutoAssignResult =
  | { type: 'single'; username: string }
  | { type: 'multi'; usernames: string[] }
  | { type: 'queue' }

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolves which user(s) in the target department own ALL selected packages.
 *
 * @param supabase     Server-side Supabase client (service role)
 * @param packageNamesCsv  Comma-separated package names from the task (e.g. "App A, App B")
 * @param targetDepartment  The department the task is being routed to
 * @returns AutoAssignResult — single / multi / queue
 */
export async function resolvePackageAutoAssignment(
  supabase: ReturnType<typeof createServerClient>,
  packageNamesCsv: string | null | undefined,
  targetDepartment: string | null | undefined,
): Promise<AutoAssignResult> {
  // ── Guard: no packages or no department → queue ───────────────────────────
  const packageNames = splitTaskMeta(packageNamesCsv)
  if (packageNames.length === 0) return { type: 'queue' }
  if (!targetDepartment?.trim()) return { type: 'queue' }

  const targetKey = canonicalDepartmentKey(targetDepartment)
  const uniqueNames = Array.from(new Set(packageNames.map((n) => n.trim()).filter(Boolean)))
  if (uniqueNames.length === 0) return { type: 'queue' }

  // ── Step 1: fetch package records by name ─────────────────────────────────
  const { data: pkgData, error: pkgError } = await supabase
    .from('packages')
    .select('id,name')
    .in('name', uniqueNames)

  if (pkgError || !Array.isArray(pkgData) || pkgData.length === 0) return { type: 'queue' }

  const packageRows = pkgData as Array<{ id: string; name: string }>

  // All selected names must exist in DB (Rule 8 — partial package not found → queue)
  const foundNames = new Set(packageRows.map((p) => p.name.trim()))
  for (const name of uniqueNames) {
    if (!foundNames.has(name)) return { type: 'queue' }
  }

  const packageIds = packageRows.map((p) => p.id)

  // ── Step 2: fetch user_packages for these package IDs ─────────────────────
  // Dual-key schema: some installs use 'user_id', newer ones use 'username'.
  // Mirror the same dual-key fallback used in packages/actions.ts.
  let upRows: Array<{ package_id: string; username: string }> = []

  const byUserId = await supabase
    .from('user_packages')
    .select('package_id,user_id')
    .in('package_id', packageIds)

  if (!byUserId.error && Array.isArray(byUserId.data)) {
    upRows = (byUserId.data as Array<{ package_id: string; user_id: string }>).map((r) => ({
      package_id: r.package_id,
      username: r.user_id,
    }))
  } else {
    const byUsername = await supabase
      .from('user_packages')
      .select('package_id,username')
      .in('package_id', packageIds)
    if (byUsername.error || !Array.isArray(byUsername.data)) return { type: 'queue' }
    upRows = byUsername.data as Array<{ package_id: string; username: string }>
  }

  if (upRows.length === 0) return { type: 'queue' }

  // ── Step 3: collect distinct usernames to look up their departments ────────
  const allUsernames = Array.from(new Set(upRows.map((r) => r.username).filter(Boolean)))
  if (allUsernames.length === 0) return { type: 'queue' }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('username,department')
    .in('username', allUsernames)

  if (userError || !Array.isArray(userData)) return { type: 'queue' }

  // username → department value (may be comma-separated for multi-dept users)
  const userDeptMap = new Map<string, string | null>(
    (userData as Array<{ username: string; department: string | null }>).map((u) => [
      u.username,
      u.department,
    ]),
  )

  // ── Step 4: group user_packages rows by package_id ────────────────────────
  const usersByPkgId = new Map<string, Set<string>>()
  for (const row of upRows) {
    if (!row.package_id || !row.username) continue
    const existing = usersByPkgId.get(row.package_id) ?? new Set<string>()
    existing.add(row.username)
    usersByPkgId.set(row.package_id, existing)
  }

  // ── Step 5: for each package find users whose dept matches target dept ─────
  const resolvedUsersPerPkg = new Map<string, string[]>()

  for (const pkg of packageRows) {
    const pkgName = pkg.name.trim()
    const usernamesForPkg = usersByPkgId.get(pkg.id) ?? new Set<string>()

    const inTargetDept = Array.from(usernamesForPkg).filter((uname) => {
      const deptValue = userDeptMap.get(uname)
      if (!deptValue) return false
      // Support comma-separated departments (multi-dept users — Rule 9 in requirements)
      return deptValue
        .split(',')
        .map((d) => d.trim())
        .some((d) => canonicalDepartmentKey(d) === targetKey)
    })

    resolvedUsersPerPkg.set(pkgName, inTargetDept)
  }

  // ── Step 6: apply business rules ──────────────────────────────────────────
  for (const [, users] of resolvedUsersPerPkg) {
    if (users.length === 0) return { type: 'queue' } // Rule 6: no user for this package
    if (users.length > 1) return { type: 'queue' }   // Rule 7: ambiguous — multiple owners
  }

  // Every package has exactly one user in the target department.
  // Collect the unique set of those users (Rule 9 — deduplicate).
  const uniqueUsers = Array.from(
    new Set(Array.from(resolvedUsersPerPkg.values()).map((users) => users[0])),
  )

  if (uniqueUsers.length === 1) {
    return { type: 'single', username: uniqueUsers[0] } // Rule 5a
  }

  return { type: 'multi', usernames: uniqueUsers } // Rule 5b
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Constructs a MultiAssignment payload for auto-resolved multi-user assignment.
 * All assignees receive the same due date (the task-level due date).
 */
export function buildAutoMultiAssignment(
  usernames: string[],
  dueDate: string | null | undefined,
  createdBy: string,
): MultiAssignment {
  const now = new Date().toISOString()
  const assignees: MultiAssignmentEntry[] = usernames.map((username) => ({
    username,
    status: 'pending',
    assigned_at: now,
    actual_due_date: dueDate ?? undefined,
  }))
  return {
    enabled: true,
    assignees,
    created_by: createdBy,
    completion_percentage: 0,
    all_completed: false,
  }
}
