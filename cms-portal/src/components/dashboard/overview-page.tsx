'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LayoutGrid, TrendingUp, Users, CheckSquare, Building2,
  AlertCircle, Clock, CheckCircle2, Activity,
  BarChart3, Star, Calendar
} from 'lucide-react'
import type { SessionUser } from '@/types'
import type { OverviewStats, ManagerOverviewStats, PersonalStats } from '@/app/dashboard/overview/actions'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid,
  type PieLabelRenderProps,
} from 'recharts'

// ── KPI Card ─────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, color, iconBg, delay = 0, onClick, active = false,
}: {
  label: string
  value: number | string
  sub?: string
  icon: React.ReactNode
  color: string
  iconBg: string
  delay?: number
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card p-4 text-center relative animate-fade-in focus:outline-none transition-all duration-200 hover:scale-[1.03]"
      style={{
        animationDelay: `${delay}ms`,
        boxShadow: active ? `0 0 0 2px ${color}, 0 4px 16px ${color}30` : undefined,
        transform: active ? 'scale(1.03)' : undefined,
      }}
    >
      {active && (
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: color }} />
      )}
      <div className="flex items-center justify-center mb-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: iconBg, color }}
        >
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold tracking-tight animate-count-up" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
      <div className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{sub}</div>}
    </button>
  )
}

// ── Donut Chart ───────────────────────────────────────────────

