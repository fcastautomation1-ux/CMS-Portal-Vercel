import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getAppOverviewData } from './actions'
import { AppOverviewPage } from '@/components/app-overview/app-overview-page'

export default async function Page({
  searchParams,
}: {
  searchParams: { year?: string; quarter?: string }
}) {
  const user = await getSession()
  if (!user) redirect('/login')
  if (user.role !== 'Admin' && user.role !== 'Super Manager') redirect('/dashboard')

  const year = searchParams.year ? parseInt(searchParams.year, 10) : undefined
  const quarter = searchParams.quarter ? parseInt(searchParams.quarter, 10) : undefined

  const data = await getAppOverviewData({ year, quarter })

  return <AppOverviewPage data={data} year={year} quarter={quarter} />
}
