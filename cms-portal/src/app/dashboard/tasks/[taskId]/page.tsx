import { notFound, redirect } from 'next/navigation'
import { getTodoDetails } from '../actions'
import { getSession } from '@/lib/auth'
import { TaskDetailPage } from '@/components/tasks/task-detail-page'

export const dynamic = 'force-dynamic'

export default async function TaskDetailRoute({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const [{ taskId }, user] = await Promise.all([params, getSession()])

  if (!user) redirect('/login')

  const details = await getTodoDetails(taskId)
  if (!details) notFound()

  return <TaskDetailPage initialDetails={details} currentUsername={user.username} />
}