const RADIAN = Math.PI / 180
function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: PieLabelRenderProps) {
  const cxN = Number(cx ?? 0)
  const cyN = Number(cy ?? 0)
  const ir = Number(innerRadius ?? 0)
  const or = Number(outerRadius ?? 0)
  const angle = Number(midAngle ?? 0)
  const pct = Number(percent ?? 0)
  const radius = ir + (or - ir) * 0.5
  const x = cxN + radius * Math.cos(-angle * RADIAN)
  const y = cyN + radius * Math.sin(-angle * RADIAN)
  if (pct < 0.05) return null
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(pct * 100).toFixed(0)}%`}
    </text>
  )
}

// ── Custom Tooltip ────────────────────────────────────────────

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

// ── Status badge ──────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  backlog:     { bg: 'var(--slate-100)', color: 'var(--slate-600)', label: 'Backlog' },
  todo:        { bg: 'var(--blue-50)', color: 'var(--blue-700)', label: 'To Do' },
  in_progress: { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6', label: 'In Progress' },
  done:        { bg: 'var(--emerald-50)', color: 'var(--emerald-600)', label: 'Done' },
}

const PRIORITY_STYLES: Record<string, { color: string }> = {
  urgent: { color: '#EF4444' },
  high:   { color: '#F97316' },
  medium: { color: '#F59E0B' },
  low:    { color: '#64748B' },
}

// ── Main Admin/SuperManager Overview ─────────────────────────

interface AdminOverviewProps {
  stats: OverviewStats
  user: SessionUser
}

function AdminOverview({ stats, user }: AdminOverviewProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const router = useRouter()
  const ROLE_COLORS = ['#2B7FFF', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899']
  const today = new Date().toISOString().split('T')[0]

  const usersByName = useMemo(
    () => Object.fromEntries(stats.userRecords.map(record => [record.username, record])),
    [stats.userRecords]
  )

  const allRoleData = useMemo(
    () => Object.entries(stats.users.byRole).map(([name, value]) => ({ name, value })),
    [stats.users.byRole]
  )

  const filtered = useMemo(() => {
    const tasks = stats.taskRecords.filter(task => {
      if (!activeFilter || activeFilter === 'Total Tasks') return true

      const owner = task.assigned_to || task.username
      const ownerRole = usersByName[owner]?.role
      const isCompleted = task.completed || task.task_status === 'done'
      const isOverdue = !isCompleted && Boolean(task.due_date && task.due_date < today)

      switch (activeFilter) {
        case 'Overdue':
          return isOverdue
        case 'Completed':
          return isCompleted
        case 'In Progress':
          return !isCompleted && !isOverdue && task.task_status === 'in_progress'
        case 'Pending':
          return !isCompleted && !isOverdue && task.task_status !== 'in_progress'
        case 'Total Accounts':
        case 'Campaigns':
        case 'Team Members':
        case 'Departments':
          return true
        default:
          if (stats.users.byRole[activeFilter]) return ownerRole === activeFilter
          return task.category === activeFilter
      }
    })

    const ownerSet = new Set(tasks.map(task => task.assigned_to || task.username))
    // For filters that don't relate to a specific user/role, keep the full user list
    const isNonUserFilter = !activeFilter
      || activeFilter === 'Team Members'
      || activeFilter === 'Total Accounts'
      || activeFilter === 'Campaigns'
      || activeFilter === 'Total Tasks'
      || activeFilter === 'Departments'
    const visibleUsers = isNonUserFilter
      ? stats.userRecords
      : stats.users.byRole[activeFilter]
      ? stats.userRecords.filter(record => record.role === activeFilter)
      : stats.userRecords.filter(record => ownerSet.has(record.username))

    let completed = 0
    let inProgress = 0
    let pending = 0
    let overdue = 0
    const deptMap: Record<string, number> = {}
    const userMap: Record<string, { total: number; completed: number }> = {}

    for (const task of tasks) {
      const owner = task.assigned_to || task.username
      if (!userMap[owner]) userMap[owner] = { total: 0, completed: 0 }
      userMap[owner].total++

      const isCompleted = task.completed || task.task_status === 'done'
      const isOverdue = !isCompleted && Boolean(task.due_date && task.due_date < today)

      if (isCompleted) {
        completed++
        userMap[owner].completed++
      } else if (isOverdue) {
        overdue++
      } else if (task.task_status === 'in_progress') {
        inProgress++
      } else {
        pending++
      }

      if (task.category) deptMap[task.category] = (deptMap[task.category] || 0) + 1
    }

    const topPerformers = Object.entries(userMap)
      .map(([username, value]) => ({
        username,
        completed: value.completed,
        total: value.total,
        completion: value.total > 0 ? Math.round((value.completed / value.total) * 100) : 0,
        avatarData: usersByName[username]?.avatarData ?? null,
      }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 8)

    const tasksByStatus = [
      { label: 'Completed', value: completed, color: '#10B981' },
      { label: 'In Progress', value: inProgress, color: '#3B82F6' },
      { label: 'Pending', value: pending, color: '#F59E0B' },
      { label: 'Overdue', value: overdue, color: '#EF4444' },
    ]

    const tasksByDept = Object.entries(deptMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    const roleMap: Record<string, number> = {}
    visibleUsers.forEach(record => {
      roleMap[record.role] = (roleMap[record.role] || 0) + 1
    })

    return {
      taskTotals: { total: tasks.length, completed, inProgress, pending, overdue },
      tasksByStatus,
      tasksByDept,
      topPerformers,
      visibleUsers,
      roleData: Object.entries(roleMap).map(([name, value]) => ({ name, value })),
      recentTasks: [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8),
    }
  }, [activeFilter, stats.taskRecords, stats.userRecords, stats.users.byRole, today, usersByName])

  const roleData = filtered.roleData.length > 0 ? filtered.roleData : allRoleData

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      {/* Welcome banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight animate-fade-in" style={{ color: 'var(--color-text)' }}>
            {greeting}, {user.username} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Here&apos;s what&apos;s happening across your portal today.
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
          style={{ background: 'var(--blue-50)', color: 'var(--blue-700)', border: '1px solid var(--blue-200)' }}
        >
          <Calendar size={14} />
          {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:opacity-80"
          style={{ background: 'var(--slate-100)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
        >
          <Activity size={14} />
          Refresh
        </button>
      </div>

      {activeFilter && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-200)' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--blue-700)' }}>Synchronized Filter</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{activeFilter}</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveFilter(null)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'white', color: 'var(--blue-700)', border: '1px solid var(--blue-200)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KpiCard
          label="Total Accounts"
          value={stats.accounts.total}
          sub={`${stats.accounts.running} running`}
          icon={<LayoutGrid size={18} />}
          color="#3B82F6"
          iconBg="rgba(59,130,246,0.12)"
          delay={0}
          active={activeFilter === 'Total Accounts'}
          onClick={() => setActiveFilter(activeFilter === 'Total Accounts' ? null : 'Total Accounts')}
        />
        <KpiCard
          label="Campaigns"
          value={stats.campaigns.total}
          sub={`${stats.campaigns.enabled} active`}
          icon={<TrendingUp size={18} />}
          color="#F59E0B"
          iconBg="rgba(245,158,11,0.12)"
          delay={60}
          active={activeFilter === 'Campaigns'}
          onClick={() => setActiveFilter(activeFilter === 'Campaigns' ? null : 'Campaigns')}
        />
        <KpiCard
          label="Team Members"
          value={activeFilter ? filtered.visibleUsers.length : stats.users.total}
          icon={<Users size={18} />}
          color="#8B5CF6"
          iconBg="rgba(139,92,246,0.12)"
          delay={120}
          active={activeFilter === 'Team Members' || Boolean(activeFilter && stats.users.byRole[activeFilter])}
          onClick={() => setActiveFilter(activeFilter === 'Team Members' ? null : 'Team Members')}
        />
        <KpiCard
          label="Total Tasks"
          value={activeFilter ? filtered.taskTotals.total : stats.tasks.total}
          sub={`${activeFilter ? filtered.taskTotals.completed : stats.tasks.completed} done`}
          icon={<CheckSquare size={18} />}
          color="#22C55E"
          iconBg="rgba(34,197,94,0.12)"
          delay={180}
          active={activeFilter === 'Total Tasks'}
          onClick={() => setActiveFilter(activeFilter === 'Total Tasks' ? null : 'Total Tasks')}
        />
        <KpiCard
          label="Overdue"
          value={activeFilter ? filtered.taskTotals.overdue : stats.tasks.overdue}
          sub="need attention"
          icon={<AlertCircle size={18} />}
          color="#EF4444"
          iconBg="rgba(239,68,68,0.12)"
          delay={240}
          active={activeFilter === 'Overdue'}
          onClick={() => setActiveFilter(activeFilter === 'Overdue' ? null : 'Overdue')}
        />
        <KpiCard
          label="Departments"
          value={activeFilter ? filtered.tasksByDept.length : stats.departments.total}
          icon={<Building2 size={18} />}
          color="#14B8A6"
          iconBg="rgba(20,184,166,0.12)"
          delay={300}
          active={activeFilter === 'Departments' || Boolean(activeFilter && filtered.tasksByDept.some(item => item.label === activeFilter))}
          onClick={() => setActiveFilter(activeFilter === 'Departments' ? null : (filtered.tasksByDept[0]?.label ?? stats.tasksByDept[0]?.label ?? 'Departments'))}
        />
      </div>

      {/* Quick-view panel — shown when a KPI is selected */}
      {activeFilter && (
        <div
          className="mb-6 rounded-2xl p-4 animate-fade-in flex flex-col gap-2"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        >
          {/* header */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Quick View — {activeFilter}
            </span>
            <button
              onClick={() => setActiveFilter(null)}
              className="text-xs px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              ✕ Close
            </button>
          </div>

          {activeFilter === 'Total Accounts' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total', value: stats.accounts.total, color: '#2B7FFF' },
                { label: 'Running', value: stats.accounts.running, color: '#10B981' },
                { label: 'Not Running', value: stats.accounts.total - stats.accounts.running, color: '#94A3B8' },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: `${item.color}12`, border: `1px solid ${item.color}30` }}>
                  <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                  <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {activeFilter === 'Campaigns' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total', value: stats.campaigns.total, color: '#F97316' },
                { label: 'Enabled', value: stats.campaigns.enabled, color: '#10B981' },
                { label: 'Disabled', value: stats.campaigns.total - stats.campaigns.enabled, color: '#94A3B8' },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: `${item.color}12`, border: `1px solid ${item.color}30` }}>
                  <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                  <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {(activeFilter === 'Team Members' || Boolean(stats.users.byRole[activeFilter])) && (
            <div className="flex flex-wrap gap-2">
              {roleData.map(role => (
                <button key={role.name} type="button" onClick={() => setActiveFilter(prev => prev === role.name ? null : role.name)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--slate-100)', border: '1px solid var(--color-border)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: '#8B5CF6' }} />
                  <span style={{ color: 'var(--color-text)' }}>{role.name}</span>
                  <span className="font-bold" style={{ color: '#8B5CF6' }}>{role.value}</span>
                </button>
              ))}
            </div>
          )}

          {(activeFilter === 'Total Tasks' || activeFilter === 'Completed' || activeFilter === 'In Progress' || activeFilter === 'Pending' || activeFilter === 'Overdue') && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total', value: filtered.taskTotals.total, color: '#10B981' },
                { label: 'Completed', value: filtered.taskTotals.completed, color: '#22C55E' },
                { label: 'In Progress', value: filtered.taskTotals.inProgress, color: '#3B82F6' },
                { label: 'Overdue', value: filtered.taskTotals.overdue, color: '#EF4444' },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: `${item.color}12`, border: `1px solid ${item.color}30` }}>
                  <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                  <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {activeFilter === 'Overdue' && (
            <div className="flex flex-col gap-2">
              {filtered.recentTasks.filter(t => t.due_date && t.due_date < today && !t.completed && t.task_status !== 'done').length === 0 ? (
                <p className="text-sm py-2" style={{ color: 'var(--color-text-muted)' }}>No overdue tasks found in recent tasks.</p>
              ) : (
                filtered.recentTasks
                  .filter(t => t.due_date && t.due_date < today && !t.completed && t.task_status !== 'done')
                  .map(t => (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#EF4444' }} />
                      <span className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{t.title}</span>
                      <span className="text-xs font-medium shrink-0" style={{ color: '#EF4444' }}>{t.due_date}</span>
                    </div>
                  ))
              )}
            </div>
          )}

          {(!['Total Accounts', 'Campaigns', 'Team Members', 'Total Tasks', 'Overdue', 'Departments', 'Completed', 'In Progress', 'Pending'].includes(activeFilter) && !stats.users.byRole[activeFilter]) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filtered.tasksByDept.map(item => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.25)' }}>
                  <p className="text-2xl font-bold" style={{ color: '#14B8A6' }}>{item.value}</p>
                  <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Task Status Donut */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} style={{ color: 'var(--blue-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Task Status</h3>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>click to filter</span>
          </div>
          {filtered.taskTotals.total > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={filtered.tasksByStatus.filter(d => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  labelLine={false}
                  label={renderCustomLabel}
                  animationBegin={0}
                  animationDuration={800}
                  cursor="pointer"
                  onClick={(entry: unknown) => {
                    const label = ((entry as { payload?: { label?: string } }).payload?.label) ?? null
                    if (!label) return
                    setActiveFilter(prev => prev === label ? null : label)
                  }}
                >
                  {filtered.tasksByStatus.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.color}
                      opacity={activeFilter === entry.label || activeFilter === null || activeFilter === 'Total Tasks' ? 1 : 0.45}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-50 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
              No task data
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {filtered.tasksByStatus.map(s => (
              <button
                key={s.label}
                type="button"
                onClick={() => setActiveFilter(prev => prev === s.label ? null : s.label)}
                className="flex items-center gap-1.5 transition-opacity"
                style={{ opacity: activeFilter === s.label || activeFilter === null || activeFilter === 'Total Tasks' ? 1 : 0.5 }}
              >
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label} ({s.value})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tasks by Department Bar */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} style={{ color: 'var(--emerald-500)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Tasks by Department</h3>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>click bar to view</span>
          </div>
          {filtered.tasksByDept.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={filtered.tasksByDept} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(43,127,255,0.08)' }} />
                <Bar dataKey="value" fill="#2B7FFF" radius={[4, 4, 0, 0]} name="Tasks" animationDuration={800} cursor="pointer" onClick={(entry: unknown) => {
                  const label = ((entry as { payload?: { label?: string } }).payload?.label) ?? null
                  if (!label) return
                  setActiveFilter(prev => prev === label ? null : label)
                }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-50 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
              No department data
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: User Distribution + Top Performers + Recent Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* User Role Distribution */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} style={{ color: 'var(--violet-500)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>User Roles</h3>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>click to filter</span>
          </div>
          {roleData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={roleData.map((d, i) => ({ ...d, fill: ROLE_COLORS[i % ROLE_COLORS.length] }))}
                  layout="vertical"
                  margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Users" animationDuration={800} cursor="pointer" onClick={(entry: unknown) => {
                    const label = ((entry as { payload?: { name?: string } }).payload?.name) ?? null
                    if (!label) return
                    setActiveFilter(prev => prev === label ? null : label)
                  }}>
                    {roleData.map((_, i) => (
                      <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5 mt-2">
                {roleData.map((r, i) => (
                  <div key={r.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{r.name}</span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-45 flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>—</div>
          )}
        </div>

        {/* Top Performers */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Star size={16} style={{ color: 'var(--amber-500)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Top Performers</h3>
          </div>
          {filtered.topPerformers.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No data yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.topPerformers.slice(0, 6).map((p, i) => (
                <div key={p.username} className="flex items-center gap-3">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ background: i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : i === 2 ? '#CD7C2F' : 'var(--slate-200)', color: i < 3 ? 'white' : 'var(--slate-600)' }}
                  >
                    {i + 1}
                  </span>
                  <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #2B7FFF, #8B5CF6)' }}>
                    {p.avatarData ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarData} alt={p.username} className="w-full h-full object-cover" />
                    ) : (
                      p.username.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.username}</span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{p.completion}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--slate-100)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${p.completion}%`, background: 'linear-gradient(90deg, #2B7FFF, #8B5CF6)' }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-medium shrink-0" style={{ color: 'var(--emerald-600)' }}>
                    {p.completed}✓
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Tasks */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} style={{ color: 'var(--blue-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Recent Tasks</h3>
          </div>
          {filtered.recentTasks.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No tasks yet</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filtered.recentTasks.map(t => {
                const isOverdue = !t.completed && Boolean(t.due_date && t.due_date < today)
                const st = isOverdue
                  ? { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', label: 'Overdue' }
                  : STATUS_STYLES[t.task_status] ?? STATUS_STYLES['todo']
                const pr = PRIORITY_STYLES[t.priority] ?? { color: '#64748B' }
                return (
                  <div key={t.id} className="flex items-start gap-2.5">
                    <div
                      className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                      style={{ background: pr.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ background: st.bg, color: st.color }}
                        >
                          {st.label}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--slate-400)' }}>
                          → {t.assigned_to || t.username}
                        </span>
                        {t.category && (
                          <span className="text-[10px]" style={{ color: 'var(--slate-400)' }}>
                            • {t.category}
                          </span>
                        )}
                      </div>
                    </div>
                    {t.due_date && (
                      <div
                        className="text-[10px] shrink-0 font-medium"
                        style={{ color: isOverdue ? 'var(--rose-500)' : 'var(--slate-400)' }}
                      >
                        {t.due_date}
                      </div>
                    )}
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

// ── Manager / Supervisor Overview ────────────────────────────

interface ManagerOverviewProps {
  stats: ManagerOverviewStats
  user: SessionUser
}

function ManagerOverview({ stats, user }: ManagerOverviewProps) {
  const completionRate = stats.teamTasks.total > 0
    ? Math.round((stats.teamTasks.completed / stats.teamTasks.total) * 100)
    : 0

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight animate-fade-in" style={{ color: 'var(--color-text)' }}>
            {greeting}, {user.username} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Your team overview for today.
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
          style={{ background: 'var(--blue-50)', color: 'var(--blue-700)', border: '1px solid var(--blue-200)' }}
        >
          <Calendar size={14} />
          {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Team Members" value={stats.teamCount} icon={<Users size={18} />} color="#8B5CF6" iconBg="rgba(139,92,246,0.12)" />
        <KpiCard label="Tasks Done" value={stats.teamTasks.completed} sub={`${completionRate}% rate`} icon={<CheckCircle2 size={18} />} color="#22C55E" iconBg="rgba(34,197,94,0.12)" delay={60} />
        <KpiCard label="In Progress" value={stats.teamTasks.inProgress} icon={<Activity size={18} />} color="#3B82F6" iconBg="rgba(59,130,246,0.12)" delay={120} />
        <KpiCard label="Overdue" value={stats.teamTasks.overdue} icon={<AlertCircle size={18} />} color="#EF4444" iconBg="rgba(239,68,68,0.12)" delay={180} />
      </div>

      {/* Team stats summary bar */}
      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={14} style={{ color: 'var(--blue-600)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Team Task Summary</span>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--blue-50)', color: 'var(--blue-700)' }}>
            {stats.teamTasks.total} total
          </span>
        </div>
        <div className="flex gap-3 flex-wrap">
          {[
            { label: 'Completed', value: stats.teamTasks.completed, color: '#10B981' },
            { label: 'In Progress', value: stats.teamTasks.inProgress, color: '#3B82F6' },
            { label: 'Pending', value: stats.teamTasks.pending, color: '#F59E0B' },
            { label: 'Overdue', value: stats.teamTasks.overdue, color: '#EF4444' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1 min-w-[100px]" style={{ background: `${s.color}10`, border: `1px solid ${s.color}30` }}>
              <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              <div>
                <p className="text-base font-bold leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Team members performance */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} style={{ color: 'var(--violet-500)' }} />
          <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Team Performance</h3>
        </div>
        {stats.teamMembers.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No team members assigned yet</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.teamMembers.map(m => {
              const rate = m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0
              return (
                <div key={m.username} className="p-3 rounded-xl" style={{ background: 'var(--slate-100)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #2B7FFF, #8B5CF6)' }}>
                      {m.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{m.username}</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{m.department ?? m.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{m.completed}/{m.total} tasks</span>
                    <span className="text-[11px] font-semibold" style={{ color: '#10B981' }}>{rate}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--slate-200)' }}>
                    <div className="h-full rounded-full" style={{ width: `${rate}%`, background: 'linear-gradient(90deg, #10B981, #059669)' }} />
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

// ── User (personal) Overview ──────────────────────────────────

interface UserOverviewProps {
  stats: PersonalStats
  user: SessionUser
}

function UserOverview({ stats, user }: UserOverviewProps) {
  const today = new Date().toISOString().split('T')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const completionRate = stats.tasks.total > 0
    ? Math.round((stats.tasks.completed / stats.tasks.total) * 100)
    : 0

  return (
    <div>
      {/* Welcome banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight animate-fade-in" style={{ color: 'var(--color-text)' }}>
            {greeting}, {user.username} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Here&apos;s your personal task overview for today.
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
          style={{ background: 'var(--blue-50)', color: 'var(--blue-700)', border: '1px solid var(--blue-200)' }}
        >
          <Calendar size={14} />
          {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="My Total Tasks"
          value={stats.tasks.total}
          sub={`${completionRate}% done`}
          icon={<CheckSquare size={18} />}
          color="#2B7FFF"
          iconBg="rgba(43,127,255,0.12)"
        />
        <KpiCard
          label="Completed"
          value={stats.tasks.completed}
          icon={<CheckCircle2 size={18} />}
          color="#10B981"
          iconBg="rgba(16,185,129,0.12)"
          delay={60}
        />
        <KpiCard
          label="In Progress"
          value={stats.tasks.inProgress}
          icon={<Activity size={18} />}
          color="#3B82F6"
          iconBg="rgba(59,130,246,0.12)"
          delay={120}
        />
        <KpiCard
          label="Overdue"
          value={stats.tasks.overdue}
          sub="need attention"
          icon={<AlertCircle size={18} />}
          color="#EF4444"
          iconBg="rgba(239,68,68,0.12)"
          delay={180}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Task status donut */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} style={{ color: 'var(--blue-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>My Task Status</h3>
          </div>
          {stats.tasks.total > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={stats.tasksByStatus.filter(d => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    dataKey="value"
                    labelLine={false}
                    label={renderCustomLabel}
                    animationBegin={0}
                    animationDuration={800}
                  >
                    {stats.tasksByStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {stats.tasksByStatus.map(s => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label} ({s.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-45 flex items-center justify-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No tasks yet</div>
          )}
        </div>

        {/* Recent tasks */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} style={{ color: 'var(--blue-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>My Recent Tasks</h3>
          </div>
          {stats.recentTasks.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No tasks yet</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {stats.recentTasks.map(t => {
                const isOverdue = !t.completed && Boolean(t.due_date && t.due_date < today)
                const st = isOverdue
                  ? { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', label: 'Overdue' }
                  : STATUS_STYLES[t.task_status] ?? STATUS_STYLES['todo']
                const pr = PRIORITY_STYLES[t.priority] ?? { color: '#64748B' }
                return (
                  <div key={t.id} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: pr.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                        {t.category && (
                          <span className="text-[10px]" style={{ color: 'var(--slate-400)' }}>• {t.category}</span>
                        )}
                      </div>
                    </div>
                    {t.due_date && (
                      <div className="text-[10px] shrink-0 font-medium" style={{ color: isOverdue ? 'var(--rose-500)' : 'var(--slate-400)' }}>
                        {t.due_date}
                      </div>
                    )}
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

// ── Root Component ────────────────────────────────────────────

interface OverviewPageProps {
  user: SessionUser
  adminStats: OverviewStats | null
  managerStats: ManagerOverviewStats | null
  personalStats: PersonalStats | null
}

export function OverviewPage({ user, adminStats, managerStats, personalStats }: OverviewPageProps) {
  const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
  const isManagerOrSupervisor = user.role === 'Manager' || user.role === 'Supervisor'

  if (isAdminOrSM && adminStats) {
    return <AdminOverview stats={adminStats} user={user} />
  }

  if (isManagerOrSupervisor) {
    // Show team overview if team data is available and has members
    if (managerStats && managerStats.teamCount > 0) {
      return <ManagerOverview stats={managerStats} user={user} />
    }
    // Supervisor/Manager with no team → personal view
    if (personalStats) return <UserOverview stats={personalStats} user={user} />
  }

  // Regular User — personal tasks only
  if (personalStats) return <UserOverview stats={personalStats} user={user} />

  // Fallback (should not normally be reached)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="card p-8 text-center">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
        {greeting}, {user.username} 👋
      </h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Welcome to CMS Portal.</p>
    </div>
  )
}
