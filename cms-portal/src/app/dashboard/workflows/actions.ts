'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { Workflow } from '@/types'

/** Workflows are only visible to Admin/SM, or Managers with 'all' account access */
function canAccessWorkflows(user: Awaited<ReturnType<typeof getSession>>): boolean {
  if (!user) return false
  if (user.role === 'Admin' || user.role === 'Super Manager') return true
  return user.role === 'Manager' && user.moduleAccess?.googleAccount?.accessLevel === 'all'
}

export async function getWorkflows(): Promise<Workflow[]> {
  const user = await getSession()
  if (!canAccessWorkflows(user)) return []

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .order('workflow_name')

  if (error) { console.error('getWorkflows error:', error); return [] }
  return (data as unknown as Workflow[]) ?? []
}

export async function toggleWorkflow(
  workflowName: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!canAccessWorkflows(user)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('workflows')
    .update({ enabled })
    .eq('workflow_name', workflowName)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/workflows')
  return { success: true }
}
