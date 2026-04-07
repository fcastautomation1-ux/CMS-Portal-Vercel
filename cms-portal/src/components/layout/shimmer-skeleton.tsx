/**
 * Vercel-style shimmer skeleton components for all dashboard pages.
 * Uses translateX sweep shimmer (same as TaskSkeleton).
 */

function ShimmerBox({ className }: { className: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-slate-100 ${className}`}>
      <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  )
}

/** Reusable page header shimmer — title + subtitle */
function PageHeaderShimmer() {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <ShimmerBox className="h-7 w-40" />
      <ShimmerBox className="h-4 w-64" />
    </div>
  )
}

/** Filter / search bar shimmer */
function FilterBarShimmer({ cols = 3 }: { cols?: number }) {
  return (
    <div className="mb-5 flex gap-3">
      <ShimmerBox className="h-10 flex-1 min-w-[120px]" />
      {Array.from({ length: cols - 1 }).map((_, i) => (
        <ShimmerBox key={i} className="h-10 w-32" />
      ))}
    </div>
  )
}

// ─── Tasks Page ────────────────────────────────────────────────────────────────

export function TasksPageSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-1">
      {/* Scope tabs row */}
      <div className="flex items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <ShimmerBox key={i} className="h-8 w-24 rounded-xl" />
        ))}
      </div>
      {/* Filter bar */}
      <div className="flex gap-3">
        <ShimmerBox className="h-10 flex-1" />
        <ShimmerBox className="h-10 w-28" />
        <ShimmerBox className="h-10 w-28" />
        <ShimmerBox className="h-10 w-10 rounded-xl" />
      </div>
      {/* Task cards */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded-[22px] border border-[#eef2f8] bg-white p-5 shadow-sm"
        >
          <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <ShimmerBox className="h-5 w-32" />
                <ShimmerBox className="h-5 w-16 rounded-full" />
              </div>
              <ShimmerBox className="h-4 w-3/4" />
              <div className="flex items-center gap-3 pt-1">
                <ShimmerBox className="h-6 w-24 rounded-full" />
                <ShimmerBox className="h-6 w-24 rounded-full" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <ShimmerBox className="h-8 w-8 rounded-full" />
              <ShimmerBox className="h-4 w-20" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-4">
            <div className="flex items-center gap-2">
              <ShimmerBox className="h-6 w-6 rounded-full" />
              <ShimmerBox className="h-4 w-24" />
            </div>
            <ShimmerBox className="h-6 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Team Page ─────────────────────────────────────────────────────────────────

export function TeamPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderShimmer />
      {/* Scope nav tabs */}
      <div className="mb-2 flex flex-wrap gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <ShimmerBox key={i} className="h-9 w-28 rounded-[14px]" />
        ))}
      </div>
      <FilterBarShimmer cols={3} />
      {/* Member cards grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
          >
            <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            <div className="flex flex-col items-center gap-3">
              <ShimmerBox className="h-12 w-12 rounded-full" />
              <ShimmerBox className="h-4 w-28" />
              <ShimmerBox className="h-3 w-36" />
              <ShimmerBox className="h-5 w-20 rounded-full" />
              <ShimmerBox className="h-1.5 w-full rounded-full" />
              <div className="flex w-full justify-between gap-2">
                <ShimmerBox className="h-10 flex-1 rounded-xl" />
                <ShimmerBox className="h-10 flex-1 rounded-xl" />
                <ShimmerBox className="h-10 flex-1 rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Dashboard Home ────────────────────────────────────────────────────────────

export function DashboardHomeSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeaderShimmer />
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white p-4 shadow-sm"
          >
            <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            <div className="flex items-start justify-between gap-2">
              <ShimmerBox className="h-10 w-10 rounded-xl" />
              <div className="flex flex-col items-end gap-1">
                <ShimmerBox className="h-7 w-14" />
                <ShimmerBox className="h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Recent activity block */}
      <div className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white p-5 shadow-sm">
        <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
        <ShimmerBox className="mb-4 h-5 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <ShimmerBox className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <ShimmerBox className="h-4 w-3/4" />
                <ShimmerBox className="h-3 w-1/2" />
              </div>
              <ShimmerBox className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Users / Table Pages ───────────────────────────────────────────────────────

export function UsersTableSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderShimmer />
      <FilterBarShimmer cols={3} />
      {/* Table */}
      <div className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white shadow-sm">
        <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
        {/* Table header */}
        <div className="flex items-center gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
          {[40, 32, 24, 20, 20].map((w, i) => (
            <ShimmerBox key={i} className={`h-4 w-${w}`} />
          ))}
        </div>
        {/* Table rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-slate-50 px-5 py-3.5 last:border-0">
            <ShimmerBox className="h-8 w-8 rounded-full shrink-0" />
            <ShimmerBox className="h-4 w-36" />
            <ShimmerBox className="h-4 w-40 ml-auto" />
            <ShimmerBox className="h-5 w-20 rounded-full" />
            <ShimmerBox className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Analytics / Looker ───────────────────────────────────────────────────────

export function AnalyticsPageSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeaderShimmer />
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white p-4 shadow-sm"
          >
            <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            <ShimmerBox className="mb-2 h-3 w-24" />
            <ShimmerBox className="h-8 w-16" />
          </div>
        ))}
      </div>
      {/* Chart blocks */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white p-5 shadow-sm"
          >
            <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            <ShimmerBox className="mb-4 h-5 w-32" />
            <ShimmerBox className="h-40 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

export function SettingsPageSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeaderShimmer />
      {/* Settings sections */}
      {Array.from({ length: 3 }).map((_, section) => (
        <div
          key={section}
          className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white p-5 shadow-sm"
        >
          <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
          <ShimmerBox className="mb-5 h-5 w-32" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, row) => (
              <div key={row} className="flex flex-col gap-1.5">
                <ShimmerBox className="h-3.5 w-24" />
                <ShimmerBox className="h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Generic fallback ─────────────────────────────────────────────────────────

export function GenericPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderShimmer />
      <FilterBarShimmer cols={2} />
      <div className="relative overflow-hidden rounded-[18px] border border-slate-100 bg-white p-5 shadow-sm">
        <div className="absolute inset-0 animate-[shimmer-sweep_1.8s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <ShimmerBox className="h-10 w-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-1.5">
                <ShimmerBox className="h-4 w-2/3" />
                <ShimmerBox className="h-3 w-1/2" />
              </div>
              <ShimmerBox className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
