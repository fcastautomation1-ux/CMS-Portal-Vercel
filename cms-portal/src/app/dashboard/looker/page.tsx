import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getLookerReports } from './actions'
import { LookerPage } from '@/components/looker/looker-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')

  const reports = await getLookerReports().catch(() => [])

  return <LookerPage reports={reports} user={user} />
}
