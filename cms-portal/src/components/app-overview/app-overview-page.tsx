'use client'

import React, { useTransition } from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search, ExternalLink, ChevronDown, ChevronRight, X, Layers,
  Users, Zap, FolderOpen, RefreshCw, Clock3, CheckCircle2, Hourglass, BarChart2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query-keys'
import { getAppOverviewData, getAppBreakdownTimes, type AppOverviewData, type UserBreakdownTime } from '@/app/dashboard/app-overview/actions'
import {
  SearchableMultiSelectDropdown,
  type DropdownOption,
} from './searchable-filter-dropdown'
import { DateRangePicker } from '@/components/ui/date-range-picker'

type SortKey = 'app_name' | 'task_count' | 'team' | 'developer' | 'day_span'
type SortDir = 'asc' | 'desc'

const PER_PAGE = 15
const UNCATEGORIZED_VALUE = '__uncategorized__'

interface Props {
  data: AppOverviewData
  from?: string
  to?: string
}

interface ExpandedRow {
  users: boolean
  tasks: boolean
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  const totalHours = Math.floor(safeMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  if (days > 0 && hours > 0) return `${days}d ${hours}h`
  if (days > 0) return `${days}d`
  return `${hours}h`
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

function CompactMetricChip({
  icon: Icon,
  value,
  title,
  tone,
}: {
  icon: React.ElementType
  value: React.ReactNode
  title: string
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
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: colors.bg, color: colors.fg }}>
        <Icon size={11} />
      </span>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>
        {value}
      </span>
    </div>
  )
}

function ShimmerChip() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1" style={{ borderColor: 'var(--color-border)' }}>
      <span className="h-5 w-5 rounded-full animate-pulse" style={{ background: 'rgba(100,116,139,0.12)' }} />
      <span className="h-3 w-8 rounded animate-pulse" style={{ background: 'rgba(100,116,139,0.12)' }} />
    </div>
  )
}

