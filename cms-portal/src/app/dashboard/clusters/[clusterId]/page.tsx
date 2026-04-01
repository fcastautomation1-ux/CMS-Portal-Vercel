import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { getClusterDetails } from '../actions'
import { getDepartments } from '@/app/dashboard/departments/actions'
import { getClusterSettingsAction } from '@/app/dashboard/tasks/actions'
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

interface Props {
  params: { clusterId: string }
}

export default async function Page({ params }: Props) {
  const user = await getSession()
  if (!user) redirect('/login')
  if (user.role !== 'Admin' && user.role !== 'Super Manager') redirect('/dashboard/clusters')

  const [allClusters, departments, users, settings] = await Promise.all([
    getClusterDetails().catch(() => []),
    getDepartments().catch(() => []),
    getAllUsers().catch(() => []),
    getClusterSettingsAction(params.clusterId).catch(() => null),
  ])

  const cluster = allClusters.find((c) => c.id === params.clusterId)
  if (!cluster) notFound()

  return (
    <ClusterEditPage
      cluster={cluster}
      departments={departments}
      users={users}
      settings={settings}
    />
  )
}
