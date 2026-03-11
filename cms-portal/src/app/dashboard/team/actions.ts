'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

export interface TeamMember {
  username: string
  role: string
  department: string | null
  email: string
  last_login: string | null
  avatar_data: string | null
  taskStats: { total: number; completed: number; pending: number; overdue: number }
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const user = await getSession()
  if (!user) return []

  const supabase = createServerClient()

  // Admin / Super Manager see all users
  let memberUsernames: string[] = []
  if (user.role === 'Admin' || user.role === 'Super Manager') {
    const { data } = await supabase.from('users').select('username')
    memberUsernames = (data ?? []).map(u => (u as { username: string }).username)
  } else {
    // Union of: users where manager_id = current user + current user's team_members
    const set = new Set<string>()
    const { data: managed } = await supabase.from('users').select('username').eq('manager_id', user.username)
    if (managed) managed.forEach(u => set.add((u as { username: string }).username))
    if (user.teamMembers) user.teamMembers.forEach(m => { if (m) set.add(m) })
    memberUsernames = Array.from(set)
  }

  if (memberUsernames.length === 0) return []

  // Get user details
  const { data: usersData } = await supabase
    .from('users')
    .select('username, role, department, email, last_login, avatar_data')
    .in('username', memberUsernames)

  if (!usersData) return []

  // Get task stats for each member
  const { data: todos } = await supabase
    .from('todos')
    .select('username, assigned_to, completed, task_status, due_date, archived')
    .eq('archived', false)

  const now = new Date().toISOString().split('T')[0]

  return (usersData as unknown as Array<{ username: string; role: string; department: string | null; email: string; last_login: string | null; avatar_data: string | null }>).map(u => {
    const myTasks = (todos ?? []).filter((t: Record<string, unknown>) => t.username === u.username || t.assigned_to === u.username)
    const completed = myTasks.filter((t: Record<string, unknown>) => t.completed).length
    const pending = myTasks.filter((t: Record<string, unknown>) => !t.completed).length
    const overdue = myTasks.filter((t: Record<string, unknown>) => !t.completed && t.due_date && (t.due_date as string) < now).length

    return {
      ...u,
      taskStats: { total: myTasks.length, completed, pending, overdue },
    }
  })
}
