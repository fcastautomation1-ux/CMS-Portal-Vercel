export default function DashboardLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div
        className="flex items-center gap-3 rounded-2xl border px-5 py-4 shadow-sm"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      >
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
        <span className="text-sm font-medium">Loading portal data...</span>
      </div>
    </div>
  )
}
