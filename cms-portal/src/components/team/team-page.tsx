'use client'

import { useState, useMemo } from 'react'
import { Search, Users2, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import type { SessionUser } from '@/types'
import type { TeamMember } from '@/app/dashboard/team/actions'

interface Props { members: TeamMember[]; user: SessionUser }

export function TeamPage({ members }: Props) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  const departments = useMemo(() => [...new Set(members.map(m => m.department).filter(Boolean) as string[])].sort(), [members])

  const filtered = useMemo(() => {
    let list = members
    if (deptFilter) list = list.filter(m => m.department === deptFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m => m.username.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    }
    return list
  }, [members, search, deptFilter])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Team</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{members.length} team members</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search team..." value={search} onChange={e => setSearch(e.target.value)} className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Team Cards */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Users2 size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No team members found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(m => (
            <div key={m.username} className="card p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                  {m.username.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--slate-900)' }}>{m.username}</h3>
                  <p className="text-xs truncate" style={{ color: 'var(--slate-500)' }}>{m.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(59,130,246,0.08)', color: '#2563EB' }}>{m.role}</span>
                    {m.department && <span className="text-xs" style={{ color: 'var(--slate-400)' }}>{m.department}</span>}
                  </div>
                </div>
              </div>

              {/* Task Stats */}
              <div className="grid grid-cols-4 gap-2">
                <StatBox label="Total" value={m.taskStats.total} icon={<Clock size={12} />} color="#64748B" bg="rgba(100,116,139,0.06)" />
                <StatBox label="Done" value={m.taskStats.completed} icon={<CheckCircle size={12} />} color="#22C55E" bg="rgba(34,197,94,0.06)" />
                <StatBox label="Pending" value={m.taskStats.pending} icon={<Clock size={12} />} color="#F59E0B" bg="rgba(245,158,11,0.06)" />
                <StatBox label="Overdue" value={m.taskStats.overdue} icon={<AlertTriangle size={12} />} color="#EF4444" bg="rgba(239,68,68,0.06)" />
              </div>

              {m.last_login && (
                <p className="text-xs mt-3 pt-3" style={{ color: 'var(--slate-400)', borderTop: '1px solid var(--slate-100)' }}>
                  Last login: {new Date(m.last_login).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, icon, color, bg }: { label: string; value: number; icon: React.ReactNode; color: string; bg: string }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: bg }}>
      <div className="flex items-center justify-center mb-1" style={{ color }}>{icon}</div>
      <p className="text-base font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] font-medium" style={{ color: 'var(--slate-400)' }}>{label}</p>
    </div>
  )
}
