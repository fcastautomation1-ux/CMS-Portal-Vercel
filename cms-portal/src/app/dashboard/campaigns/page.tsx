import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getCampaigns, getAccountsForCampaigns } from './actions'
import { CampaignsPage } from '@/components/campaigns/campaigns-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')

  const [campaigns, accounts] = await Promise.all([
    getCampaigns().catch(() => []),
    getAccountsForCampaigns().catch(() => []),
  ])

  return <CampaignsPage campaigns={campaigns} accounts={accounts} user={user} />
}
