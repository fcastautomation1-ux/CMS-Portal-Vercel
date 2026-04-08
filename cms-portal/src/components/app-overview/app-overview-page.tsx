'use client'

import React, { useTransition } from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search, ExternalLink, ChevronDown, ChevronRight, X, Layers,
  Users, Zap, FolderOpen, RefreshCw, CheckCircle2, Clock3, Timer, CalendarCheck2, CalendarX2, Hourglass,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { getAppOverviewData, type AppOverviewData } from '@/app/dashboard/app-overview/actions'
import {
  SearchableMultiSelectDropdown,
  SearchableSingleSelectDropdown,
  type DropdownOption,
} from './searchable-filter-dropdown'

type SortKey = 'app_name' | 'task_count' | 'team' | 'developer' | 'day_span'
type SortDir = 'asc' | 'desc'

const QUARTERS = [1, 2, 3, 4] as const
const PER_PAGE = 15
const UNCATEGORIZED_VALUE = '__uncategorized__'

interface Props {
  data: AppOverviewData
  year?: number
  quarter?: number
}

interface ExpandedRow {
  users: boolean
  tasks: boolean
}

function buildTimelineValue(year?: number, quarter?: number) {
  if (!year) return 'all'
  if (quarter) return `year:${year}:q${quarter}`
  return `year:${year}`
}

function parseTimelineValue(value: string): { year?: number; quarter?: number } {
  if (!value || value === 'all') return {}
  const parts = value.split(':')
  if (parts[0] !== 'year' || parts.length < 2) return {}
  const year = Number(parts[1])
  if (!Number.isFinite(year)) return {}
  if (parts[2]) {
    const quarter = Number(parts[2].replace(/^q/i, ''))
    if (Number.isFinite(quarter) && quarter >= 1 && quarter <= 4) {
      return { year, quarter }
    }
  }
  return { year }
}

function formatMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function MetricBadge({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  tone: 'blue' | 'green' | 'amber' | 'slate' | 'emerald' | 'rose'
}) {
  const toneStyles: Record<typeof tone, { bg: string; fg: string }> = {
    blue: { bg: 'rgba(43,127,255,0.10)', fg: '#2B7FFF' },
    green: { bg: 'rgba(16,185,129,0.10)', fg: '#059669' },
    amber: { bg: 'rgba(245,158,11,0.12)', fg: '#D97706' },
    slate: { bg: 'rgba(100,116,139,0.10)', fg: '#475569' },
    emerald: { bg: 'rgba(34,197,94,0.10)', fg: '#16A34A' },
    rose: { bg: 'rgba(244,63,94,0.10)', fg: '#E11D48' },
  }

  const colors = toneStyles[tone]

  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: colors.bg, color: colors.fg }}>
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </p>
        <p className="truncate text-xs font-bold" style={{ color: 'var(--color-text)' }}>
          {value}
        </p>
      </div>
    </div>
  )
}

