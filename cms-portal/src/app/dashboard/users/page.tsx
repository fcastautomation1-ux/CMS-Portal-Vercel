import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getUsers, getDepartmentsList } from './actions'
import { UsersPage } from '@/components/users/users-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  // Users module: Admin, Super Manager, and enabled Managers only
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  const [users, departments] = await Promise.all([
    getUsers().catch(() => []),
    getDepartmentsList().catch(() => []),
  ])

  return <UsersPage users={users} departments={departments} currentUser={user} />
}
