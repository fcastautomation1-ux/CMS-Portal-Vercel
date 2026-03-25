import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { getTodos } from './actions'
import { TasksBoard } from '@/components/tasks/tasks-board'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Tasks | CMS Portal',
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: { scope?: string; status?: string }
}) {
  const [user, tasks] = await Promise.all([
    getSession(),
    getTodos().catch(() => []),
  ])
  if (!user) redirect('/login')

  const scope = searchParams?.scope
  const status = searchParams?.status
  const initialScope =
    scope === 'my_all' ||
    scope === 'created_by_me' ||
    scope === 'assigned_to_me' ||
    scope === 'my_pending' ||
    scope === 'assigned_by_me' ||
    scope === 'my_approval' ||
    scope === 'other_approval'
      ? scope
      : 'my_all'
  const initialStatus =
    status === 'all' ||
    status === 'pending' ||
    status === 'completed' ||
    status === 'overdue'
      ? status
      : 'all'

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <Loader2 size={24} className="animate-spin text-blue-400" />
            </div>
          }
        >
          <TasksBoard
            key={`${initialScope}:${initialStatus}`}
            currentUsername={user.username}
            currentUserRole={user.role}
            currentUserDept={user.department}
            currentUserTeamMembers={user.teamMembers}
            initialTasks={tasks}
            initialScope={initialScope}
            initialStatus={initialStatus}
          />
        </Suspense>
      </div>
    </div>
  )
}
