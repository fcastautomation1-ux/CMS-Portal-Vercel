import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getUsers, getDepartmentsList, getUserFormOptions } from './actions'
import { UsersPage } from '@/components/users/users-page'

export default async function Page() {
  const [user, users, departments, options] = await Promise.all([
    getSession(),
    getUsers().catch(() => []),
    getDepartmentsList().catch(() => []),
    getUserFormOptions().catch(() => ({ accounts: [], lookerReports: [], managers: [], teamMembers: [] })),
  ])
  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  return <UsersPage users={users} departments={departments} currentUser={user} options={options} />
}
