import { RouteLoadingScreen } from '@/components/layout/route-loading-screen'

export default function Loading() {
  return (
    <RouteLoadingScreen
      title="Opening integrations"
      description="Loading system settings and integration configuration."
      rows={4}
      cols={2}
    />
  )
}
