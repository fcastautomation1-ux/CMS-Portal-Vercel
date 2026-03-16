import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProfileData } from './actions'
import { ProfilePage } from '@/components/profile/profile-page'
import { getPortalBranding } from '@/lib/portal-branding'

export default async function Page() {
  const [user, profile, branding] = await Promise.all([
    getSession(),
    getProfileData(),
    getPortalBranding(),
  ])

  if (!user) redirect('/login')
  if (!profile) redirect('/login')

  return <ProfilePage user={user!} profile={profile} branding={branding} />
}
