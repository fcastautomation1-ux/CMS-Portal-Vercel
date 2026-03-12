import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { getTodos, getTodoStats } from './actions'
import { TasksBoard } from '@/components/tasks/tasks-board'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tasks | CMS Portal',
}

export default async function TasksPage() {
  const [user, tasks, stats] = await Promise.all([
    getSession(),
    getTodos().catch(() => []),
    getTodoStats().catch(() => ({
      total: 0,
      completed: 0,
      pending: 0,
      overdue: 0,
      highPriority: 0,
      dueToday: 0,
      shared: 0,
    })),
  ])
  if (!user) redirect('/login')

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
            currentUsername={user.username}
            currentUserDept={user.department}
            initialTasks={tasks}
            initialStats={stats}
          />
        </Suspense>
      </div>
    </div>
  )
}
