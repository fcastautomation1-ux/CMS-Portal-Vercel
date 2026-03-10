import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDriveConfig, getUserDriveAccess } from './actions'
import { DrivePage } from '@/components/drive/drive-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')

  const [config, access] = await Promise.all([
    getDriveConfig(),
    getUserDriveAccess().catch(() => []),
  ])

  return <DrivePage config={config} driveAccess={access} user={user} />
}
