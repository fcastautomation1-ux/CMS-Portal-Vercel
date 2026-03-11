import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getCampaigns, getAccountsForCampaigns, getConditionDefinitions } from './actions'
import { CampaignsPage } from '@/components/campaigns/campaigns-page'

export default async function Page({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const params = await searchParams
  const [user, campaigns, accounts, conditions] = await Promise.all([
    getSession(),
    getCampaigns().catch(() => []),
    getAccountsForCampaigns().catch(() => []),
    getConditionDefinitions().catch(() => []),
  ])
  if (!user) redirect('/login')

  return <CampaignsPage campaigns={campaigns} accounts={accounts} user={user} conditions={conditions} initialAccountFilter={params.account || ''} />
}
