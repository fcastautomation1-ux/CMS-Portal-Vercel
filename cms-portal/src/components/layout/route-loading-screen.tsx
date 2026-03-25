import { PageSkeleton } from '@/components/layout/page-skeleton'

interface RouteLoadingScreenProps {
  title?: string
  description?: string
  rows?: number
  cols?: number
}

export function RouteLoadingScreen({
  title = 'Opening page',
  description = 'Loading the next screen and preparing fresh data.',
  rows = 6,
  cols = 4,
}: RouteLoadingScreenProps) {
  return (
    <div className="route-loading-screen">
      <div className="route-loading-bar" aria-hidden="true">
        <span className="route-loading-bar__fill" />
      </div>

      <div className="route-loading-hero">
        <div className="route-loading-hero__badge">
          <span className="route-loading-orb" aria-hidden="true" />
          <span>{title}</span>
        </div>
        <p className="route-loading-hero__copy">{description}</p>
      </div>

      <div className="route-loading-card">
        <PageSkeleton rows={rows} cols={cols} />
      </div>
    </div>
  )
}
