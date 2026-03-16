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

function normalizeReportUrl(value: string | null | undefined): string {
  if (!value) return ''
  let url = value.trim()

  if (url.includes('<iframe')) {
    const match = url.match(/src="([^"]+)"/i)
    if (match?.[1]) url = match[1]
  }

  if (url.includes('lookerstudio.google.com/reporting/') && !url.includes('/embed/')) {
    url = url.replace('/reporting/', '/embed/reporting/')
  }

  return url
}

function normalizeReport(row: RawLookerReport): LookerReport {
  return {
    id: row.id,
    title: row.title ?? row.name ?? 'Untitled Report',
    report_url: normalizeReportUrl(row.report_url ?? row.url ?? ''),
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
  const bySortOrder = await supabase
    .from('looker_reports')
    .select('*')
    .order('sort_order', { ascending: true })

  const byUpdatedAt = bySortOrder.error
    ? await supabase
      .from('looker_reports')
      .select('*')
      .order('updated_at', { ascending: false })
    : bySortOrder

  if (byUpdatedAt.error) { console.error('getLookerReports error:', byUpdatedAt.error); return [] }

  const reports = ((byUpdatedAt.data as RawLookerReport[]) ?? [])
    .map(normalizeReport)
    .filter(r => {
      const raw = (byUpdatedAt.data as RawLookerReport[]).find(x => x.id === r.id)
      return raw?.active !== false
    })
    .filter(r => Boolean(r.report_url))

  // Non-Admin/Manager users only see reports they are allowed to view
  const normalizedRole = user.role.toLowerCase()
  const isPrivileged = normalizedRole === 'admin' || normalizedRole === 'super manager' || normalizedRole === 'manager'
  if (!isPrivileged) {
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
): Promise<{ success: boolean; error?: string; report?: LookerReport }> {
  const user = await getSession()
  if (!user) return { success: false, error: 'Not authenticated.' }
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) {
    return { success: false, error: 'Permission denied.' }
  }

  const supabase = createServerClient()
  const normalizedTitle = report.title.trim()
  const normalizedUrl = normalizeReportUrl(report.report_url)
  const normalizedAllowedUsers = report.allowed_users
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .join(', ')

  if (!normalizedTitle) return { success: false, error: 'Report title is required.' }
  if (!normalizedUrl) return { success: false, error: 'Looker Studio URL is required.' }

  if (report.id) {
    const primary = await supabase
      .from('looker_reports')
      .update({
        title: normalizedTitle,
        report_url: normalizedUrl,
        allowed_users: normalizedAllowedUsers,
      })
      .eq('id', report.id)
      .select('*')
      .single()

    if (primary.error) {
      const fallback = await supabase
        .from('looker_reports')
        .update({
          name: normalizedTitle,
          url: normalizedUrl,
          allowed_users: normalizedAllowedUsers,
        })
        .eq('id', report.id)
        .select('*')
        .single()

      if (fallback.error) return { success: false, error: fallback.error.message }

      revalidatePath('/dashboard/looker')
      return { success: true, report: normalizeReport(fallback.data as RawLookerReport) }
    }

    revalidatePath('/dashboard/looker')
    return { success: true, report: normalizeReport(primary.data as RawLookerReport) }
  } else {
    const primary = await supabase
      .from('looker_reports')
      .insert({
        title: normalizedTitle,
        report_url: normalizedUrl,
        allowed_users: normalizedAllowedUsers,
        created_by: user.username,
      })
      .select('*')
      .single()

    if (primary.error) {
      const fallback = await supabase
        .from('looker_reports')
        .insert({
          name: normalizedTitle,
          url: normalizedUrl,
          allowed_users: normalizedAllowedUsers,
          created_by: user.username,
          active: true,
        })
        .select('*')
        .single()

      if (fallback.error) return { success: false, error: fallback.error.message }

      revalidatePath('/dashboard/looker')
      return { success: true, report: normalizeReport(fallback.data as RawLookerReport) }
    }

    revalidatePath('/dashboard/looker')
    return { success: true, report: normalizeReport(primary.data as RawLookerReport) }
  }
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
