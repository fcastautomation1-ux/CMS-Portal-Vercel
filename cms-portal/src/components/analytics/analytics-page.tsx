'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3, CheckCircle, Clock, AlertTriangle, TrendingUp,
  Users, CalendarCheck, X, Activity,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid, Legend,
  type PieLabelRenderProps,
} from 'recharts'
import type { SessionUser } from '@/types'
import type { AnalyticsData, AnalyticsTask } from '@/app/dashboard/analytics/actions'

interface Props { analytics: AnalyticsData; user: SessionUser }

const STATUS_COLORS: Record<string, string> = {
  backlog: '#94A3B8', todo: '#3B82F6', in_progress: '#F59E0B', done: '#22C55E',
}
const PRIORITY_COLORS: Record<string, string> = {
  low: '#94A3B8', medium: '#3B82F6', high: '#F59E0B', urgent: '#EF4444',
}
const PRIORITY_BG: Record<string, string> = {
  low: 'rgba(148,163,184,0.12)', medium: 'rgba(59,130,246,0.12)',
  high: 'rgba(245,158,11,0.12)', urgent: 'rgba(239,68,68,0.12)',
}

// ── Custom Tooltip ────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !payload) return null
  const p = payload as Array<{ color: string; name: string; value: number }>
  return (
    <div className="card p-2.5 text-sm shadow-lg">
      <p className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{label as string}</p>
      {p.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>{entry.name}: {entry.value}</p>
      ))}
    </div>
  )
}

// ── Filtered Task Table ───────────────────────────────────────────────────────

