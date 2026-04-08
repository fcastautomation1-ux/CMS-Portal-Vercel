export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-64 rounded-lg bg-slate-200 animate-pulse" />
      <div className="h-4 w-96 rounded bg-slate-200 animate-pulse" />
      <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
        <div className="h-12 bg-slate-100 animate-pulse" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-11 border-t border-slate-100 bg-white animate-pulse" style={{ opacity: 1 - i * 0.07 }} />
        ))}
      </div>
    </div>
  )
}
