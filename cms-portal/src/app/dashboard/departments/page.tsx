import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDepartments, getDepartmentMembersWithNames } from './actions'
import { DepartmentsPage } from '@/components/departments/departments-page'

export default async function Page() {
  const [user, departments, memberNames] = await Promise.all([
    getSession(),
    getDepartments().catch(() => []),
    getDepartmentMembersWithNames().catch(() => ({})),
  ])
  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  return <DepartmentsPage departments={departments} memberNames={memberNames} user={user} />
}
