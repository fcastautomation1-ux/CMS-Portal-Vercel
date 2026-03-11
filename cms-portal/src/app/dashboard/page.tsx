import { getSession } from '@/lib/auth'
import { OverviewPage } from '@/components/dashboard/overview-page'
import { getOverviewStats, getManagerOverview } from './overview/actions'

export default async function DashboardPage() {
  const user = await getSession()
  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }

  const [adminStats, managerStats] = await Promise.all([
    getOverviewStats(),
    getManagerOverview(),
  ])

  return <OverviewPage user={user!} adminStats={adminStats} managerStats={managerStats} />
}

