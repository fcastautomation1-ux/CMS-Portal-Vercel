import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDriveConfig, getUserDriveAccess } from './actions'
import { DrivePage } from '@/components/drive/drive-page'

export default async function Page() {
  const [user, config, access] = await Promise.all([
    getSession(),
    getDriveConfig(),
    getUserDriveAccess().catch(() => []),
  ])
  if (!user) redirect('/login')

  return <DrivePage config={config} driveAccess={access} user={user} />
}
