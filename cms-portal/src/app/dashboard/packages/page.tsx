import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPackages } from './actions'
import { PackagesPage } from '@/components/packages/packages-page'

export default async function Page() {
  const [user, packages] = await Promise.all([
    getSession(),
    getPackages().catch(() => []),
  ])
  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  return <PackagesPage packages={packages} user={user} />
}