/** Renders 4 <td> cells (tasks + allocated time + actual time + 2 deadline cols) for use inside a task breakdown table row */
function TaskBreakdownTimeCells({
  username,
  appName,
  from,
  to,
}: {
  username: string
  appName: string
  from?: string
  to?: string
}) {
  const { data: times, isLoading } = useQuery<UserBreakdownTime[]>({
    queryKey: queryKeys.appBreakdownTimes(appName, from, to),
    queryFn: () => getAppBreakdownTimes({ appName, from, to }),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const shimmer = (
    <span className="inline-block h-3 w-16 rounded animate-pulse" style={{ background: 'rgba(100,116,139,0.12)' }} />
  )

  if (isLoading || !times) {
    return (
      <>
        <td className="px-3 py-2.5 text-right">{shimmer}</td>
        <td className="px-3 py-2.5 text-right">{shimmer}</td>
        <td className="px-3 py-2.5 text-right">{shimmer}</td>
        <td className="px-3 py-2.5 text-right">{shimmer}</td>
      </>
    )
  }

  const userTime = times.find((t) => t.username.toLowerCase() === username.toLowerCase())
  const allocated = userTime?.total_minutes ?? 0
  const actual = userTime?.actual_minutes ?? 0
  const before = userTime?.before_deadline_minutes ?? 0
  const after = userTime?.after_deadline_minutes ?? 0

  const totalCompleted = before + after
  const effCalc = totalCompleted > 0 ? Math.round((before / totalCompleted) * 100) : 0
  let perfNode = <span style={{ color: '#94A3B8' }}>—</span>
  if (totalCompleted > 0) {
    if (effCalc >= 50) { // >= 50% completed before deadline is GOOD
       perfNode = <span style={{ color: '#10B981' }}>{effCalc}%</span>
    } else {
       perfNode = <span style={{ color: '#E11D48' }}>{effCalc}%</span>
    }
  }

  return (
    <>
      <td className="w-1/6 px-3 py-2.5 text-center tabular-nums font-semibold" style={{ color: '#475569' }} title={`Allocated task time: ${formatMinutes(allocated)}`}>
        {formatMinutes(allocated)}
      </td>
      <td className="w-1/6 px-3 py-2.5 text-center tabular-nums font-semibold" style={{ color: '#2B7FFF' }} title={`Actual taken time: ${formatMinutes(actual)}`}>
        {formatMinutes(actual)}
      </td>
      <td className="w-1/6 px-3 py-2.5 text-center tabular-nums font-semibold" style={{ color: '#16A34A' }} title={`Completion before deadline: ${formatMinutes(before)}`}>
        {formatMinutes(before)}
      </td>
      <td className="w-1/6 px-3 py-2.5 text-center tabular-nums font-semibold" style={{ color: '#E11D48' }} title={`Completion after deadline: ${formatMinutes(after)}`}>
        {formatMinutes(after)}
      </td>
      <td className="w-1/6 px-3 py-2.5 text-center tabular-nums font-bold" title="Percentage of completed time before deadline">
        {perfNode}
      </td>
    </>
  )
}

export function AppOverviewPage({ data: initialData, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Record<string, ExpandedRow>>({})
  const [page, setPage] = useState(1)
  const [activeTab, setActiveTab] = useState<'apps' | 'users'>('apps')
  const searchParamsString = searchParams.toString()

  // Use React Query to manage data with caching and refresh capability
  const currentUser = 'dashboard' // This would come from session in real app
  const { data = initialData } = useQuery({
    queryKey: queryKeys.appOverview(currentUser, from, to),
    queryFn: () => getAppOverviewData({ from, to }),
    initialData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const handleRefresh = () => {
    startTransition(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.appOverview(currentUser, from, to),
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

  const handleDateRangeChange = useCallback(
    ({ from, to }: { from?: string; to?: string }) => {
      updateQueryParams((params) => {
        if (from) params.set('from', from)
        else params.delete('from')
        if (to) params.set('to', to)
        else params.delete('to')
      })
    },
    [updateQueryParams],
  )

  const clearDateRange = useCallback(() => {
    updateQueryParams((params) => {
      params.delete('from')
      params.delete('to')
    })
  }, [updateQueryParams])

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

  const periodLabel = (from || to)
    ? `${from ? new Date(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Start'} → ${to ? new Date(to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Now'}`
    : 'All Time'

  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedAppValues.length > 0 ||
    selectedDepartmentValues.length > 0 ||
    selectedUserValues.length > 0 ||
    Boolean(from || to)

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

      {/* ── Tabs ──────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', width: 'fit-content' }}>
        {([
          { key: 'apps', label: 'App Overview', icon: Layers },
          { key: 'users', label: 'User Overview', icon: BarChart2 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={activeTab === key
              ? { background: '#2B7FFF', color: '#fff', boxShadow: '0 1px 4px rgba(43,127,255,0.3)' }
              : { color: 'var(--color-text-muted)' }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters (Global) ──────────────────────────── */}
      <div className="rounded-2xl border bg-white p-3 shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_auto]">
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
          {/* Date range filter */}
          <div className="flex flex-col gap-1.5 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>Date Range</p>
            <DateRangePicker
              from={from}
              to={to}
              onRangeChange={handleDateRangeChange}
              onClear={clearDateRange}
            />
          </div>
        </div>
      </div>

      {/* ── Search (Global) ───────────────────────────── */}
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

      {/* ── User Overview Tab ─────────────────────────── */}
      {activeTab === 'users' && (
        <UserOverviewPanel periodLabel={periodLabel} rows={filtered} from={from} to={to} selectedUsers={selectedUserValues} />
      )}

      {/* ── App Overview Tab ──────────────────────────── */}
      {activeTab === 'apps' && (<>

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
                                      className="rounded-xl border bg-white p-3 shadow-sm"
                                      style={{ borderColor: 'var(--color-border)' }}
                                    >
                                      {/* Header */}
                                      <div className="flex items-center gap-2.5 mb-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: '#2B7FFF' }}>
                                          {user.username.slice(0, 1).toUpperCase()}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                                            {user.username}
                                          </p>
                                          <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                                            {user.count} task{user.count !== 1 ? 's' : ''} assigned
                                          </p>
                                        </div>
                                      </div>

                                      {/* Stats row */}
                                      <div className="grid grid-cols-3 gap-1.5">
                                        <div className="rounded-lg px-2 py-2 text-center" style={{ background: 'rgba(16,185,129,0.07)' }}>
                                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: '#059669' }}>Done</p>
                                          <p className="text-base font-bold tabular-nums" style={{ color: '#059669' }}>{user.completed_count}</p>
                                        </div>
                                        <div className="rounded-lg px-2 py-2 text-center" style={{ background: 'rgba(43,127,255,0.07)' }}>
                                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: '#2B7FFF' }}>Active</p>
                                          <p className="text-base font-bold tabular-nums" style={{ color: '#2B7FFF' }}>{user.in_progress_count}</p>
                                        </div>
                                        <div className="rounded-lg px-2 py-2 text-center" style={{ background: 'rgba(245,158,11,0.07)' }}>
                                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: '#D97706' }}>Pending</p>
                                          <p className="text-base font-bold tabular-nums" style={{ color: '#D97706' }}>{user.pending_count}</p>
                                        </div>
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
                                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                                  <table className="w-full text-xs border-collapse">
                                    <thead>
                                      <tr style={{ background: 'var(--color-surface-raised, rgba(0,0,0,0.03))' }}>
                                        <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                                          User
                                        </th>
                                        <th className="w-1/6 px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                                          Tasks
                                        </th>
                                        <th className="w-1/6 px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#475569', borderBottom: '1px solid var(--color-border)' }}>
                                          Allocated Task Time
                                        </th>
                                        <th className="w-1/6 px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#2B7FFF', borderBottom: '1px solid var(--color-border)' }}>
                                          Actual Taken Time
                                        </th>
                                        <th className="w-1/6 px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#16A34A', borderBottom: '1px solid var(--color-border)' }}>
                                          Completion Before Deadline
                                        </th>
                                        <th className="w-1/6 px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#E11D48', borderBottom: '1px solid var(--color-border)' }}>
                                          Completion After Deadline
                                        </th>
                                        <th className="w-1/6 px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                                          Performance
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.task_by_user.map((ut, idx) => (
                                        <tr
                                          key={ut.username}
                                          style={{
                                            background: idx % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised, rgba(0,0,0,0.015))',
                                            borderBottom: idx < row.task_by_user.length - 1 ? '1px solid var(--color-border)' : 'none',
                                          }}
                                        >
                                          <td className="px-3 py-2.5">
                                            <span className="block truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                                              {ut.username}
                                            </span>
                                          </td>
                                          <td className="w-1/6 px-3 py-2.5 text-center tabular-nums text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>
                                            {ut.count}
                                          </td>
                                          <TaskBreakdownTimeCells
                                            username={ut.username}
                                            appName={row.app_name}
                                            from={from}
                                            to={to}
                                          />
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
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
      </>)}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * User Overview Tab — table of users, each expandable to show per-app breakdown.
 * ───────────────────────────────────────────────────────────────────────────── */
function UserOverviewPanel({
  periodLabel,
  rows,
  from,
  to,
  selectedUsers,
}: {
  periodLabel: string
  rows: AppOverviewData['rows']
  from?: string
  to?: string
  selectedUsers: string[]
}) {
  const [search, setSearch] = useState('')
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const PER_PAGE_USERS = 20

  type UserAppEntry = {
    appName: string
    count: number
    completed_count: number
    in_progress_count: number
    pending_count: number
    play_store_url: string | null
  }

  type UserEntry = {
    username: string
    total_tasks: number
    completed_count: number
    in_progress_count: number
    pending_count: number
    apps: UserAppEntry[]
  }

  const allUsers = useMemo<UserEntry[]>(() => {
    const map = new Map<string, UserEntry>()
    for (const row of rows) {
      for (const stat of row.user_stats) {
        if (selectedUsers.length > 0 && !selectedUsers.includes(stat.username)) continue
        const key = stat.username.toLowerCase()
        const existing = map.get(key) ?? {
          username: stat.username,
          total_tasks: 0,
          completed_count: 0,
          in_progress_count: 0,
          pending_count: 0,
          apps: [],
        }
        existing.total_tasks += stat.count
        existing.completed_count += stat.completed_count
        existing.in_progress_count += stat.in_progress_count
        existing.pending_count += stat.pending_count
        existing.apps.push({
          appName: row.app_name,
          count: stat.count,
          completed_count: stat.completed_count,
          in_progress_count: stat.in_progress_count,
          pending_count: stat.pending_count,
          play_store_url: row.play_store_url,
        })
        map.set(key, existing)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total_tasks - a.total_tasks)
  }, [rows, selectedUsers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allUsers
    return allUsers.filter((u) => u.username.toLowerCase().includes(q))
  }, [allUsers, search])

  const totalTasks = allUsers.reduce((s, u) => s + u.total_tasks, 0)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE_USERS))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PER_PAGE_USERS, safePage * PER_PAGE_USERS)

  const toggleUser = (username: string) =>
    setExpandedUsers((prev) => ({ ...prev, [username]: !prev[username] }))

  return (
    <div className="space-y-4">
      {/* Sub-header + search */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {allUsers.length} user{allUsers.length !== 1 ? 's' : ''} · {totalTasks} tasks · {periodLabel}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <Users size={24} style={{ color: '#94A3B8' }} />
          <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>No users found</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border)' }}>
                  <th className="w-10 px-4 py-3 text-center text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>#</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>User</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Apps</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Tasks</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: '#059669' }}>Done</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: '#2B7FFF' }}>Active</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: '#D97706' }}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((user, idx) => {
                  const globalIdx = (safePage - 1) * PER_PAGE_USERS + idx + 1
                  const isEven = idx % 2 === 1
                  const isExpanded = expandedUsers[user.username] ?? false

                  return (
                    <React.Fragment key={user.username}>
                      {/* ── Main User Row ── */}
                      <tr style={{ background: isEven ? 'rgba(248,250,252,0.5)' : 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                        <td className="w-10 px-4 py-3 text-center text-xs font-bold tabular-nums" style={{ color: '#94A3B8' }}>{globalIdx}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: '#2B7FFF' }}>
                              {user.username.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{user.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleUser(user.username)}
                            className="inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-slate-100 px-2 py-1"
                            style={{ color: '#8B5CF6' }}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <Layers size={14} />
                            <span className="text-xs font-bold">{user.apps.length}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold" style={{ background: 'rgba(43,127,255,0.08)', color: '#2B7FFF' }}>
                            <Zap size={13} />
                            {user.total_tasks}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: '#059669' }}>{user.completed_count}</td>
                        <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: '#2B7FFF' }}>{user.in_progress_count}</td>
                        <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: '#D97706' }}>{user.pending_count}</td>
                      </tr>

                      {/* ── Expanded: Per-App Breakdown ── */}
                      {isExpanded && (
                        <tr style={{ background: 'rgba(139,92,246,0.02)', borderBottom: '1px solid var(--color-border)' }}>
                          <td colSpan={7} className="px-4 py-4">
                            <div className="space-y-2">
                              <p className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>
                                App Breakdown for {user.username} ({user.apps.length} app{user.apps.length !== 1 ? 's' : ''})
                              </p>
                              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr style={{ background: 'var(--color-surface-raised, rgba(0,0,0,0.03))' }}>
                                      <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>App</th>
                                        <th className="w-[10%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>Tasks</th>
                                        <th className="w-[8%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#059669', borderBottom: '1px solid var(--color-border)' }}>Done</th>
                                        <th className="w-[8%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#2B7FFF', borderBottom: '1px solid var(--color-border)' }}>Active</th>
                                        <th className="w-[8%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#D97706', borderBottom: '1px solid var(--color-border)' }}>Pending</th>
                                        <th className="w-[13%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#475569', borderBottom: '1px solid var(--color-border)' }}>Allocated Task Time</th>
                                        <th className="w-[13%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#2B7FFF', borderBottom: '1px solid var(--color-border)' }}>Actual Taken Time</th>
                                        <th className="w-[13%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#16A34A', borderBottom: '1px solid var(--color-border)' }}>Completion Before Deadline</th>
                                        <th className="w-[13%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: '#E11D48', borderBottom: '1px solid var(--color-border)' }}>Completion After Deadline</th>
                                        <th className="w-[10%] px-3 py-2 text-center font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>Performance</th>
                                        <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>Link</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {[...user.apps].sort((a, b) => b.count - a.count).map((app, appIdx) => (
                                        <tr
                                          key={app.appName}
                                          style={{
                                            background: appIdx % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised, rgba(0,0,0,0.015))',
                                            borderBottom: appIdx < user.apps.length - 1 ? '1px solid var(--color-border)' : 'none',
                                          }}
                                        >
                                          <td className="px-3 py-2.5">
                                            <span className="block truncate font-semibold" style={{ color: 'var(--color-text)' }}>{app.appName}</span>
                                          </td>
                                          <td className="px-3 py-2.5 text-center tabular-nums font-bold" style={{ color: 'var(--color-text-muted)' }}>{app.count}</td>
                                          <td className="px-3 py-2.5 text-center tabular-nums font-bold" style={{ color: '#059669' }}>{app.completed_count}</td>
                                          <td className="px-3 py-2.5 text-center tabular-nums font-bold" style={{ color: '#2B7FFF' }}>{app.in_progress_count}</td>
                                          <td className="px-3 py-2.5 text-center tabular-nums font-bold" style={{ color: '#D97706' }}>{app.pending_count}</td>
                                        <TaskBreakdownTimeCells
                                          username={user.username}
                                          appName={app.appName}
                                          from={from}
                                          to={to}
                                        />
                                        <td className="px-3 py-2.5 text-right">
                                          {app.play_store_url ? (
                                            <a
                                              href={app.play_store_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all hover:bg-blue-50"
                                              style={{ background: 'rgba(43,127,255,0.08)', color: '#2B7FFF' }}
                                            >
                                              App <ExternalLink size={10} />
                                            </a>
                                          ) : (
                                            <span style={{ color: '#CBD5E1' }}>—</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Showing {(safePage - 1) * PER_PAGE_USERS + 1}–{Math.min(safePage * PER_PAGE_USERS, filtered.length)} of {filtered.length} users
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
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
                        style={p === safePage ? { background: '#2B7FFF', borderColor: '#2B7FFF', color: '#fff' } : { borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
                      >
                        {p}
                      </button>
                    </div>
                  ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
