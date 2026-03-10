import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDepartments, getDepartmentMembers } from './actions'
import { DepartmentsPage } from '@/components/departments/departments-page'

export default async function Page() {
  const [user, departments, memberCounts] = await Promise.all([
    getSession(),
    getDepartments().catch(() => []),
    getDepartmentMembers().catch(() => ({})),
  ])
  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  return <DepartmentsPage departments={departments} memberCounts={memberCounts} user={user} />
}
