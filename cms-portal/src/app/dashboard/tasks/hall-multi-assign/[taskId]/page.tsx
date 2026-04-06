import { getHallAssignPageData } from '../../actions'
import { HallMultiAssignPage } from '@/components/tasks/hall-multi-assign-page'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

interface PageProps {
  params: Promise<{ taskId: string }>
}

export default async function HallMultiAssignTaskPage({ params }: PageProps) {
  const { taskId } = await params
  const user = await getSession()
  if (!user) redirect('/login')

  const data = await getHallAssignPageData(taskId)
  if (!data) notFound()

  return <HallMultiAssignPage data={data} />
}
