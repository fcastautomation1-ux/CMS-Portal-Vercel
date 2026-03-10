export function PageSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-48 rounded-xl bg-slate-200/70" />
        <div className="h-9 w-32 rounded-xl bg-slate-200/70" />
      </div>
      {/* Table header */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.6)' }}>
        <div className="grid gap-0" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          <div className="px-5 py-3 border-b border-slate-100" style={{ gridColumn: `1 / ${cols + 1}` }}>
            <div className="flex gap-4">
              {Array.from({ length: cols }).map((_, i) => (
                <div key={i} className="h-4 rounded-lg bg-slate-200/80 flex-1" />
              ))}
            </div>
          </div>
          {Array.from({ length: rows }).map((_, ri) => (
            <div
              key={ri}
              className="px-5 py-4 border-b border-slate-50 last:border-0"
              style={{ gridColumn: `1 / ${cols + 1}` }}
            >
              <div className="flex gap-4 items-center">
                {Array.from({ length: cols }).map((_, ci) => (
                  <div
                    key={ci}
                    className="h-4 rounded-lg bg-slate-100"
                    style={{ flex: 1, opacity: 1 - ci * 0.1 }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CardSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-48 rounded-xl bg-slate-200/70" />
        <div className="h-9 w-32 rounded-xl bg-slate-200/70" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl p-5 space-y-3"
            style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.6)' }}
          >
            <div className="h-5 w-3/4 rounded-lg bg-slate-200/80" />
            <div className="h-4 w-full rounded-lg bg-slate-100" />
            <div className="h-4 w-1/2 rounded-lg bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
