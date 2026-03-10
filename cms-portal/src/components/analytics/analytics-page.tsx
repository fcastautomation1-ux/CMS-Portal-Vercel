'use client'

import { BarChart3, CheckCircle, Clock, AlertTriangle, TrendingUp, Users, CalendarCheck } from 'lucide-react'
import type { SessionUser } from '@/types'
import type { AnalyticsData } from '@/app/dashboard/analytics/actions'

interface Props { analytics: AnalyticsData; user: SessionUser }

const STATUS_COLORS: Record<string, string> = {
  backlog: '#94A3B8', todo: '#3B82F6', in_progress: '#F59E0B', done: '#22C55E',
}
const PRIORITY_COLORS: Record<string, string> = {
  low: '#94A3B8', medium: '#3B82F6', high: '#F59E0B', urgent: '#EF4444',
}

export function AnalyticsPage({ analytics, user }: Props) {
  const { totalTasks, assignedToMe, completed, inProgress, pending, overdue, dueToday, statusBreakdown, priorityBreakdown, departmentBreakdown, topUsers } = analytics

  const kpis = [
    { label: 'Total Tasks', value: totalTasks, icon: <BarChart3 size={20} />, color: '#3B82F6', bg: 'rgba(59,130,246,0.08)' },
    { label: 'Assigned to Me', value: assignedToMe, icon: <Users size={20} />, color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)' },
    { label: 'Completed', value: completed, icon: <CheckCircle size={20} />, color: '#22C55E', bg: 'rgba(34,197,94,0.08)' },
    { label: 'In Progress', value: inProgress, icon: <TrendingUp size={20} />, color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
    { label: 'Pending', value: pending, icon: <Clock size={20} />, color: '#64748B', bg: 'rgba(100,116,139,0.08)' },
    { label: 'Overdue', value: overdue, icon: <AlertTriangle size={20} />, color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
    { label: 'Due Today', value: dueToday, icon: <CalendarCheck size={20} />, color: '#0EA5E9', bg: 'rgba(14,165,233,0.08)' },
  ]

  const maxDeptValue = Math.max(...Object.values(departmentBreakdown), 1)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Analytics</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>Task performance overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {kpis.map(k => (
          <div key={k.label} className="card p-4 text-center">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2" style={{ background: k.bg, color: k.color }}>{k.icon}</div>
            <p className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>{k.value}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--slate-500)' }}>{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Status Breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>By Status</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(statusBreakdown).map(([status, count]) => {
              const pct = totalTasks > 0 ? (count / totalTasks) * 100 : 0
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize" style={{ color: 'var(--slate-600)' }}>{status.replace('_', ' ')}</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--slate-900)' }}>{count}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--slate-100)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: STATUS_COLORS[status] || '#94A3B8' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>By Priority</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(priorityBreakdown).map(([priority, count]) => {
              const pct = totalTasks > 0 ? (count / totalTasks) * 100 : 0
              return (
                <div key={priority}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize" style={{ color: 'var(--slate-600)' }}>{priority}</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--slate-900)' }}>{count}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--slate-100)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: PRIORITY_COLORS[priority] || '#94A3B8' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Department Breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>By Department</h2>
          {Object.keys(departmentBreakdown).length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--slate-400)' }}>No department data</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {Object.entries(departmentBreakdown).sort(([, a], [, b]) => b - a).map(([dept, count]) => (
                <div key={dept} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-24 truncate" style={{ color: 'var(--slate-600)' }}>{dept || 'Unassigned'}</span>
                  <div className="flex-1 h-6 rounded-lg overflow-hidden relative" style={{ background: 'var(--slate-50)' }}>
                    <div className="h-full rounded-lg flex items-center justify-end pr-2" style={{ width: `${Math.max((count / maxDeptValue) * 100, 8)}%`, background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                      <span className="text-[10px] font-bold text-white">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Users */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>Top Performers</h2>
          {topUsers.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--slate-400)' }}>No user data</p>
          ) : (
            <div className="flex flex-col gap-2">
              {topUsers.map((u, i) => {
                const pct = u.total > 0 ? Math.round((u.completed / u.total) * 100) : 0
                return (
                  <div key={u.username} className="flex items-center gap-3 p-2 rounded-lg hover:bg-blue-50/30 transition-colors">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: i < 3 ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'var(--slate-100)', color: i < 3 ? '#FFF' : 'var(--slate-500)' }}>{i + 1}</span>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>{u.username.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block" style={{ color: 'var(--slate-900)' }}>{u.username}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold" style={{ color: 'var(--slate-900)' }}>{u.completed}/{u.total}</span>
                      <span className="text-[10px] ml-1" style={{ color: pct >= 80 ? '#22C55E' : pct >= 50 ? '#F59E0B' : '#94A3B8' }}>({pct}%)</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
