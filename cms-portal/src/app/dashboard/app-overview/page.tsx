import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getAppOverviewData } from './actions'
import { AppOverviewPage } from '@/components/app-overview/app-overview-page'

export default async function Page({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const user = await getSession()
  if (!user) redirect('/login')
  if (user.role !== 'Admin' && user.role !== 'Super Manager') redirect('/dashboard')

  const from = searchParams.from
  const to = searchParams.to

  const data = await getAppOverviewData({ from, to })

  return <AppOverviewPage data={data} from={from} to={to} />
}
