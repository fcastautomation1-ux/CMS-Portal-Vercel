'use client'

import { useMemo } from 'react'
import {
  LayoutGrid, TrendingUp, Users, CheckSquare, Building2,
  AlertCircle, Clock, CheckCircle2, Activity, ArrowUp,
  BarChart3, Star, Calendar
} from 'lucide-react'
import type { SessionUser } from '@/types'
import type { OverviewStats, ManagerOverviewStats } from '@/app/dashboard/overview/actions'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid, RadialBarChart, RadialBar,
  type PieLabelRenderProps,
} from 'recharts'

// ── KPI Card ─────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, gradient, delay = 0,
}: {
  label: string
  value: number | string
  sub?: string
  icon: React.ReactNode
  gradient: string
  delay?: number
}) {
  return (
    <div
      className="rounded-2xl p-5 text-white relative overflow-hidden animate-fade-in"
      style={{ background: gradient, animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.2)' }}
        >
          {icon}
        </div>
        <ArrowUp size={14} className="opacity-60 mt-1" />
      </div>
      <div className="text-3xl font-bold tracking-tight animate-count-up">
        {value}
      </div>
      <div className="text-sm font-semibold opacity-90 mt-0.5">{label}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
      {/* decorative circle */}
      <div
        className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      />
    </div>
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
  const roleData = useMemo(() =>
    Object.entries(stats.users.byRole).map(([name, value]) => ({ name, value })),
    [stats.users.byRole]
  )

  const ROLE_COLORS = ['#2B7FFF', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899']

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
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard
          label="Total Accounts"
          value={stats.accounts.total}
          sub={`${stats.accounts.running} running`}
          icon={<LayoutGrid size={18} />}
          gradient="linear-gradient(135deg, #2B7FFF, #1A6AE4)"
          delay={0}
        />
        <KpiCard
          label="Campaigns"
          value={stats.campaigns.total}
          sub={`${stats.campaigns.enabled} active`}
          icon={<TrendingUp size={18} />}
          gradient="linear-gradient(135deg, #F97316, #EA580C)"
          delay={60}
        />
        <KpiCard
          label="Team Members"
          value={stats.users.total}
          icon={<Users size={18} />}
          gradient="linear-gradient(135deg, #8B5CF6, #7C3AED)"
          delay={120}
        />
        <KpiCard
          label="Total Tasks"
          value={stats.tasks.total}
          sub={`${stats.tasks.completed} done`}
          icon={<CheckSquare size={18} />}
          gradient="linear-gradient(135deg, #10B981, #059669)"
          delay={180}
        />
        <KpiCard
          label="Overdue"
          value={stats.tasks.overdue}
          sub="need attention"
          icon={<AlertCircle size={18} />}
          gradient="linear-gradient(135deg, #EF4444, #DC2626)"
          delay={240}
        />
        <KpiCard
          label="Departments"
          value={stats.departments.total}
          icon={<Building2 size={18} />}
          gradient="linear-gradient(135deg, #14B8A6, #0D9488)"
          delay={300}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Task Status Donut */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} style={{ color: 'var(--blue-600)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Task Status</h3>
          </div>
          {stats.tasks.total > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stats.tasksByStatus.filter(d => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  labelLine={false}
                  label={renderCustomLabel}
                  animationBegin={0}
                  animationDuration={800}
                >
                  {stats.tasksByStatus.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
              No task data
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {stats.tasksByStatus.map(s => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label} ({s.value})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tasks by Department Bar */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} style={{ color: 'var(--emerald-500)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Tasks by Department</h3>
          </div>
          {stats.tasksByDept.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.tasksByDept} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" fill="#2B7FFF" radius={[4, 4, 0, 0]} name="Tasks" animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
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
          </div>
          {roleData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <RadialBarChart
                cx="50%" cy="50%"
                innerRadius="20%" outerRadius="90%"
                data={roleData.map((d, i) => ({ ...d, fill: ROLE_COLORS[i % ROLE_COLORS.length] }))}
              >
                <RadialBar dataKey="value" label={{ fill: 'var(--color-text)', fontSize: 11 }} animationDuration={800} />
                <Tooltip content={<CustomTooltip />} />
              </RadialBarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>—</div>
          )}
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
        </div>

        {/* Top Performers */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Star size={16} style={{ color: 'var(--amber-500)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Top Performers</h3>
          </div>
          {stats.topPerformers.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No data yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {stats.topPerformers.slice(0, 6).map((p, i) => (
                <div key={p.username} className="flex items-center gap-3">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ background: i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : i === 2 ? '#CD7C2F' : 'var(--slate-200)', color: i < 3 ? 'white' : 'var(--slate-600)' }}
                  >
                    {i + 1}
                  </span>
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
          {stats.recentTasks.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No tasks yet</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {stats.recentTasks.map(t => {
                const st = STATUS_STYLES[t.task_status] ?? STATUS_STYLES['todo']
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
                        {t.assigned_to && (
                          <span className="text-[10px]" style={{ color: 'var(--slate-400)' }}>
                            → {t.assigned_to}
                          </span>
                        )}
                      </div>
                    </div>
                    {t.due_date && (
                      <div
                        className="text-[10px] shrink-0 font-medium"
                        style={{ color: t.due_date < new Date().toISOString().split('T')[0] ? 'var(--rose-500)' : 'var(--slate-400)' }}
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

// ── Manager Overview ──────────────────────────────────────────

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
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight animate-fade-in" style={{ color: 'var(--color-text)' }}>
          {greeting}, {user.username} 👋
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Your team overview for today.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Team Members" value={stats.teamCount} icon={<Users size={18} />} gradient="linear-gradient(135deg, #8B5CF6, #7C3AED)" />
        <KpiCard label="Tasks Done" value={stats.teamTasks.completed} sub={`${completionRate}% rate`} icon={<CheckCircle2 size={18} />} gradient="linear-gradient(135deg, #10B981, #059669)" delay={60} />
        <KpiCard label="In Progress" value={stats.teamTasks.inProgress} icon={<Activity size={18} />} gradient="linear-gradient(135deg, #2B7FFF, #1A6AE4)" delay={120} />
        <KpiCard label="Overdue" value={stats.teamTasks.overdue} icon={<AlertCircle size={18} />} gradient="linear-gradient(135deg, #EF4444, #DC2626)" delay={180} />
      </div>

      {/* Team members */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} style={{ color: 'var(--violet-500)' }} />
          <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Team Performance</h3>
        </div>
        {stats.teamMembers.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>No team members yet</p>
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

// ── Root Component ────────────────────────────────────────────

interface OverviewPageProps {
  user: SessionUser
  adminStats: OverviewStats
  managerStats: ManagerOverviewStats
}

export function OverviewPage({ user, adminStats, managerStats }: OverviewPageProps) {
  const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
  const isManager = user.role === 'Manager'

  if (isAdminOrSM) {
    return <AdminOverview stats={adminStats} user={user} />
  }

  if (isManager) {
    return <ManagerOverview stats={managerStats} user={user} />
  }

  // Other roles
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="card p-8 text-center">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
        {greeting}, {user.username} 👋
      </h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Welcome to CMS Portal. Use the sidebar to navigate to your modules.</p>
    </div>
  )
}
