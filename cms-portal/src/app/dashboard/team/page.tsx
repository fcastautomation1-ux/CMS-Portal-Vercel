import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getTeamMembers } from './actions'
import { TeamPage } from '@/components/team/team-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')

  const members = await getTeamMembers().catch(() => [])

  return <TeamPage members={members} user={user} />
}
