import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDepartments } from '@/app/dashboard/departments/actions'
import { ClusterEditPage } from '@/components/clusters/cluster-edit-page'
import { createServerClient } from '@/lib/supabase/server'
import type { User } from '@/types'

async function getAllUsers(): Promise<User[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('username')
  if (error) console.error('getAllUsers error:', error)
  return (data ?? []) as User[]
}

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  if (user.role !== 'Admin' && user.role !== 'Super Manager') redirect('/dashboard/clusters')

  const [departments, users] = await Promise.all([
    getDepartments().catch(() => []),
    getAllUsers().catch(() => []),
  ])

  return (
    <ClusterEditPage
      cluster={null}
      departments={departments}
      users={users}
      settings={null}
    />
  )
}
