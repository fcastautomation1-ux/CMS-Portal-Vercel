import { getRouteClusterPageData } from '../../actions'
import { RouteClusterPage } from '@/components/tasks/route-cluster-page'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

interface PageProps {
  params: Promise<{ taskId: string }>
}

export default async function RouteClusterTaskPage({ params }: PageProps) {
  const { taskId } = await params
  const user = await getSession()
  if (!user) redirect('/login')

  const data = await getRouteClusterPageData(taskId)
  if (!data) notFound()

  return <RouteClusterPage data={data} />
}
