import { notFound, redirect } from 'next/navigation'
import { getEditAssigneePageData } from '@/app/dashboard/tasks/actions'
import { EditAssigneePage } from '@/components/tasks/edit-assignee-page'

interface Props {
  params: Promise<{ taskId: string }>
}

export default async function EditAssigneeRoute({ params }: Props) {
  const { taskId } = await params
  const data = await getEditAssigneePageData(taskId)
  if (!data) notFound()
  return <EditAssigneePage data={data} />
}
