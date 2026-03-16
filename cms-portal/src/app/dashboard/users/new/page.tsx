import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getDepartmentsList, getUserFormOptions } from '../actions'
import { NewUserPage } from '@/components/users/new-user-page'

export default async function Page() {
  const [user, departments, options] = await Promise.all([
    getSession(),
    getDepartmentsList().catch(() => []),
    getUserFormOptions().catch(() => ({ accounts: [], lookerReports: [], managers: [], teamMembers: [] })),
  ])

  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  return <NewUserPage departments={departments} currentUser={user} options={options} />
}
