import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { getCachedTodos, canUserCreateTasksAction } from './actions'
import { TasksBoard } from '@/components/tasks/tasks-board'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Tasks | CMS Portal',
}

// No searchParams — TasksBoard reads scope/status from useSearchParams() on the
// client, so sidebar filter clicks are instant client-side re-renders with no
// server round-trip, no loading.tsx, and no full component remount.
export default async function TasksPage() {
  const [user, tasks, canAddTask] = await Promise.all([
    getSession(),
    getCachedTodos().catch(() => []),
    canUserCreateTasksAction().catch(() => false),
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
            currentUserRole={user.role}
            currentUserDept={user.department}
            currentUserTeamMembers={user.teamMembers}
            currentUserTeamMemberDeptKeys={user.teamMemberDeptKeys}
            canAddTask={canAddTask}
            initialTasks={tasks}
            initialScope="my_all"
          />
        </Suspense>
      </div>
    </div>
  )
}
