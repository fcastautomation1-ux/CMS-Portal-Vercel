import { getQueuePriorityAction } from '@/app/dashboard/tasks/actions'
import { QueuePriorityClient } from '@/components/tasks/queue-priority-client'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Task Priority' }

export default async function QueuePriorityPage() {
  const data = await getQueuePriorityAction()
  if (!data) redirect('/dashboard/tasks')

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
          Task Priority
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {data.clusterName} — {data.isManager ? 'Manage team task priorities' : 'Your personal task queue'}
        </p>
      </div>
      <QueuePriorityClient data={data} />
    </div>
  )
}
