import { getHallAssignPageData } from '../../actions'
import { HallAssignPage } from '@/components/tasks/hall-assign-page'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

interface PageProps {
  params: Promise<{ taskId: string }>
}

export default async function HallAssignTaskPage({ params }: PageProps) {
  const { taskId } = await params
  const user = await getSession()
  if (!user) redirect('/login')

  const data = await getHallAssignPageData(taskId)
  if (!data) notFound()

  return <HallAssignPage data={data} />
}
