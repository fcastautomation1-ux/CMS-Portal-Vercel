import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { getTodos } from './actions'
import { TasksBoard } from '@/components/tasks/tasks-board'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tasks | CMS Portal',
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: { scope?: string }
}) {
  const [user, tasks] = await Promise.all([
    getSession(),
    getTodos().catch(() => []),
  ])
  if (!user) redirect('/login')

  const scope = searchParams?.scope
  const initialScope =
    scope === 'all' ||
    scope === 'my_all' ||
    scope === 'my_pending' ||
    scope === 'assigned_by_me' ||
    scope === 'my_approval' ||
    scope === 'other_approval'
      ? scope
      : 'my_all'

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
            key={initialScope}
            currentUsername={user.username}
            currentUserRole={user.role}
            currentUserDept={user.department}
            currentUserTeamMembers={user.teamMembers}
            initialTasks={tasks}
            initialScope={initialScope}
          />
        </Suspense>
      </div>
    </div>
  )
}
