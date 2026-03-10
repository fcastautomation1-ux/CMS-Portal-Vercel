import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getWorkflows } from './actions'
import { WorkflowsPage } from '@/components/workflows/workflows-page'

export default async function Page() {
  const [user, workflows] = await Promise.all([
    getSession(),
    getWorkflows().catch(() => []),
  ])
  if (!user) redirect('/login')
  const canView = user.role === 'Admin' || user.role === 'Super Manager' ||
    (user.role === 'Manager' && user.moduleAccess?.googleAccount?.accessLevel === 'all')
  if (!canView) redirect('/dashboard/tasks')

  return <WorkflowsPage workflows={workflows} user={user} />
}
