'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Users2, Building2, ListTodo, CircleCheckBig, Hourglass, AlertTriangle, RefreshCw } from 'lucide-react'
import type { SessionUser } from '@/types'
import type { Todo } from '@/types'
import type { TeamMember } from '@/app/dashboard/team/actions'
import { cn } from '@/lib/cn'
import { TaskCard } from '@/components/tasks/task-card'

interface Props {
  members: TeamMember[]
  tasks: Todo[]
  user?: SessionUser
}

const ROLE_GRADIENTS: Record<string, string> = {
  Admin: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
  'Super Manager': 'linear-gradient(135deg, #2B7FFF, #1A6AE4)',
  Manager: 'linear-gradient(135deg, #14B8A6, #0D9488)',
  Supervisor: 'linear-gradient(135deg, #F59E0B, #D97706)',
  User: 'linear-gradient(135deg, #64748B, #475569)',
}

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  Admin: { bg: 'rgba(139,92,246,0.12)', color: '#7C3AED' },
  'Super Manager': { bg: 'rgba(43,127,255,0.12)', color: '#1A6AE4' },
  Manager: { bg: 'rgba(20,184,166,0.12)', color: '#0D9488' },
  Supervisor: { bg: 'rgba(245,158,11,0.12)', color: '#D97706' },
  User: { bg: 'rgba(100,116,139,0.12)', color: '#475569' },
}

type TeamScope = 'users' | 'tasks_all' | 'tasks_completed' | 'tasks_pending' | 'tasks_overdue'

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase()
}

