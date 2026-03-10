import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getPackages } from './actions'
import { PackagesPage } from '@/components/packages/packages-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  // Packages: Admin, Super Manager, Manager only
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  const packages = await getPackages().catch(() => [])

  return <PackagesPage packages={packages} user={user} />
}
