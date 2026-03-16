import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getLookerAccessUsers, getLookerReports } from './actions'
import { LookerPage } from '@/components/looker/looker-page'

export default async function Page() {
  const [user, reports, users] = await Promise.all([
    getSession(),
    getLookerReports().catch(() => []),
    getLookerAccessUsers().catch(() => []),
  ])
  if (!user) redirect('/login')

  return <LookerPage reports={reports} user={user} users={users} />
}
