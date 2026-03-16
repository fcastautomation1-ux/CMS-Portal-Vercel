import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProfileData } from './actions'
import { getDepartments } from '../departments/actions'
import { ProfilePage } from '@/components/profile/profile-page'
import { getPortalBranding } from '@/lib/portal-branding'

export default async function Page() {
  const [user, profile, departments, branding] = await Promise.all([
    getSession(),
    getProfileData(),
    getDepartments().catch(() => []),
    getPortalBranding(),
  ])

  if (!user) redirect('/login')
  if (!profile) redirect('/login')

  return <ProfilePage user={user!} profile={profile} departments={departments} branding={branding} />
}
