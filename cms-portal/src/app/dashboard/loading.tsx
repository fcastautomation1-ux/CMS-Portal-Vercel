import { RouteLoadingScreen } from '@/components/layout/route-loading-screen'

export default function DashboardLoading() {
  return (
    <RouteLoadingScreen
      title="Loading portal data"
      description="Opening your dashboard and syncing the latest information."
      rows={5}
      cols={4}
    />
  )
}
