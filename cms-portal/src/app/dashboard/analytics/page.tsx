import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getAnalytics } from './actions'
import { AnalyticsPage } from '@/components/analytics/analytics-page'

export default async function Page() {
  const [user, analytics] = await Promise.all([
    getSession(),
    getAnalytics().catch(() => ({
      totalTasks: 0, assignedToMe: 0, completed: 0, inProgress: 0, pending: 0,
      overdue: 0, dueToday: 0, statusBreakdown: {}, priorityBreakdown: {},
      departmentBreakdown: {}, topUsers: [],
    })),
  ])
  if (!user) redirect('/login')
  if (user.role !== 'Admin' && user.role !== 'Super Manager') redirect('/dashboard/tasks')

  return <AnalyticsPage analytics={analytics} user={user} />
}
