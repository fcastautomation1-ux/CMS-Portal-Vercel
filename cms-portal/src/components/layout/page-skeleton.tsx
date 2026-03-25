export function PageSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 w-44 rounded-lg bg-slate-200" />
        <div className="h-9 w-28 rounded-lg bg-slate-200" />
      </div>
      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {/* thead */}
        <div className="flex gap-4 px-5 py-3" style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="h-3.5 rounded bg-slate-200 flex-1" />
          ))}
        </div>
        {/* rows */}
        {Array.from({ length: rows }).map((_, ri) => (
          <div
            key={ri}
            className="flex gap-4 px-5 py-4"
            style={{ borderBottom: ri < rows - 1 ? '1px solid var(--color-border)' : 'none' }}
          >
            {Array.from({ length: cols }).map((_, ci) => (
              <div
                key={ci}
                className="h-4 rounded bg-slate-100 flex-1"
                style={{ opacity: 1 - ci * 0.08 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CardSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 w-44 rounded-lg bg-slate-200" />
        <div className="h-9 w-28 rounded-lg bg-slate-200" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl p-5 space-y-3"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div className="h-5 w-3/4 rounded-lg bg-slate-200" />
            <div className="h-4 w-full rounded-lg bg-slate-100" />
            <div className="h-4 w-1/2 rounded-lg bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
