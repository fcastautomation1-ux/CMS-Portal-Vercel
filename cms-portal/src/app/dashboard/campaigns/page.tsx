import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getCampaigns, getAccountsForCampaigns } from './actions'
import { CampaignsPage } from '@/components/campaigns/campaigns-page'

export default async function Page() {
  const [user, campaigns, accounts] = await Promise.all([
    getSession(),
    getCampaigns().catch(() => []),
    getAccountsForCampaigns().catch(() => []),
  ])
  if (!user) redirect('/login')

  return <CampaignsPage campaigns={campaigns} accounts={accounts} user={user} />
}
