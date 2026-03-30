import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getClusterDetails } from './actions'
import { getDepartments } from '@/app/dashboard/departments/actions'
import { ClustersPage } from '@/components/clusters/clusters-page'
import { createServerClient } from '@/lib/supabase/server'
import type { User } from '@/types'

async function getAllUsers(): Promise<User[]> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('username,role,department,email,avatar_data,manager_id,team_members,allowed_accounts,allowed_campaigns,allowed_drive_folders,allowed_looker_reports,drive_access_level,module_access,password_hash,password_salt,password,last_login,email_notifications_enabled,created_at,updated_at')
    .order('username')
  return (data ?? []) as User[]
}

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  if (user.role !== 'Admin' && user.role !== 'Super Manager') redirect('/dashboard/tasks')

  const [clusters, departments, users] = await Promise.all([
    getClusterDetails().catch(() => []),
    getDepartments().catch(() => []),
    getAllUsers().catch(() => []),
  ])

  return <ClustersPage clusters={clusters} departments={departments} users={users} />
}
