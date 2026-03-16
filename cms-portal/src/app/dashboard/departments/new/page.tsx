import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { NewDepartmentPage } from '@/components/departments/new-department-page'

export default async function Page() {
  const user = await getSession()

  if (!user) redirect('/login')
  if (!['Admin', 'Super Manager'].includes(user.role)) redirect('/dashboard/departments')

  return <NewDepartmentPage />
}
