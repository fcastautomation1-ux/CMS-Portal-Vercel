'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Cluster, ClusterDetail, ClusterMember, ClusterRole, Department } from '@/types'

const CLUSTERS_CACHE_TAG = 'clusters-data'

// ─── Helper: minimum-leader guard ─────────────────────────────────────────────

/**
 * Returns true if removing/downgrading `username` in `clusterId` would leave
 * the cluster without any owner or manager.
 * Used to prevent orphaned halls.
 */
async function wouldLeaveClusterWithoutLeader(
  supabase: ReturnType<typeof createServerClient>,
  clusterId: string,
  affectedUsername: string,
  newRole?: ClusterRole   // pass undefined when removing
): Promise<boolean> {
  const { data } = await supabase
    .from('cluster_members')
    .select('username, cluster_role')
    .eq('cluster_id', clusterId)
    .in('cluster_role', ['owner', 'manager'])

  const leaders = (data ?? []) as Array<{ username: string; cluster_role: ClusterRole }>

  // If new role is still a leader role, no problem
  if (newRole === 'owner' || newRole === 'manager') return false

  // Count remaining leaders excluding the affected user
  const remainingLeaders = leaders.filter((l) => l.username !== affectedUsername)
  return remainingLeaders.length === 0
}

// ─── READ ─────────────────────────────────────────────────────────────────────

export async function getClusters(): Promise<Cluster[]> {
  const user = await getSession()
  if (!user) return []
  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const { data, error } = await supabase
        .from('clusters')
        .select('*')
        .order('name')
      if (error) { console.error('getClusters error:', error); return [] }
      return (data ?? []) as Cluster[]
    },
    ['clusters-list'],
    { revalidate: 60, tags: [CLUSTERS_CACHE_TAG] }
  )()
}

export async function getClusterDetails(): Promise<ClusterDetail[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()

  const [
    { data: clusters, error: clustersErr },
    { data: clusterDepts },
    { data: clusterMembers },
    { data: departments },
    { data: users },
  ] = await Promise.all([
    supabase.from('clusters').select('*').order('name'),
    supabase.from('cluster_departments').select('cluster_id, department_id'),
    supabase.from('cluster_members').select('*'),
    supabase.from('departments').select('id, name'),
    supabase.from('users').select('username, role, avatar_data'),
  ])

  if (clustersErr || !clusters) return []

  const deptMap: Record<string, string> = {}
  ;(departments ?? []).forEach((d: Record<string, string>) => { deptMap[d.id] = d.name })

  const userMap: Record<string, { role: string; avatar_data: string | null }> = {}
  ;(users ?? []).forEach((u: Record<string, unknown>) => {
    userMap[String(u.username)] = { role: String(u.role ?? ''), avatar_data: u.avatar_data ? String(u.avatar_data) : null }
  })

  return (clusters as Cluster[]).map((cluster) => {
    const depts = (clusterDepts ?? []).filter(
      (cd: Record<string, string>) => cd.cluster_id === cluster.id
    ).map((cd: Record<string, string>) => ({ id: cd.department_id, name: deptMap[cd.department_id] ?? '' }))

    const members = (clusterMembers ?? []).filter(
      (cm: Record<string, unknown>) => String(cm.cluster_id) === cluster.id
    ).map((cm: Record<string, unknown>) => {
      const u = userMap[String(cm.username)] ?? { role: '', avatar_data: null }
      return {
        id: String(cm.id),
        cluster_id: String(cm.cluster_id),
        username: String(cm.username),
        cluster_role: cm.cluster_role as ClusterRole,
        scoped_departments: (cm.scoped_departments as string[] | null) ?? null,
        created_at: String(cm.created_at),
        updated_at: String(cm.updated_at),
        role: u.role,
        avatar_data: u.avatar_data,
      }
    })

    return { ...cluster, departments: depts, members }
  })
}

/** Return the cluster(s) a user belongs to (with their cluster_role) */
export async function getUserClusters(username: string): Promise<Array<Cluster & { cluster_role: ClusterRole; scoped_departments: string[] | null }>> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('cluster_members')
    .select('cluster_id, cluster_role, scoped_departments, clusters(*)')
    .eq('username', username)
  if (error || !data) return []
  return data.map((row: Record<string, unknown>) => {
    const c = row.clusters as Cluster
    return {
      ...c,
      cluster_role: row.cluster_role as ClusterRole,
      scoped_departments: (row.scoped_departments as string[] | null) ?? null,
    }
  })
}

// ─── WRITE ────────────────────────────────────────────────────────────────────

export async function saveClusterAction(formData: {
  id?: string
  name: string
  description?: string
  color?: string
  office_start?: string
  office_end?: string
  break_start?: string
  break_end?: string
  friday_break_start?: string
  friday_break_end?: string
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { success: false, error: 'Unauthorized' }
  }

  const supabase = createServerClient()
  const now = new Date().toISOString()

  const officeFields = {
    office_start:       formData.office_start       ?? '09:00',
    office_end:         formData.office_end         ?? '18:00',
    break_start:        formData.break_start        ?? '13:00',
    break_end:          formData.break_end          ?? '14:00',
    friday_break_start: formData.friday_break_start ?? '12:30',
    friday_break_end:   formData.friday_break_end   ?? '14:30',
  }

  if (formData.id) {
    const { error } = await supabase
      .from('clusters')
      .update({
        name: formData.name.trim(),
        description: formData.description?.trim() || null,
        color: formData.color || '#2B7FFF',
        updated_at: now,
        ...officeFields,
      })
      .eq('id', formData.id)
    if (error) return { success: false, error: error.message }
    revalidateTag(CLUSTERS_CACHE_TAG)
    revalidatePath('/dashboard/clusters')
    return { success: true, id: formData.id }
  }

  const { data, error } = await supabase
    .from('clusters')
    .insert({
      name: formData.name.trim(),
      description: formData.description?.trim() || null,
      color: formData.color || '#2B7FFF',
      created_by: user.username,
      ...officeFields,
    })
    .select('id')
    .single()
  if (error) return { success: false, error: error.message }
  revalidateTag(CLUSTERS_CACHE_TAG)
  revalidatePath('/dashboard/clusters')
  return { success: true, id: (data as { id: string }).id }
}

