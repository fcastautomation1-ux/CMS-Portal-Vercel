'use client'

import { useMemo, useState } from 'react'
import { Search, Users2, Building2, ChevronDown, UsersRound, CheckSquare, List, CircleCheck, Circle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SessionUser } from '@/types'
import type { TeamMember } from '@/app/dashboard/team/actions'

interface Props {
  members: TeamMember[]
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

export function TeamPage({ members }: Props) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [teamOpen, setTeamOpen] = useState(true)
  const [taskOpen, setTaskOpen] = useState(true)
  const [scope, setScope] = useState<TeamScope>('users')

  const departments = useMemo(
    () => [...new Set(members.map((member) => member.department).filter(Boolean) as string[])].sort(),
    [members]
  )
  const roles = useMemo(() => [...new Set(members.map((member) => member.role))].sort(), [members])

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
    if (roleFilter) list = list.filter((member) => member.role === roleFilter)

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
  }, [members, search, deptFilter, roleFilter, scope])

  const scopeLabel = useMemo(() => {
    if (scope === 'tasks_all') return 'Task'
    if (scope === 'tasks_completed') return 'Completed Task'
    if (scope === 'tasks_pending') return 'Pending Task'
    if (scope === 'tasks_overdue') return 'Overdue Task'
    return 'User'
  }, [scope])

  const navTaskLinks = [
    { id: 'tasks_all' as const, label: 'All task', icon: <List size={14} />, count: counts.tasks_all, badge: 'bg-blue-500/15 text-blue-700' },
    { id: 'tasks_completed' as const, label: 'Completed', icon: <CircleCheck size={14} />, count: counts.tasks_completed, badge: 'bg-green-600/15 text-green-700' },
    { id: 'tasks_pending' as const, label: 'Pending', icon: <Circle size={14} />, count: counts.tasks_pending, badge: 'bg-amber-500/15 text-amber-700' },
    { id: 'tasks_overdue' as const, label: 'Overdue', icon: <AlertCircle size={14} />, count: counts.tasks_overdue, badge: 'bg-rose-500/15 text-rose-700' },
  ]

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-[var(--color-border)] bg-white p-2 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
        <button
          type="button"
          onClick={() => setTeamOpen((current) => !current)}
          className="flex w-full items-center justify-between rounded-xl bg-[#1f1f1f] px-3 py-3 text-left text-sm font-semibold text-white"
        >
          <span className="flex items-center gap-2">
            <UsersRound size={16} />
            My Team
          </span>
          <ChevronDown size={14} className={cn('transition-transform', teamOpen && 'rotate-180')} />
        </button>

        {teamOpen && (
          <div className="mt-2 pl-3">
            <button
              type="button"
              onClick={() => setScope('users')}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition',
                scope === 'users' ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <span className="flex items-center gap-2">
                <Users2 size={14} />
                User
              </span>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{counts.users}</span>
            </button>

            <div className="mt-2 border-l border-slate-200 pl-2">
              <button
                type="button"
                onClick={() => setTaskOpen((current) => !current)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <span className="flex items-center gap-2">
                  <CheckSquare size={14} />
                  Task
                </span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{counts.tasks_all}</span>
                  <ChevronDown size={14} className={cn('transition-transform', taskOpen && 'rotate-180')} />
                </div>
              </button>

              {taskOpen && (
                <ul className="mt-1 space-y-1 border-l border-slate-200 pl-3">
                  {navTaskLinks.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setScope(item.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition',
                          scope === item.id ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          {item.icon}
                          {item.label}
                        </span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', item.badge)}>
                          {item.count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </aside>

      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>Team</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {scopeLabel}: {filtered.length} of {members.length} members
            </p>
          </div>
        </div>

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
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="h-10 min-w-32 flex-1 rounded-lg px-3 text-sm outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <option value="">All Roles</option>
              {roles.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
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