export function TeamPage({ members, tasks, user }: Props) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
  const [, startTransition] = useTransition()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scope = (searchParams.get('scope') as TeamScope | null) ?? 'users'
  const isTaskScope = scope !== 'users'

  const departments = useMemo(
    () => [...new Set(members.map((member) => member.department).filter(Boolean) as string[])].sort(),
    [members]
  )
  const memberOptions = useMemo(() => [...new Set(members.map((member) => member.username))].sort(), [members])

  const counts = useMemo(
    () => ({
      users: members.length,
      tasks_all: members.reduce((sum, member) => sum + member.taskStats.total, 0),
      tasks_completed: members.reduce((sum, member) => sum + member.taskStats.completed, 0),
      tasks_pending: members.reduce((sum, member) => sum + member.taskStats.pending, 0),
      tasks_overdue: members.reduce((sum, member) => sum + member.taskStats.overdue, 0),
    }),
    [members]
  )

  const filtered = useMemo(() => {
    let list = members

    if (deptFilter) list = list.filter((member) => member.department === deptFilter)
    if (memberFilter) list = list.filter((member) => member.username === memberFilter)

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (member) =>
          member.username.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q)
      )
    }

    if (scope === 'tasks_all') return list.filter((member) => member.taskStats.total > 0)
    if (scope === 'tasks_completed') return list.filter((member) => member.taskStats.completed > 0)
    if (scope === 'tasks_pending') return list.filter((member) => member.taskStats.pending > 0)
    if (scope === 'tasks_overdue') return list.filter((member) => member.taskStats.overdue > 0)

    return list
  }, [members, search, deptFilter, memberFilter, scope])

  const filteredTasks = useMemo(() => {
    let list = tasks
    const searchQuery = search.trim().toLowerCase()
    const today = new Date()

    if (deptFilter) {
      list = list.filter((task) => (task.creator_department || task.category || '').toLowerCase() === deptFilter.toLowerCase())
    }

    if (memberFilter) {
      const memberLower = memberFilter.toLowerCase()
      list = list.filter((task) => {
        if ((task.username || '').toLowerCase() === memberLower) return true
        if ((task.assigned_to || '').toLowerCase() === memberLower) return true
        const assignees = task.multi_assignment?.assignees ?? []
        return assignees.some((entry) => {
          if ((entry.username || '').toLowerCase() === memberLower) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === memberLower)
        })
      })
    }

    if (searchQuery) {
      list = list.filter((task) =>
        task.title.toLowerCase().includes(searchQuery) ||
        (task.username || '').toLowerCase().includes(searchQuery) ||
        (task.assigned_to || '').toLowerCase().includes(searchQuery) ||
        (task.app_name || '').toLowerCase().includes(searchQuery) ||
        (task.package_name || '').toLowerCase().includes(searchQuery)
      )
    }

    if (scope === 'tasks_completed') {
      list = list.filter((task) => task.completed || task.task_status === 'done')
    } else if (scope === 'tasks_pending') {
      list = list.filter((task) => {
        if (task.completed || task.task_status === 'done') return false
        if (task.due_date && new Date(task.due_date) < today) return false
        return true
      })
    } else if (scope === 'tasks_overdue') {
      list = list.filter((task) => !task.completed && !!task.due_date && new Date(task.due_date) < today)
    }

    return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [tasks, search, deptFilter, memberFilter, scope])

  const taskKpis = useMemo(() => {
    const today = new Date()
    return {
      total: tasks.length,
      completed: tasks.filter((task) => task.completed || task.task_status === 'done').length,
      pending: tasks.filter((task) => {
        if (task.completed || task.task_status === 'done') return false
        if (task.due_date && new Date(task.due_date) < today) return false
        return true
      }).length,
      overdue: tasks.filter((task) => !task.completed && !!task.due_date && new Date(task.due_date) < today).length,
    }
  }, [tasks])

  const scopeLabel = useMemo(() => {
    if (scope === 'tasks_all') return 'Task'
    if (scope === 'tasks_completed') return 'Completed Task'
    if (scope === 'tasks_pending') return 'Pending Task'
    if (scope === 'tasks_overdue') return 'Overdue Task'
    return 'User'
  }, [scope])

  return (
    <div>
      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>Team</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {isTaskScope ? `${scopeLabel}: ${filteredTasks.length} tasks` : `${scopeLabel}: ${filtered.length} of ${counts.users} members`}
            </p>
          </div>
        </div>

        {isTaskScope && (
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { key: 'tasks_all', label: 'Total Task', value: taskKpis.total, icon: ListTodo, tone: 'text-[#2B7FFF]', bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]' },
              { key: 'tasks_completed', label: 'Completed Task', value: taskKpis.completed, icon: CircleCheckBig, tone: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]' },
              { key: 'tasks_pending', label: 'Pending', value: taskKpis.pending, icon: Hourglass, tone: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', border: 'border-[#FDE68A]' },
              { key: 'tasks_overdue', label: 'Overdue', value: taskKpis.overdue, icon: AlertTriangle, tone: 'text-[#E11D48]', bg: 'bg-[#FFF1F2]', border: 'border-[#FECDD3]' },
            ].map((item) => {
              const Icon = item.icon
              const isActive = scope === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => router.replace(`/dashboard/team?scope=${item.key}`, { scroll: false })}
                  className={cn(
                    'rounded-[18px] border bg-white px-4 py-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.09)]',
                    isActive && 'border-[#3559d8] bg-[#f8fbff] shadow-[inset_0_0_0_1px_rgba(53,89,216,0.24),0_12px_24px_rgba(15,23,42,0.08)]'
                  )}
                  style={{ borderColor: isActive ? '#3559d8' : 'var(--color-border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border', item.bg, item.border)}>
                      <Icon size={18} className={item.tone} />
                    </div>
                    <div className="text-right">
                      <div className={cn('text-[28px] font-extrabold leading-none', item.tone)}>{item.value}</div>
                      <div className="mt-1 text-[11px] font-semibold text-slate-500">{item.label}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="card mb-6 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-45 flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                placeholder="Search members..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
                style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              />
            </div>
            <select
              value={deptFilter}
              onChange={(event) => setDeptFilter(event.target.value)}
              className="h-10 min-w-35 flex-1 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">All Departments</option>
              {departments.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </select>
            <select
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
              className="h-10 min-w-32 flex-1 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">All Team Members</option>
              {memberOptions.map((member) => (
                <option key={member} value={member}>{member}</option>
              ))}
            </select>
          </div>
        </div>

        {isTaskScope ? (
          filteredTasks.length === 0 ? (
            <div className="card p-12 text-center">
              <ListTodo size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No team tasks found</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[22px] border border-[#d9e2f0] bg-white shadow-[0_18px_50px_rgba(31,65,132,0.08)]">
              <div className="bg-[#f5f7fc] px-4 py-4 sm:px-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                    <button
                      type="button"
                      onClick={() => startTransition(() => router.refresh())}
                      className="inline-flex items-center gap-1 rounded-xl border border-[#d9e2f0] bg-white px-3 py-2 font-semibold text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition hover:border-[#c4d3ef] hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                    >
                      <RefreshCw size={13} />
                      Refresh
                    </button>
                    <span className="min-w-fit text-[11px] font-medium text-slate-400">{filteredTasks.length} tasks</span>
                  </div>

                  {filteredTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      currentUsername={user?.username ?? ''}
                      currentUserDept={user?.department ?? null}
                      onEdit={(nextTask) => router.push(`/dashboard/tasks/${nextTask.id}`)}
                      onViewDetail={(nextTask) => router.push(`/dashboard/tasks/${nextTask.id}`)}
                      onShare={() => undefined}
                      onDecline={(nextTask) => router.push(`/dashboard/tasks/${nextTask.id}`)}
                      onRefresh={() => router.refresh()}
                    />
                  ))}
                </div>
              </div>
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <Users2 size={40} className="mx-auto mb-3" style={{ color: 'var(--slate-300)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No team members found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((member) => {
              const gradient = ROLE_GRADIENTS[member.role] ?? ROLE_GRADIENTS.User
              const roleBadge = ROLE_COLORS[member.role] ?? ROLE_COLORS.User
              const completion = member.taskStats.total > 0
                ? Math.round((member.taskStats.completed / member.taskStats.total) * 100)
                : 0
              const completionColor = completion >= 80 ? '#10B981' : completion >= 50 ? '#F59E0B' : '#EF4444'

              return (
                <div
                  key={member.username}
                  className="animate-fade-in rounded-2xl p-6 text-center transition-all duration-300"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 8px 20px rgba(15,23,42,0.06)',
                  }}
                >
                  <div
                    className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
                    style={{ background: gradient }}
                  >
                    {member.avatar_data ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={member.avatar_data} alt={member.username} className="h-full w-full rounded-full object-cover" />
                    ) : (
                      getInitials(member.username)
                    )}
                  </div>

                  <h3 className="mb-0.5 truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                    {member.username}
                  </h3>
                  <p className="mb-2 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {member.email}
                  </p>

                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-center gap-1">
                      <Building2 size={11} style={{ color: roleBadge.color }} />
                      <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                        {member.department || 'No dept'}
                      </span>
                    </div>
                    <span
                      className="inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold"
                      style={{ background: roleBadge.bg, color: roleBadge.color }}
                    >
                      {member.role}
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        Task completion
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: completionColor }}>
                        {completion}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--slate-100)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${completion}%`, background: completionColor }}
                      />
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-3 gap-2">
                    <StatPill label="Done" value={member.taskStats.completed} color="#10B981" bg="rgba(16,185,129,0.1)" />
                    <StatPill label="Open" value={member.taskStats.pending} color="#2B7FFF" bg="rgba(43,127,255,0.1)" />
                    <StatPill label="Overdue" value={member.taskStats.overdue} color="#EF4444" bg="rgba(239,68,68,0.1)" />
                  </div>

                  <div className="flex items-center justify-center gap-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span>
                      {member.last_login
                        ? `Last seen ${new Date(member.last_login).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`
                        : 'No activity yet'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatPill({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-lg px-1.5 py-2 text-center" style={{ background: bg }}>
      <p className="text-xs font-bold" style={{ color }}>{value}</p>
      <p className="mt-1 text-[8px] font-semibold" style={{ color }}>{label}</p>
    </div>
  )
}