export function AppOverviewPage({ data: initialData, year, quarter }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Record<string, ExpandedRow>>({})
  const [page, setPage] = useState(1)
  const searchParamsString = searchParams.toString()

  // Use React Query to manage data with caching and refresh capability
  const currentUser = 'dashboard' // This would come from session in real app
  const { data = initialData } = useQuery({
    queryKey: queryKeys.appOverview(currentUser, year, quarter),
    queryFn: () => getAppOverviewData({ year, quarter }),
    initialData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const handleRefresh = () => {
    startTransition(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.appOverview(currentUser, year, quarter),
      })
    })
  }

  const selectedAppValues = useMemo(
    () => Array.from(new Set(new URLSearchParams(searchParamsString).getAll('apps').filter(Boolean))),
    [searchParamsString],
  )
  const selectedDepartmentValues = useMemo(
    () => Array.from(new Set(new URLSearchParams(searchParamsString).getAll('departments').filter(Boolean))),
    [searchParamsString],
  )
  const selectedUserValues = useMemo(
    () => Array.from(new Set(new URLSearchParams(searchParamsString).getAll('users').filter(Boolean))),
    [searchParamsString],
  )

  const currentYear = new Date().getFullYear()
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2]

  const timelineValue = buildTimelineValue(year, quarter)

  const updateQueryParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParamsString)
      mutate(params)
      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
      setPage(1)
    },
    [pathname, router, searchParamsString],
  )

  const setMultiSelectParam = useCallback(
    (key: 'apps' | 'departments' | 'users', values: string[]) => {
      updateQueryParams((params) => {
        params.delete(key)
        values.forEach((value) => params.append(key, value))
      })
    },
    [updateQueryParams],
  )

  const handleTimelineChange = useCallback(
    (value: string) => {
      updateQueryParams((params) => {
        const next = parseTimelineValue(value)
        if (next.year) params.set('year', String(next.year))
        else params.delete('year')

        if (next.quarter) params.set('quarter', String(next.quarter))
        else params.delete('quarter')
      })
    },
    [updateQueryParams],
  )

  const appOptions = useMemo<DropdownOption[]>(() => {
    return [...data.rows]
      .sort((a, b) => b.task_count - a.task_count || a.app_name.localeCompare(b.app_name))
      .map((row) => ({ value: row.app_name, label: row.app_name, count: row.task_count }))
  }, [data.rows])

  const departmentOptions = useMemo<DropdownOption[]>(() => {
    const map = new Map<string, DropdownOption>()

    for (const row of data.rows) {
      if (row.departments.length === 0) {
        const existing = map.get(UNCATEGORIZED_VALUE) ?? { value: UNCATEGORIZED_VALUE, label: 'Uncategorized', count: 0 }
        existing.count = (existing.count ?? 0) + row.task_count
        map.set(UNCATEGORIZED_VALUE, existing)
        continue
      }

      for (const dept of row.departments) {
        const value = dept.name?.trim() || UNCATEGORIZED_VALUE
        const label = dept.name?.trim() || 'Uncategorized'
        const existing = map.get(value) ?? { value, label, count: 0 }
        existing.count = (existing.count ?? 0) + dept.task_count
        map.set(value, existing)
      }
    }

    return Array.from(map.values()).sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label))
  }, [data.rows])

  const userOptions = useMemo<DropdownOption[]>(() => {
    const map = new Map<string, number>()
    for (const row of data.rows) {
      for (const entry of row.task_by_user) {
        map.set(entry.username, (map.get(entry.username) ?? 0) + entry.count)
      }
    }

    return Array.from(map.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label))
  }, [data.rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    const matches = (selected: string[], values: string[]) => {
      if (selected.length === 0) return true
      return values.some((value) => selected.includes(value))
    }

    return data.rows.filter((row) => {
      if (!matches(selectedAppValues, [row.app_name])) return false
      if (!matches(selectedUserValues, row.users)) return false

      const rowDepartments = row.departments.length > 0
        ? row.departments.map((dept) => dept.name?.trim() || UNCATEGORIZED_VALUE)
        : [UNCATEGORIZED_VALUE]
      if (!matches(selectedDepartmentValues, rowDepartments)) return false

      if (!q) return true

      const searchable = [
        row.app_name,
        row.department ?? '',
        ...row.users,
        ...row.departments.map((dept) => dept.name ?? 'Uncategorized'),
      ].join(' ').toLowerCase()

      return searchable.includes(q)
    })
  }, [data.rows, search, selectedAppValues, selectedDepartmentValues, selectedUserValues])

  const filteredTasks = useMemo(
    () => filtered.reduce((sum, row) => sum + row.task_count, 0),
    [filtered],
  )

  const toggleExpanded = (appName: string, section: 'users' | 'tasks') => {
    setExpandedIds((prev) => ({
      ...prev,
      [appName]: { ...prev[appName], [section]: !prev[appName]?.[section] },
    }))
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const periodLabel = year
    ? quarter
      ? `Q${quarter} ${year}`
      : `${year}`
    : 'All Time'

  const timelineOptions = useMemo<DropdownOption[]>(() => {
    const options: DropdownOption[] = [{ value: 'all', label: 'All Time' }]
    for (const y of yearOptions) {
      options.push({ value: `year:${y}`, label: String(y) })
      for (const q of QUARTERS) {
        options.push({ value: `year:${y}:q${q}`, label: `Q${q} ${y}` })
      }
    }
    return options
  }, [yearOptions])

  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedAppValues.length > 0 ||
    selectedDepartmentValues.length > 0 ||
    selectedUserValues.length > 0

  return (
    <div className="space-y-5">
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>
            App Overview
          </h1>
          <p className="mt-1.5 text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {filtered.length} apps • {filteredTasks} total tasks • {periodLabel}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={pending}
          className="flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-semibold transition-all hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          title="Refresh page data"
        >
          <RefreshCw size={14} className={pending ? 'animate-spin' : ''} />
          {pending ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* ── Filters ───────────────────────────────────── */}
      <div className="rounded-2xl border bg-white p-3 shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
        <div className="grid gap-3 xl:grid-cols-4">
          <SearchableMultiSelectDropdown
            label="Departments"
            options={departmentOptions}
            selectedValues={selectedDepartmentValues}
            onChange={(next) => setMultiSelectParam('departments', next)}
            placeholder="All departments"
          />
          <SearchableMultiSelectDropdown
            label="Users"
            options={userOptions}
            selectedValues={selectedUserValues}
            onChange={(next) => setMultiSelectParam('users', next)}
            placeholder="All users"
          />
          <SearchableMultiSelectDropdown
            label="Apps"
            options={appOptions}
            selectedValues={selectedAppValues}
            onChange={(next) => setMultiSelectParam('apps', next)}
            placeholder="All apps"
          />
          <SearchableSingleSelectDropdown
            label="Timeline"
            options={timelineOptions}
            selectedValue={timelineValue}
            onChange={handleTimelineChange}
            placeholder="All time"
            panelAlign="right"
          />
        </div>
      </div>

      {/* ── Search ────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            placeholder="Search visible apps, users, departments…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="h-9 w-full rounded-lg pl-9 pr-8 text-sm outline-none"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>
        {search && (
          <button
            onClick={() => setSearch('')}
            className="h-9 rounded-lg px-3 text-xs font-semibold border transition-colors hover:bg-red-50"
            style={{ borderColor: '#FCA5A5', color: '#DC2626' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Table ─────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
        {paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl mb-3" style={{ background: 'rgba(43,127,255,0.08)' }}>
              <Layers size={24} style={{ color: '#2B7FFF' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {hasActiveFilters ? 'No apps match the current filters' : 'No data available'}
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
              {hasActiveFilters ? 'Clear a filter or change the search text to see more results' : 'Check back later for app data'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border)' }}>
                    <th className="w-10 px-4 py-3 text-center text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                      #
                    </th>
                    {(['app_name', 'department', 'users', 'tasks', 'app_link'] as const).map((col) => {
                      const labels: Record<typeof col, string> = {
                        app_name: 'App Name',
                        department: 'Department',
                        users: 'Users',
                        tasks: 'Tasks',
                        app_link: 'Action',
                      }
                      return (
                        <th
                          key={col}
                          className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {labels[col]}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row, idx) => {
                    const globalIdx = (safePage - 1) * PER_PAGE + idx + 1
                    const isEven = idx % 2 === 1
                    const expanded = expandedIds[row.app_name] || { users: false, tasks: false }
                    const primaryDepartment = row.department ?? row.departments[0]?.name ?? null
                    const extraDepartmentCount = Math.max(0, row.departments.length - 1)

                    return (
                      <React.Fragment key={row.app_name}>
                        {/* ── Main Row ────────────────────── */}
                        <tr
                          style={{
                            background: isEven ? 'rgba(248,250,252,0.5)' : 'var(--color-surface)',
                            borderBottom: '1px solid var(--color-border)',
                          }}
                        >
                          {/* # */}
                          <td className="w-10 px-4 py-3 text-center text-xs font-bold tabular-nums" style={{ color: '#94A3B8' }}>
                            {globalIdx}
                          </td>

                          {/* App Name */}
                          <td className="px-4 py-3">
                            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
                              {row.app_name}
                            </span>
                          </td>

                          {/* Department - Dropdown */}
                          <td className="px-4 py-3">
                            {primaryDepartment ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: 'rgba(139,92,246,0.08)', color: 'var(--color-text)' }}>
                                <FolderOpen size={13} style={{ color: '#8B5CF6', opacity: 0.75 }} />
                                <span className="truncate">{primaryDepartment}</span>
                                {extraDepartmentCount > 0 && (
                                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                    +{extraDepartmentCount}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-xs" style={{ color: '#CBD5E1' }}>—</span>
                            )}
                          </td>

                          {/* Users - Expandable */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleExpanded(row.app_name, 'users')}
                              className="inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-slate-100 px-2 py-1"
                              style={{ color: '#2B7FFF' }}
                            >
                              {expanded.users ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                              <Users size={14} />
                              <span className="text-xs font-bold">{row.users.length}</span>
                            </button>
                          </td>

                          {/* Tasks - Expandable */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleExpanded(row.app_name, 'tasks')}
                              className="inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-slate-100 px-2 py-1"
                              style={{ color: '#10B981' }}
                            >
                              {expanded.tasks ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                              <Zap size={14} />
                              <span className="text-xs font-bold tabular-nums">{row.task_count}</span>
                            </button>
                          </td>

                          {/* App Link */}
                          <td className="px-4 py-3">
                            {row.play_store_url ? (
                              <a
                                href={row.play_store_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold text-xs transition-all hover:bg-blue-50"
                                style={{ background: 'rgba(43,127,255,0.1)', color: '#2B7FFF' }}
                                title={`Open ${row.app_name} on Play Store`}
                              >
                                <span>App Link</span>
                                <ExternalLink size={12} />
                              </a>
                            ) : (
                              <span className="text-xs" style={{ color: '#CBD5E1' }}>—</span>
                            )}
                          </td>
                        </tr>

                        {/* ── Expanded: Users ─────────────────── */}
                        {expanded.users && (
                          <tr style={{ background: 'rgba(43,127,255,0.02)', borderBottom: '1px solid var(--color-border)' }}>
                            <td colSpan={6} className="px-4 py-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>
                                    {row.user_stats.length} Direct Participant{row.user_stats.length !== 1 ? 's' : ''}
                                  </p>
                                  <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                                    Metrics are counted per direct assignee
                                  </p>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                                  {row.user_stats.map((user) => (
                                    <div
                                      key={user.username}
                                      className="rounded-2xl border bg-white p-3 shadow-sm"
                                      style={{ borderColor: 'var(--color-border)' }}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white" style={{ background: '#2B7FFF' }}>
                                            {user.username.slice(0, 1).toUpperCase()}
                                          </span>
                                          <div className="min-w-0">
                                            <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                                              {user.username}
                                            </p>
                                            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                                              {user.count} task{user.count !== 1 ? 's' : ''} assigned
                                            </p>
                                          </div>
                                        </div>
                                        <div className="rounded-xl px-2.5 py-1.5 text-right" style={{ background: 'rgba(43,127,255,0.08)' }}>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
                                            Total time
                                          </p>
                                          <p className="text-sm font-bold" style={{ color: '#2B7FFF' }}>
                                            {formatMinutes(user.total_minutes)}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <MetricBadge icon={CheckCircle2} label="Completed" value={user.completed_count} tone="green" />
                                        <MetricBadge icon={Clock3} label="In progress" value={user.in_progress_count} tone="blue" />
                                        <MetricBadge icon={Hourglass} label="Pending" value={user.pending_count} tone="amber" />
                                        <MetricBadge icon={Timer} label="Total time" value={formatMinutes(user.total_minutes)} tone="slate" />
                                        <MetricBadge icon={CalendarCheck2} label="Before deadline" value={user.completed_before_deadline_count} tone="emerald" />
                                        <MetricBadge icon={CalendarX2} label="After deadline" value={user.completed_after_deadline_count} tone="rose" />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* ── Expanded: Per-User Tasks ─────────── */}
                        {expanded.tasks && (
                          <tr style={{ background: 'rgba(16,185,129,0.02)', borderBottom: '1px solid var(--color-border)' }}>
                            <td colSpan={6} className="px-4 py-4">
                              <div className="space-y-2">
                                <p className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>
                                  Task Breakdown ({row.task_count} Total)
                                </p>
                                <div className="space-y-1.5">
                                  {row.task_by_user.map((ut) => (
                                    <div
                                      key={ut.username}
                                      className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
                                      style={{ background: 'var(--color-surface)', borderLeft: '3px solid #10B981' }}
                                    >
                                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                                        {ut.username}
                                      </span>
                                      <span
                                        className="px-2 py-0.5 rounded-md font-bold tabular-nums"
                                        style={{ background: 'rgba(16,185,129,0.12)', color: '#059669' }}
                                      >
                                        {ut.count}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ────────────────────────── */}
            {totalPages > 1 && (
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
              >
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Showing {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, filtered.length)} of {filtered.length} apps
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => Math.abs(p - safePage) <= 1 || p === 1 || p === totalPages)
                    .map((p, i, arr) => (
                      <div key={p}>
                        {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1">…</span>}
                        <button
                          onClick={() => setPage(p)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition-colors border"
                          style={
                            p === safePage
                              ? { background: '#2B7FFF', borderColor: '#2B7FFF', color: '#fff' }
                              : { borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)' }
                          }
                        >
                          {p}
                        </button>
                      </div>
                    ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
