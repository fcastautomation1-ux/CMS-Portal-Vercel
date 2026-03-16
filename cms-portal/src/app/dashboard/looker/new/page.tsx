import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getLookerAccessUsers } from '../actions'
import { NewLookerReportPage } from '@/components/looker/new-looker-report-page'

export default async function Page() {
  const [user, users] = await Promise.all([
    getSession(),
    getLookerAccessUsers().catch(() => []),
  ])

  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/looker')

  return <NewLookerReportPage users={users} />
}
