import { getHallAssignPageData } from '../../actions'
import type { HallAssignPageData } from '../../actions'
import dynamic from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { PageSkeleton } from '@/components/layout/page-skeleton'

// DnD-kit requires a browser DOM — disable SSR for this heavy component.
const HallMultiAssignPage = dynamic<{ data: HallAssignPageData }>(
  () => import('@/components/tasks/hall-multi-assign-page').then((m) => ({ default: m.HallMultiAssignPage })),
  { ssr: false, loading: () => <PageSkeleton /> },
)

interface PageProps {
  params: Promise<{ taskId: string }>
}

export default async function HallMultiAssignTaskPage({ params }: PageProps) {
  const { taskId } = await params
  const user = await getSession()
  if (!user) redirect('/login')

  const data = await getHallAssignPageData(taskId)
  if (!data) notFound()

  return <HallMultiAssignPage data={data} />
}