export async function deleteClusterAction(clusterId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { success: false, error: 'Unauthorized' }
  }
  const supabase = createServerClient()
  const { error } = await supabase.from('clusters').delete().eq('id', clusterId)
  if (error) return { success: false, error: error.message }
  revalidateTag(CLUSTERS_CACHE_TAG)
  revalidatePath('/dashboard/clusters')
  return { success: true }
}

/** Replace all departments for a cluster */
export async function setClusterDepartmentsAction(
  clusterId: string,
  departmentIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { success: false, error: 'Unauthorized' }
  }
  const supabase = createServerClient()
  // Delete existing
  await supabase.from('cluster_departments').delete().eq('cluster_id', clusterId)
  // Insert new
  if (departmentIds.length > 0) {
    const rows = departmentIds.map((deptId) => ({ cluster_id: clusterId, department_id: deptId }))
    const { error } = await supabase.from('cluster_departments').insert(rows)
    if (error) return { success: false, error: error.message }
  }
  revalidateTag(CLUSTERS_CACHE_TAG)
  revalidatePath('/dashboard/clusters')
  return { success: true }
}

/** Replace all members for a cluster */
export async function setClusterMembersAction(
  clusterId: string,
  members: Array<{ username: string; cluster_role: ClusterRole; scoped_departments: string[] | null }>
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { success: false, error: 'Unauthorized' }
  }
  const supabase = createServerClient()
  const now = new Date().toISOString()

  // Delete existing
  await supabase.from('cluster_members').delete().eq('cluster_id', clusterId)

  if (members.length > 0) {
    const rows = members.map((m) => ({
      cluster_id: clusterId,
      username: m.username,
      cluster_role: m.cluster_role,
      scoped_departments: m.scoped_departments ?? null,
      created_at: now,
      updated_at: now,
    }))
    const { error } = await supabase.from('cluster_members').insert(rows)
    if (error) return { success: false, error: error.message }
  }

  revalidateTag(CLUSTERS_CACHE_TAG)
  revalidatePath('/dashboard/clusters')
  return { success: true }
}

/** Upsert a single cluster member (used when editing one member's role/scope) */
export async function upsertClusterMemberAction(
  clusterId: string,
  member: { username: string; cluster_role: ClusterRole; scoped_departments: string[] | null }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { success: false, error: 'Unauthorized' }
  }
  const supabase = createServerClient()

  // Check minimum-leader constraint when downgrading an existing leader
  const wouldOrphan = await wouldLeaveClusterWithoutLeader(supabase, clusterId, member.username, member.cluster_role)
  if (wouldOrphan) {
    return { success: false, error: 'A hall must have at least one owner or manager. Assign another leader first.' }
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('cluster_members')
    .upsert({
      cluster_id: clusterId,
      username: member.username,
      cluster_role: member.cluster_role,
      scoped_departments: member.scoped_departments ?? null,
      updated_at: now,
    }, { onConflict: 'cluster_id,username' })
  if (error) return { success: false, error: error.message }
  revalidateTag(CLUSTERS_CACHE_TAG)
  revalidatePath('/dashboard/clusters')
  return { success: true }
}

export async function removeClusterMemberAction(
  clusterId: string,
  username: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user || (user.role !== 'Admin' && user.role !== 'Super Manager')) {
    return { success: false, error: 'Unauthorized' }
  }
  const supabase = createServerClient()

  // Check minimum-leader constraint (undefined = removing entirely)
  const wouldOrphan = await wouldLeaveClusterWithoutLeader(supabase, clusterId, username, undefined)
  if (wouldOrphan) {
    return { success: false, error: 'A hall must have at least one owner or manager. Assign another leader before removing this one.' }
  }

  const { error } = await supabase
    .from('cluster_members')
    .delete()
    .eq('cluster_id', clusterId)
    .eq('username', username)
  if (error) return { success: false, error: error.message }
  revalidateTag(CLUSTERS_CACHE_TAG)
  revalidatePath('/dashboard/clusters')
  return { success: true }
}

/** Get all departments not assigned to any cluster (for the "available" pool) */
export async function getUnclusteredDepartments(): Promise<Department[]> {
  const supabase = createServerClient()
  const [{ data: allDepts }, { data: assigned }] = await Promise.all([
    supabase.from('departments').select('*').order('name'),
    supabase.from('cluster_departments').select('department_id'),
  ])
  const assignedIds = new Set((assigned ?? []).map((r: Record<string, string>) => r.department_id))
  return ((allDepts ?? []) as Department[]).filter((d) => !assignedIds.has(d.id))
}
