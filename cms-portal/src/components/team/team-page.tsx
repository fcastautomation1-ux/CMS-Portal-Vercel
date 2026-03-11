'use client'

import { useState, useMemo } from 'react'
import { Search, Users2, Building2 } from 'lucide-react'
import type { SessionUser } from '@/types'
import type { TeamMember } from '@/app/dashboard/team/actions'

interface Props { members: TeamMember[]; user: SessionUser }

const ROLE_GRADIENTS: Record<string, string> = {
  Admin:         'linear-gradient(135deg, #8B5CF6, #7C3AED)',
  'Super Manager': 'linear-gradient(135deg, #2B7FFF, #1A6AE4)',
  Manager:       'linear-gradient(135deg, #14B8A6, #0D9488)',
  Supervisor:    'linear-gradient(135deg, #F59E0B, #D97706)',
  User:          'linear-gradient(135deg, #64748B, #475569)',
}

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  Admin:           { bg: 'rgba(139,92,246,0.12)', color: '#7C3AED' },
  'Super Manager': { bg: 'rgba(43,127,255,0.12)', color: '#1A6AE4' },
  Manager:         { bg: 'rgba(20,184,166,0.12)', color: '#0D9488' },
  Supervisor:      { bg: 'rgba(245,158,11,0.12)', color: '#D97706' },
  User:            { bg: 'rgba(100,116,139,0.12)', color: '#475569' },
}

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase()
}

export function TeamPage({ members }: Props) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  const departments = useMemo(() => [...new Set(members.map(m => m.department).filter(Boolean) as string[])].sort(), [members])
  const roles = useMemo(() => [...new Set(members.map(m => m.role))].sort(), [members])

  const filtered = useMemo(() => {
    let list = members
    if (deptFilter) list = list.filter(m => m.department === deptFilter)
    if (roleFilter) list = list.filter(m => m.role === roleFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m => m.username.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    }
    return list
  }, [members, search, deptFilter, roleFilter])

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Team</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {filtered.length} of {members.length} members
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-45">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="h-10 px-3 rounded-lg text-sm outline-none flex-1 min-w-35"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="h-10 px-3 rounded-lg text-sm outline-none flex-1 min-w-32"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            <option value="">All Roles</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Users2 size={40} className="mx-auto mb-3" style={{ color: 'var(--slate-300)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No team members found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(m => {
            const gradient = ROLE_GRADIENTS[m.role] ?? ROLE_GRADIENTS.User
            const roleBadge = ROLE_COLORS[m.role] ?? ROLE_COLORS.User
            const completion = m.taskStats.total > 0
              ? Math.round((m.taskStats.completed / m.taskStats.total) * 100)
              : 0
            const completionColor = completion >= 80 ? '#10B981' : completion >= 50 ? '#F59E0B' : '#EF4444'

            return (
              <div
                key={m.username}
                className="relative overflow-hidden rounded-[28px] p-4 group transition-all duration-300 animate-fade-in"
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
                }}
              >
                <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full opacity-15" style={{ background: gradient }} />
                <div className="absolute top-0 left-0 right-0 h-24" style={{ background: gradient }} />

                <div className="relative flex items-start justify-between gap-3 mb-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-14 h-14 rounded-2xl overflow-hidden shadow-lg ring-4 ring-white shrink-0"
                      style={{ background: gradient }}
                    >
                      {m.avatar_data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar_data} alt={m.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-base font-bold text-white">
                          {getInitials(m.username)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 pt-1">
                      <h3 className="text-sm font-bold truncate" style={{ color: 'white' }}>
                        {m.username}
                      </h3>
                      <p className="text-[11px] truncate max-w-40" style={{ color: 'rgba(255,255,255,0.85)' }}>
                        {m.email}
                      </p>
                    </div>
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.22)', color: 'white', backdropFilter: 'blur(4px)' }}
                  >
                    {m.role}
                  </span>
                </div>

                <div className="relative rounded-[22px] p-4 mt-3" style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(226,232,240,0.9)' }}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Building2 size={12} style={{ color: roleBadge.color }} />
                      <span className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {m.department || 'No department'}
                      </span>
                    </div>
                    <span
                      className="text-[10px] font-semibold px-2 py-1 rounded-full"
                      style={{ background: roleBadge.bg, color: roleBadge.color }}
                    >
                      {completion}% complete
                    </span>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Task health</span>
                      <span className="text-[11px] font-bold" style={{ color: completionColor }}>
                        {m.taskStats.completed}/{m.taskStats.total || 0}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--slate-100)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${completion}%`, background: completionColor }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <StatPill label="Done" value={m.taskStats.completed} color="#10B981" bg="rgba(16,185,129,0.1)" />
                    <StatPill label="Open" value={m.taskStats.pending} color="#2B7FFF" bg="rgba(43,127,255,0.1)" />
                    <StatPill label="Late" value={m.taskStats.overdue} color="#EF4444" bg="rgba(239,68,68,0.1)" />
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span>{m.last_login ? `Last seen ${new Date(m.last_login).toLocaleDateString()}` : 'No recent activity'}</span>
                    <span style={{ color: completionColor }}>{completion >= 80 ? 'Excellent' : completion >= 50 ? 'On track' : 'Needs attention'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatPill({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-lg py-1.5 px-1 text-center" style={{ background: bg }}>
      <p className="text-sm font-bold" style={{ color }}>{value}</p>
      <p className="text-[9px] font-semibold mt-0.5" style={{ color }}>{label}</p>
    </div>
  )
}

