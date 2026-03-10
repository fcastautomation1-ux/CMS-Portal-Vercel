import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getLookerReports } from './actions'
import { LookerPage } from '@/components/looker/looker-page'

export default async function Page() {
  const [user, reports] = await Promise.all([
    getSession(),
    getLookerReports().catch(() => []),
  ])
  if (!user) redirect('/login')

  return <LookerPage reports={reports} user={user} />
}
