'use server'

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { buildAccountFilePath, CMS_STORAGE_BUCKET, resolveStorageUrl } from '@/lib/storage'
import type { Account, AccountFile, AccountFormData, SessionUser } from '@/types'

const ACCOUNTS_CACHE_TAG = 'accounts-data'

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

function canAccessAccount(user: SessionUser, accountId: string) {
  const filter = buildAccountFilter(user)
  if (filter === 'NO_ACCESS') return false
  if (filter === null) return true
  return filter.includes(accountId)
}

export async function getAccounts(): Promise<Account[]> {
  const user = await getSession()
  if (!user) return []

  const filter = buildAccountFilter(user)
  if (filter === 'NO_ACCESS') return []
  const scopeKey = Array.isArray(filter) ? [...filter].sort().join(',') : 'all'

  return unstable_cache(
    async () => {
      const supabase = createServerClient()
      let query = supabase
        .from('accounts')
        .select('*')
        .order('created_date', { ascending: false })

      if (Array.isArray(filter) && filter.length > 0) {
        query = query.in('customer_id', filter)
      }

      const { data, error } = await query
      if (error) {
        console.error('getAccounts error:', error)
        return []
      }
      return (data as Account[]) ?? []
    },
    ['accounts-page', user.username, scopeKey],
    { revalidate: 60, tags: [ACCOUNTS_CACHE_TAG] }
  )()
}

export async function getAccountFiles(accountId: string): Promise<AccountFile[]> {
  const user = await getSession()
  if (!user || !canAccessAccount(user, accountId)) return []

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('account_files')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return Promise.all((data as AccountFile[]).map(async (row) => ({
    ...row,
    file_url: await resolveStorageUrl(supabase, row.storage_path),
  })))
}

export async function createAccountFileUploadUrlAction(input: {
  accountId: string
  fileName: string
  fileSize: number
  mimeType?: string
}): Promise<{ success: boolean; error?: string; signedUrl?: string; storagePath?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canAccessAccount(user, input.accountId)) return { success: false, error: 'Permission denied.' }
  if (!input.fileName.trim()) return { success: false, error: 'File name is required.' }
  if (input.fileSize <= 0) return { success: false, error: 'Invalid file size.' }
  if (input.fileSize > 1024 * 1024 * 1024) return { success: false, error: 'Each file must be under 1 GB.' }

  const supabase = createServerClient()
  const storagePath = buildAccountFilePath({
    ownerUsername: user.username,
    accountId: input.accountId,
    fileName: input.fileName,
  })

  const { data, error } = await supabase.storage
    .from(CMS_STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data?.signedUrl) {
    return { success: false, error: error?.message || 'Failed to prepare upload.' }
  }

  return {
    success: true,
    signedUrl: data.signedUrl,
    storagePath,
  }
}

export async function saveAccountFileAction(input: {
  accountId: string
  fileName: string
  fileSize: number
  mimeType?: string
  storagePath: string
}): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canAccessAccount(user, input.accountId)) return { success: false, error: 'Permission denied.' }

  const supabase = createServerClient()
  const { error } = await supabase.from('account_files').insert({
    account_id: input.accountId,
    file_name: input.fileName,
    file_size: input.fileSize,
    mime_type: input.mimeType || null,
    storage_path: input.storagePath,
    uploaded_by: user.username,
  })

  if (error) {
    return {
      success: false,
      error: error.message.includes('account_files')
        ? 'Missing account_files table in Supabase. Run the SQL setup first.'
        : error.message,
    }
  }

  revalidatePath('/dashboard/accounts')
  revalidateTag(ACCOUNTS_CACHE_TAG)
  return { success: true }
}

export async function deleteAccountFileAction(
  fileId: string,
  accountId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canAccessAccount(user, accountId)) return { success: false, error: 'Permission denied.' }

  const supabase = createServerClient()
  const { data: existing, error: fetchError } = await supabase
    .from('account_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('account_id', accountId)
    .single()

  if (fetchError || !existing) return { success: false, error: 'File not found.' }

  await supabase.storage
    .from(CMS_STORAGE_BUCKET)
    .remove([(existing as { storage_path: string }).storage_path])

  const { error } = await supabase
    .from('account_files')
    .delete()
    .eq('id', fileId)
    .eq('account_id', accountId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/accounts')
  revalidateTag(ACCOUNTS_CACHE_TAG)
  return { success: true }
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
  const payloadWithName = {
    customer_id: formData.customer_id.trim(),
    account_name: (formData as AccountFormData & { account_name?: string }).account_name?.trim() || null,
    google_sheet_link: formData.google_sheet_link || null,
    drive_code_comments: formData.drive_code_comments || null,
    workflow: formData.workflow || 'workflow-0',
    enabled: formData.enabled,
    status: 'Pending',
  }
  let { error } = await supabase.from('accounts').insert(payloadWithName)

  // Backward compatibility for databases that don't have account_name yet.
  if (error && error.message.includes('account_name')) {
    ;({ error } = await supabase.from('accounts').insert({
      customer_id: formData.customer_id.trim(),
      google_sheet_link: formData.google_sheet_link || null,
      drive_code_comments: formData.drive_code_comments || null,
      workflow: formData.workflow || 'workflow-0',
      enabled: formData.enabled,
      status: 'Pending',
    }))
  }

  if (error) {
    if (error.code === '23505') return { success: false, error: 'Customer ID already exists.' }
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/accounts')
  revalidateTag(ACCOUNTS_CACHE_TAG)
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
  const payloadWithName = {
    account_name: ((formData as Omit<AccountFormData, 'customer_id'> & { account_name?: string }).account_name || '').trim() || null,
    google_sheet_link: formData.google_sheet_link || null,
    drive_code_comments: formData.drive_code_comments || null,
    workflow: formData.workflow,
    enabled: formData.enabled,
  }

  let { error } = await supabase
    .from('accounts')
    .update(payloadWithName)
    .eq('customer_id', customerId)

  if (error && error.message.includes('account_name')) {
    ;({ error } = await supabase
      .from('accounts')
      .update({
        google_sheet_link: formData.google_sheet_link || null,
        drive_code_comments: formData.drive_code_comments || null,
        workflow: formData.workflow,
        enabled: formData.enabled,
      })
      .eq('customer_id', customerId))
  }

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/accounts')
  revalidateTag(ACCOUNTS_CACHE_TAG)
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
  revalidateTag(ACCOUNTS_CACHE_TAG)
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
  revalidateTag(ACCOUNTS_CACHE_TAG)
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
  revalidateTag(ACCOUNTS_CACHE_TAG)
  return { success: true }
}

// ─── Get user→account access map ──────────────────────────────
// Returns: customer_id → array of usernames with explicit access
export async function getAccountUserAccess(): Promise<Record<string, string[]>> {
  const user = await getSession()
  if (!user) return {}
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) return {}

  const supabase = createServerClient()
  const { data } = await supabase
    .from('users')
    .select('username, allowed_accounts, role')
    .order('username')

  if (!data) return {}

  const map: Record<string, string[]> = {}
  for (const row of data as Array<{ username: string; allowed_accounts: string | null; role: string }>) {
    // Admins/SMs have global access — skip (shown separately in UI)
    if (row.role === 'Admin' || row.role === 'Super Manager') continue

    const accounts = (row.allowed_accounts ?? '')
      .split(',')
      .map(a => a.trim())
      .filter(Boolean)
    if (accounts.includes('*') || accounts.includes('All')) continue

    for (const acct of accounts) {
      if (!map[acct]) map[acct] = []
      map[acct].push(row.username)
    }
  }
  return map
}

