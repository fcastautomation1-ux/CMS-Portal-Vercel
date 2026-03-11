'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import type { LookerReport } from '@/types'

type RawLookerReport = {
  id: string
  title?: string | null
  name?: string | null
  report_url?: string | null
  url?: string | null
  allowed_users?: string | null
  created_by?: string | null
  sort_order?: number | null
  created_at?: string | null
  updated_at?: string | null
  active?: boolean | null
}

function normalizeReport(row: RawLookerReport): LookerReport {
  return {
    id: row.id,
    title: row.title ?? row.name ?? 'Untitled Report',
    report_url: row.report_url ?? row.url ?? '',
    allowed_users: row.allowed_users ?? '',
    created_by: row.created_by ?? null,
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
  }
}

export async function getLookerReports(): Promise<LookerReport[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('looker_reports')
    .select('*')
    .order('sort_order')

  if (error) { console.error('getLookerReports error:', error); return [] }

  const reports = ((data as RawLookerReport[]) ?? [])
    .map(normalizeReport)
    .filter(r => Boolean(r.report_url))

  // Non-Admin/Manager users only see reports they are allowed to view
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    const allowed = user.allowedLookerReports
    if (!allowed.includes('All') && !allowed.includes('*')) {
      return reports.filter(r => {
        if (allowed.includes(r.id) || allowed.includes(r.title)) return true
        const parsedAllowedUsers = r.allowed_users
          .split(',')
          .map(v => v.trim().toLowerCase())
          .filter(Boolean)
        return parsedAllowedUsers.includes(user.username.toLowerCase())
          || parsedAllowedUsers.includes(user.role.toLowerCase())
          || parsedAllowedUsers.includes('all')
          || parsedAllowedUsers.includes('empty')
      })
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
    const primary = await supabase
      .from('looker_reports')
      .update({
        title: report.title,
        report_url: report.report_url,
        allowed_users: report.allowed_users,
      })
      .eq('id', report.id)

    if (primary.error) {
      const fallback = await supabase
        .from('looker_reports')
        .update({
          name: report.title,
          url: report.report_url,
          allowed_users: report.allowed_users,
        })
        .eq('id', report.id)

      if (fallback.error) return { success: false, error: fallback.error.message }
    }
  } else {
    const primary = await supabase
      .from('looker_reports')
      .insert({
        title: report.title,
        report_url: report.report_url,
        allowed_users: report.allowed_users,
        created_by: user.username,
      })

    if (primary.error) {
      const fallback = await supabase
        .from('looker_reports')
        .insert({
          name: report.title,
          url: report.report_url,
          allowed_users: report.allowed_users,
          created_by: user.username,
          active: true,
        })

      if (fallback.error) return { success: false, error: fallback.error.message }
    }
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
