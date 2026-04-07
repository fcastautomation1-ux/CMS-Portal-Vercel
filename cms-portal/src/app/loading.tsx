import { DashboardHomeSkeleton } from '@/components/layout/shimmer-skeleton'

export default function Loading() {
  return (
    <div className="min-h-screen p-4 sm:p-6" style={{ background: 'var(--color-bg)' }}>
      <DashboardHomeSkeleton />
    </div>
  )
}
