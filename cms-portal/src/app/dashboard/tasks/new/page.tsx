import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { canUserCreateTasksAction } from '../actions'
import NewTaskClient from './client'

export default async function NewTaskPage() {
  const user = await getSession()
  if (!user) redirect('/login')

  const allowed = await canUserCreateTasksAction()
  if (!allowed) redirect('/dashboard/tasks')

  return <NewTaskClient />
}
