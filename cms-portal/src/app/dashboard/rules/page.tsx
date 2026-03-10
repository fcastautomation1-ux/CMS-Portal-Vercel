import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getRules } from './actions'
import { RulesPage } from '@/components/rules/rules-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  // Rules: Admin/SM always; Manager only with all-accounts access
  const canView = user.role === 'Admin' || user.role === 'Super Manager' ||
    (user.role === 'Manager' && user.moduleAccess?.googleAccount?.accessLevel === 'all')
  if (!canView) redirect('/dashboard/tasks')

  const rules = await getRules().catch(() => [])

  return <RulesPage rules={rules} user={user} />
}
