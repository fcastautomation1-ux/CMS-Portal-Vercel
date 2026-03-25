import { RouteLoadingScreen } from '@/components/layout/route-loading-screen'

export default function Loading() {
  return (
    <div className="min-h-screen p-4 sm:p-6" style={{ background: 'var(--color-bg)' }}>
      <RouteLoadingScreen
        title="Launching portal"
        description="Checking your workspace and getting everything ready."
        rows={5}
        cols={3}
      />
    </div>
  )
}