function TaskTable({ tasks, label, onClose }: { tasks: AnalyticsTask[]; label: string; onClose: () => void }) {
  return (
    <div
      className="rounded-2xl overflow-hidden animate-fade-in"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
    >
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <BarChart3 size={15} style={{ color: 'var(--blue-600)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</span>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--blue-50)', color: 'var(--blue-700)' }}
          >
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Close filter"
        >
          <X size={14} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No tasks found for this filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--slate-50)' }}>
                {['Title', 'Assigned To', 'Status', 'Priority', 'Due Date'].map(h => (
                  <th key={h} className="py-2.5 px-4 text-left font-semibold" style={{ color: 'var(--slate-500)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const isOverdue = !t.completed && t.due_date != null && t.due_date < new Date().toISOString().split('T')[0]
                return (
                  <tr
                    key={t.id}
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--slate-50)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                  >
                    <td className="py-2.5 px-4 max-w-[200px]">
                      <span className="truncate block font-medium" style={{ color: 'var(--color-text)' }}>{t.title || '(no title)'}</span>
                      <span className="text-[10px]" style={{ color: 'var(--slate-400)' }}>{t.username}</span>
                    </td>
                    <td className="py-2.5 px-4" style={{ color: 'var(--slate-600)' }}>{t.assigned_to ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded-full font-medium capitalize" style={{ background: `${STATUS_COLORS[t.task_status] || '#94A3B8'}20`, color: STATUS_COLORS[t.task_status] || '#94A3B8' }}>
                        {t.task_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded-full font-medium capitalize" style={{ background: PRIORITY_BG[t.priority] || 'rgba(148,163,184,0.12)', color: PRIORITY_COLORS[t.priority] || '#94A3B8' }}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-medium" style={{ color: isOverdue ? '#EF4444' : 'var(--slate-500)' }}>
                      {t.due_date ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AnalyticsPage({ analytics, user }: Props) {
  const router = useRouter()
  const {
    totalTasks, assignedToMe, completed, inProgress, pending,
    overdue, dueToday, statusBreakdown, priorityBreakdown, departmentBreakdown, topUsers, allTasks,
  } = analytics

  const [activeKpi, setActiveKpi] = useState<string | null>(null)

  const kpis = [
    { label: 'Total Tasks',    value: totalTasks,   icon: <BarChart3 size={20} />,    color: '#3B82F6', bg: 'rgba(59,130,246,0.08)' },
    { label: 'Assigned to Me', value: assignedToMe, icon: <Users size={20} />,        color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)' },
    { label: 'Completed',      value: completed,    icon: <CheckCircle size={20} />,  color: '#22C55E', bg: 'rgba(34,197,94,0.08)' },
    { label: 'In Progress',    value: inProgress,   icon: <TrendingUp size={20} />,   color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
    { label: 'Pending',        value: pending,      icon: <Clock size={20} />,        color: '#64748B', bg: 'rgba(100,116,139,0.08)' },
    { label: 'Overdue',        value: overdue,      icon: <AlertTriangle size={20} />, color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
    { label: 'Due Today',      value: dueToday,     icon: <CalendarCheck size={20} />, color: '#0EA5E9', bg: 'rgba(14,165,233,0.08)' },
  ]

  const today = new Date().toISOString().split('T')[0]

  const filteredTasks = useMemo((): AnalyticsTask[] => {
    if (!activeKpi || !allTasks) return []
    switch (activeKpi) {
      case 'Total Tasks':    return allTasks
      case 'Assigned to Me': return allTasks.filter(t => t.assigned_to === user.username || t.username === user.username)
      case 'Completed':      return allTasks.filter(t => t.completed)
      case 'In Progress':    return allTasks.filter(t => !t.completed && t.task_status === 'in_progress')
      case 'Pending':        return allTasks.filter(t => !t.completed && t.task_status !== 'in_progress' && t.task_status !== 'done')
      case 'Overdue':        return allTasks.filter(t => !t.completed && t.due_date != null && t.due_date < today)
      case 'Due Today':      return allTasks.filter(t => !t.completed && t.due_date === today)
      default:               return []
    }
  }, [activeKpi, allTasks, user.username, today])

  // Prepare chart data
  const statusData = Object.entries(statusBreakdown).map(([label, value]) => ({
    label: label.replace('_', ' '),
    value,
    color: STATUS_COLORS[label] || '#94A3B8',
  }))

  const priorityData = Object.entries(priorityBreakdown).map(([label, value]) => ({
    label,
    value,
    color: PRIORITY_COLORS[label] || '#94A3B8',
  }))

  const departmentData = Object.entries(departmentBreakdown)
    .map(([label, value]) => ({ label: label || 'Unassigned', value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  const maxDeptValue = Math.max(...Object.values(departmentBreakdown), 1)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Analytics</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Task performance overview — click any card to drill down
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: 'var(--slate-100)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
        >
          <Activity size={14} />
          Refresh
        </button>
      </div>

      {/* KPI Cards — clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {kpis.map(k => {
          const isActive = activeKpi === k.label
          return (
            <button
              key={k.label}
              type="button"
              onClick={() => setActiveKpi(isActive ? null : k.label)}
              className="card p-4 text-center relative transition-all duration-200 hover:scale-[1.03] focus:outline-none"
              style={{
                boxShadow: isActive ? `0 0 0 2px ${k.color}, 0 4px 16px ${k.color}30` : undefined,
                transform: isActive ? 'scale(1.03)' : undefined,
              }}
            >
              {isActive && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: k.color }} />
              )}
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2" style={{ background: k.bg, color: k.color }}>
                {k.icon}
              </div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{activeKpi === k.label ? filteredTasks.length : k.value}</p>
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{k.label}</p>
            </button>
          )
        })}
      </div>

      {/* Active Filter Banner */}
      {activeKpi && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-200)' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--blue-700)' }}>Active Filter</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{activeKpi}</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveKpi(null)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'white', color: 'var(--blue-700)', border: '1px solid var(--blue-200)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Filtered Task Table */}
      {activeKpi && (
        <div className="mb-6">
          <TaskTable
            tasks={filteredTasks}
            label={`${activeKpi} — filtered tasks (${filteredTasks.length})`}
            onClose={() => setActiveKpi(null)}
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Status Donut */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} style={{ color: 'var(--blue-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Task Status</h3>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>click to filter</span>
          </div>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  labelLine={false}
                  cursor="pointer"
                  onClick={(entry: any) => {
                    const label = entry.payload?.label
                    if (!label) return
                    const statusKey = Object.keys(statusBreakdown).find(k => k.replace('_', ' ') === label)
                    if (statusKey === 'done') setActiveKpi('Completed')
                    else if (statusKey === 'in_progress') setActiveKpi('In Progress')
                    else if (statusKey === 'todo' || statusKey === 'backlog') setActiveKpi('Pending')
                  }}
                >
                  {statusData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-50 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
              No data
            </div>
          )}
        </div>

        {/* Priority Donut */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} style={{ color: 'var(--orange-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>By Priority</h3>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>click to filter</span>
          </div>
          {priorityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  labelLine={false}
                  cursor="pointer"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-50 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
              No data
            </div>
          )}
        </div>

        {/* Department Bar */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} style={{ color: 'var(--emerald-500)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>By Department</h3>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>top 8</span>
          </div>
          {departmentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={departmentData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" fill="#2B7FFF" radius={[4, 4, 0, 0]} name="Tasks" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-50 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
              No data
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status Breakdown — Clickable bars */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>Status Breakdown</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(statusBreakdown).map(([status, count]) => {
              const pct = totalTasks > 0 ? (count / totalTasks) * 100 : 0
              let filterLabel = 'Total Tasks'
              if (status === 'done') filterLabel = 'Completed'
              else if (status === 'in_progress') filterLabel = 'In Progress'
              else if (status === 'todo' || status === 'backlog') filterLabel = 'Pending'
              
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setActiveKpi(prev => prev === filterLabel ? null : filterLabel)}
                  className="text-left transition-opacity"
                  style={{ opacity: !activeKpi || activeKpi === filterLabel ? 1 : 0.5 }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize" style={{ color: 'var(--slate-600)' }}>{status.replace('_', ' ')}</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--slate-900)' }}>{count}</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden cursor-pointer hover:opacity-80" style={{ background: 'var(--slate-100)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: STATUS_COLORS[status] || '#94A3B8' }} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Priority Breakdown — Clickable bars */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>Priority Breakdown</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(priorityBreakdown).map(([priority, count]) => {
              const pct = totalTasks > 0 ? (count / totalTasks) * 100 : 0
              return (
                <div key={priority} className="text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize" style={{ color: 'var(--slate-600)' }}>{priority}</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--slate-900)' }}>{count}</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--slate-100)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: PRIORITY_COLORS[priority] || '#94A3B8' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Additional insights row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {/* Department Breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--slate-700)' }}>Tasks by Department</h2>
          {Object.keys(departmentBreakdown).length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--slate-400)' }}>No department data</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {Object.entries(departmentBreakdown).sort(([, a], [, b]) => b - a).map(([dept, count]) => (
                <div key={dept} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-28 truncate" style={{ color: 'var(--slate-600)' }}>{dept || 'Unassigned'}</span>
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
