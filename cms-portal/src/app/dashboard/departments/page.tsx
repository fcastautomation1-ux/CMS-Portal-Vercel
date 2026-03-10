import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getDepartments, getDepartmentMembers } from './actions'
import { DepartmentsPage } from '@/components/departments/departments-page'

export default async function Page() {
  const user = await getSession()
  if (!user) redirect('/login')
  // Departments: Admin, Super Manager, Manager only
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) redirect('/dashboard/tasks')

  const [departments, memberCounts] = await Promise.all([
    getDepartments().catch(() => []),
    getDepartmentMembers().catch(() => ({})),
  ])

  return <DepartmentsPage departments={departments} memberCounts={memberCounts} user={user} />
}
