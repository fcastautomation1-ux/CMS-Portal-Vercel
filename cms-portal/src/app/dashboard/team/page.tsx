import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getTeamMembers } from './actions'
import { TeamPage } from '@/components/team/team-page'

export default async function Page() {
  const [user, members] = await Promise.all([
    getSession(),
    getTeamMembers().catch(() => []),
  ])
  if (!user) redirect('/login')

  return <TeamPage members={members} user={user} />
}
