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
      {/* Page header */}
      <div className="px-6 py-5 border-b border-slate-100">
        <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {stats.total} total · {stats.completed} done · {stats.overdue > 0 && (
            <span className="text-red-500 font-medium">{stats.overdue} overdue · </span>
          )}
          {stats.dueToday > 0 && (
            <span className="text-amber-600 font-medium">{stats.dueToday} due today</span>
          )}
        </p>
      </div>

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
            initialTasks={tasks}
            initialStats={stats}
          />
        </Suspense>
      </div>
    </div>
  )
}
