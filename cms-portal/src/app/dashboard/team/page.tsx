import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getTeamMembers, getTeamTodos } from './actions'
import { TeamPage } from '@/components/team/team-page'

export default async function Page() {
  const [user, members, tasks] = await Promise.all([
    getSession(),
    getTeamMembers().catch(() => []),
    getTeamTodos().catch(() => []),
  ])
  if (!user) redirect('/login')

  return (
    <Suspense>
      <TeamPage members={members} tasks={tasks} user={user} />
    </Suspense>
  )
}
