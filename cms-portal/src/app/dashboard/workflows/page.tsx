import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getWorkflows } from './actions'
import { WorkflowsPage } from '@/components/workflows/workflows-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  // Workflows: Admin/SM always; Manager only with all-accounts access
  const canView = user.role === 'Admin' || user.role === 'Super Manager' ||
    (user.role === 'Manager' && user.moduleAccess?.googleAccount?.accessLevel === 'all')
  if (!canView) redirect('/dashboard/tasks')

  const workflows = await getWorkflows().catch(() => [])

  return <WorkflowsPage workflows={workflows} user={user} />
}
