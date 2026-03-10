import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getRules } from './actions'
import { RulesPage } from '@/components/rules/rules-page'

export default async function Page() {
  const [user, rules] = await Promise.all([
    getSession(),
    getRules().catch(() => []),
  ])
  if (!user) redirect('/login')
  const canView = user.role === 'Admin' || user.role === 'Super Manager' ||
    (user.role === 'Manager' && user.moduleAccess?.googleAccount?.accessLevel === 'all')
  if (!canView) redirect('/dashboard/tasks')

  return <RulesPage rules={rules} user={user} />
}
