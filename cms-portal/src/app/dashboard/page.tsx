import { getSession } from '@/lib/auth'
import { OverviewPage } from '@/components/dashboard/overview-page'
import { getOverviewStats, getManagerOverview, getUserPersonalStats } from './overview/actions'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getSession()
  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }

  const isAdminOrSM = user!.role === 'Admin' || user!.role === 'Super Manager'
  const isManagerOrSupervisor = user!.role === 'Manager' || user!.role === 'Supervisor'

  const [adminStats, managerStats, personalStats] = await Promise.all([
    isAdminOrSM ? getOverviewStats() : Promise.resolve(null),
    isManagerOrSupervisor ? getManagerOverview() : Promise.resolve(null),
    (!isAdminOrSM) ? getUserPersonalStats() : Promise.resolve(null),
  ])

  return (
    <OverviewPage
      user={user!}
      adminStats={adminStats!}
      managerStats={managerStats!}
      personalStats={personalStats!}
    />
  )
}

