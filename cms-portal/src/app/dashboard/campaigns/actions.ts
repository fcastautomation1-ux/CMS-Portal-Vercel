'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Campaign, Account, SessionUser } from '@/types'

const CAMPAIGN_TABLES = ['campaign_conditions', 'workflow_1', 'workflow_2', 'workflow_3'] as const
const CAMPAIGNS_CACHE_TAG = 'campaigns-data'

/** Returns true if the user has full access to all accounts/campaigns */
function hasFullAccess(user: SessionUser): boolean {
  const { role, allowedAccounts } = user
  if (role === 'Admin' || role === 'Super Manager') return true
  return allowedAccounts.includes('All') || allowedAccounts.includes('*') || allowedAccounts.includes('all')
}

/** Returns the list of allowed customer_ids, or null for full access, or [] for no access */
function getAllowedAccountIds(user: SessionUser): string[] | null {
  if (hasFullAccess(user)) return null
  return user.allowedAccounts
}

export async function getCampaigns(): Promise<Campaign[]> {
  const user = await getSession()
  if (!user) return []

  const allowedIds = getAllowedAccountIds(user)
  // User has no account access at all
  if (allowedIds !== null && allowedIds.length === 0) return []
  const scopeKey = allowedIds === null ? 'all' : [...allowedIds].sort().join(',')

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const all: Campaign[] = []

      for (const table of CAMPAIGN_TABLES) {
        let query = supabase.from(table).select('*')
        if (allowedIds !== null) {
          query = query.in('customer_id', allowedIds)
        }
        const { data } = await query
        if (data) all.push(...(data as unknown as Campaign[]))
      }

      return all
    },
    ['campaigns-page', user.username, scopeKey],
    { revalidate: 60, tags: [CAMPAIGNS_CACHE_TAG] }
  )()
}

export async function getCampaignsForAccount(customerId: string): Promise<Campaign[]> {
  const user = await getSession()
  if (!user) return []

  // Check if user can access this account
  const allowedIds = getAllowedAccountIds(user)
  if (allowedIds !== null && !allowedIds.includes(customerId)) return []

  const supabase = createServerClient()
  const all: Campaign[] = []

  for (const table of CAMPAIGN_TABLES) {
    const { data } = await supabase.from(table).select('*').eq('customer_id', customerId)
    if (data) all.push(...(data as unknown as Campaign[]))
  }

  return all
}

export async function getAccountsForCampaigns(): Promise<Account[]> {
  const user = await getSession()
  if (!user) return []

  const allowedIds = getAllowedAccountIds(user)
  if (allowedIds !== null && allowedIds.length === 0) return []
  const scopeKey = allowedIds === null ? 'all' : [...allowedIds].sort().join(',')

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      let query = supabase.from('accounts').select('customer_id, workflow, account_name, drive_code_comments').order('customer_id')
      if (allowedIds !== null) {
        query = query.in('customer_id', allowedIds)
      }
      const { data } = await query
      return (data as unknown as Account[]) ?? []
    },
    ['campaign-accounts', user.username, scopeKey],
    { revalidate: 60, tags: [CAMPAIGNS_CACHE_TAG] }
  )()
}

export async function getConditionDefinitions(): Promise<Array<{ id: string; name: string; description: string | null }>> {
  const user = await getSession()
  if (!user) return []

  const allowedIds = getAllowedAccountIds(user)
  if (allowedIds !== null && allowedIds.length === 0) return []

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      const { data, error } = await supabase
        .from('removal_condition_definitions')
        .select('id,name,description')
        .order('name')

      if (error) {
        console.error('getConditionDefinitions error:', error)
        return []
      }
      return (data as Array<{ id: string; name: string; description: string | null }>) ?? []
    },
    ['campaign-condition-definitions'],
    { revalidate: 300, tags: [CAMPAIGNS_CACHE_TAG] }
  )()
}

export async function saveCampaign(
  campaign: { customer_id: string; campaign_name: string; removal_conditions: string; workflow: string; enabled: boolean }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  // Must have access to the account being modified
  const allowedIds = getAllowedAccountIds(user)
  if (allowedIds !== null && !allowedIds.includes(campaign.customer_id)) {
    return { success: false, error: 'Permission denied: no access to this account.' }
  }

  const tableMap: Record<string, string> = {
    'workflow-0': 'campaign_conditions',
    'workflow-1': 'workflow_1',
    'workflow-2': 'workflow_2',
    'workflow-3': 'workflow_3',
  }
  const table = tableMap[campaign.workflow] || 'campaign_conditions'

  const supabase = createServerClient()
  const { error } = await supabase.from(table).upsert(
    {
      customer_id: campaign.customer_id,
      campaign_name: campaign.campaign_name,
      removal_conditions: campaign.removal_conditions,
      workflow: campaign.workflow,
      enabled: campaign.enabled,
    },
    { onConflict: 'customer_id,campaign_name' }
  )

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/campaigns')
  revalidateTag(CAMPAIGNS_CACHE_TAG)
  return { success: true }
}

export async function saveCampaignBatch(
  items: Array<{ customer_id: string; campaign_name: string; removal_conditions: string; workflow: string; enabled: boolean }>
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const allowedIds = getAllowedAccountIds(user)
  if (allowedIds !== null) {
    const denied = items.find(i => !allowedIds.includes(i.customer_id))
    if (denied) return { success: false, error: 'Permission denied: no access to one or more accounts.' }
  }

  for (const item of items) {
    const res = await saveCampaign(item)
    if (!res.success) return res
  }

  revalidatePath('/dashboard/campaigns')
  revalidateTag(CAMPAIGNS_CACHE_TAG)
  return { success: true }
}

export async function deleteCampaign(
  customerId: string,
  campaignName: string,
  workflow: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const tableMap: Record<string, string> = {
    'workflow-0': 'campaign_conditions',
    'workflow-1': 'workflow_1',
    'workflow-2': 'workflow_2',
    'workflow-3': 'workflow_3',
  }
  const table = tableMap[workflow] || 'campaign_conditions'

  const supabase = createServerClient()
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('customer_id', customerId)
    .eq('campaign_name', campaignName)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/campaigns')
  revalidateTag(CAMPAIGNS_CACHE_TAG)
  return { success: true }
}
