'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Account, AccountFormData, SessionUser } from '@/types'

// ─── Role-based account filtering ────────────────────────────────
function buildAccountFilter(user: SessionUser) {
  const { role, moduleAccess, allowedAccounts } = user

  if (role === 'Admin' || role === 'Super Manager') return null // all

  if (role === 'Manager' || role === 'Supervisor') {
    const ma = moduleAccess?.googleAccount
    if (!ma || !ma.enabled) return 'NO_ACCESS'
    if (ma.accessLevel === 'specific') return ma.accounts ?? []
    return null // all
  }

  // User role
  if (allowedAccounts.includes('All') || allowedAccounts.includes('*')) return null
  return allowedAccounts
}

export async function getAccounts(): Promise<Account[]> {
  const user = await getSession()
  if (!user) return []

  const filter = buildAccountFilter(user)
  if (filter === 'NO_ACCESS') return []

  const supabase = createServerClient()
  let query = supabase
    .from('accounts')
    .select('*')
    .order('created_date', { ascending: false })

  if (Array.isArray(filter) && filter.length > 0) {
    query = query.in('customer_id', filter)
  }

  const { data, error } = await query
  if (error) { console.error('getAccounts error:', error); return [] }
  return (data as Account[]) ?? []
}

// ─── Create account ────────────────────────────────────────────
export async function createAccount(
  formData: AccountFormData
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('accounts').insert({
    customer_id: formData.customer_id.trim(),
    google_sheet_link: formData.google_sheet_link || null,
    drive_code_comments: formData.drive_code_comments || null,
    workflow: formData.workflow || 'workflow-0',
    enabled: formData.enabled,
    status: 'Pending',
  })

  if (error) {
    if (error.code === '23505') return { success: false, error: 'Customer ID already exists.' }
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/accounts')
  return { success: true }
}

// ─── Update account ────────────────────────────────────────────
export async function updateAccount(
  customerId: string,
  formData: Omit<AccountFormData, 'customer_id'>
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('accounts')
    .update({
      google_sheet_link: formData.google_sheet_link || null,
      drive_code_comments: formData.drive_code_comments || null,
      workflow: formData.workflow,
      enabled: formData.enabled,
    })
    .eq('customer_id', customerId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/accounts')
  return { success: true }
}

// ─── Delete account ────────────────────────────────────────────
export async function deleteAccount(
  customerId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('customer_id', customerId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/accounts')
  return { success: true }
}

// ─── Toggle single account enabled ────────────────────────────
export async function toggleAccount(
  customerId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('accounts')
    .update({ enabled })
    .eq('customer_id', customerId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/accounts')
  return { success: true }
}

// ─── Batch toggle accounts enabled ────────────────────────────
export async function batchToggleAccounts(
  customerIds: string[],
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  if (!customerIds.length) return { success: true }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('accounts')
    .update({ enabled })
    .in('customer_id', customerIds)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/accounts')
  return { success: true }
}
