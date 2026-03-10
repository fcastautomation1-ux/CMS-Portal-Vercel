'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { LookerReport } from '@/types'

export async function getLookerReports(): Promise<LookerReport[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('looker_reports')
    .select('*')
    .order('sort_order')

  if (error) { console.error('getLookerReports error:', error); return [] }

  const reports = (data as unknown as LookerReport[]) ?? []

  // Non-Admin/Manager users only see reports they are allowed to view
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    const allowed = user.allowedLookerReports
    if (!allowed.includes('All') && !allowed.includes('*')) {
      return reports.filter(r => allowed.includes(r.id) || allowed.includes(r.title))
    }
  }

  return reports
}

export async function saveLookerReport(
  report: { id?: string; title: string; report_url: string; allowed_users: string }
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()

  if (report.id) {
    const { error } = await supabase
      .from('looker_reports')
      .update({
        title: report.title,
        report_url: report.report_url,
        allowed_users: report.allowed_users,
      })
      .eq('id', report.id)
    if (error) return { success: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('looker_reports')
      .insert({
        title: report.title,
        report_url: report.report_url,
        allowed_users: report.allowed_users,
        created_by: user.username,
      })
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/looker')
  return { success: true }
}

export async function deleteLookerReport(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('looker_reports').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/looker')
  return { success: true }
}
