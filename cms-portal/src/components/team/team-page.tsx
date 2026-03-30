'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search, Users2, Building2, ListTodo, CircleCheckBig, Hourglass, AlertTriangle, RefreshCw, Inbox, X } from 'lucide-react'
import type { SessionUser } from '@/types'
import type { Todo } from '@/types'
import type { TeamMember } from '@/app/dashboard/team/actions'
import { getTeamMembers, getTeamTodos } from '@/app/dashboard/team/actions'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/cn'
import { TaskCard } from '@/components/tasks/task-card'
import { canonicalDepartmentKey } from '@/lib/department-name'

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

type TeamScope = 'users' | 'tasks_all' | 'tasks_completed' | 'tasks_pending' | 'tasks_overdue' | 'tasks_queue'
const TASKS_PER_PAGE = 20

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase()
}

export function TeamPage({ members: initialMembers, tasks: initialTasks, user }: Props) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
  const [paginationState, setPaginationState] = useState({ signature: '', page: 1 })
  const [showDeptQueueModal, setShowDeptQueueModal] = useState(false)
  const [modalDeptSearch, setModalDeptSearch] = useState('')
  const [selectedQueueDept, setSelectedQueueDept] = useState('')
  const [, startTransition] = useTransition()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scope = (searchParams.get('scope') as TeamScope | null) ?? 'users'
  const isTaskScope = scope !== 'users'

  const currentUsername = user?.username ?? ''

  // Use cached data from React Query — served instantly on revisit within staleTime
  const { data: members = initialMembers } = useQuery({
    queryKey: queryKeys.teamMembers(currentUsername),
    queryFn: () => getTeamMembers(),
    initialData: initialMembers,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const { data: tasks = initialTasks } = useQuery({
    queryKey: queryKeys.teamTodos(currentUsername),
    queryFn: () => getTeamTodos(),
    initialData: initialTasks,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const departments = useMemo(() => {
    // Collect all dept names from members (may have old names)
    const memberDepts = members.flatMap((m) =>
      (m.department || '').split(',').map((d) => d.trim()).filter(Boolean)
    )
    // Collect all queue dept names from tasks (official names after server normalization)
    const taskDepts = tasks.filter((t) => t.queue_department).map((t) => t.queue_department!)
    // Group by canonical key; task dept names override member dept names (they're official)
    const byKey = new Map<string, string>()
    for (const d of memberDepts) {
      const key = canonicalDepartmentKey(d)
      if (key && !byKey.has(key)) byKey.set(key, d)
    }
    for (const d of taskDepts) {
      const key = canonicalDepartmentKey(d)
      if (key) byKey.set(key, d) // override with official name
    }
    return Array.from(byKey.values()).sort()
  }, [members, tasks])

  const teamMemberDeptKeys = useMemo(
    () => Array.from(new Set(
      departments.map((d) => canonicalDepartmentKey(d)).filter(Boolean)
    )),
    [departments]
  )
  const memberOptions = useMemo(() => [...new Set(members.map((member) => member.username))].sort(), [members])

  const counts = useMemo(
    () => ({
      users: members.length,
      tasks_all: members.reduce((sum, member) => sum + member.taskStats.total, 0),
      tasks_completed: members.reduce((sum, member) => sum + member.taskStats.completed, 0),
      tasks_pending: members.reduce((sum, member) => sum + member.taskStats.pending, 0),
      tasks_overdue: members.reduce((sum, member) => sum + member.taskStats.overdue, 0),
      tasks_queue: tasks.filter((task) => task.queue_status === 'queued' && !!task.queue_department).length,
    }),
    [members, tasks]
  )

  const queueByDept = useMemo(() => {
    const map: Record<string, number> = {}
    tasks.forEach((task) => {
      if (task.queue_status === 'queued' && task.queue_department) {
        map[task.queue_department] = (map[task.queue_department] || 0) + 1
      }
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [tasks])

  const filteredModalDepts = useMemo(() => {
    if (!modalDeptSearch.trim()) return queueByDept
    const q = modalDeptSearch.toLowerCase()
    return queueByDept.filter(([dept]) => dept.toLowerCase().includes(q))
  }, [queueByDept, modalDeptSearch])


  const filtered = useMemo(() => {
    let list = members

    if (deptFilter) list = list.filter((member) => {
      const depts = (member.department || '').split(',').map((d) => d.trim())
      return depts.some((d) => canonicalDepartmentKey(d) === canonicalDepartmentKey(deptFilter))
    })
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
    if (scope === 'tasks_queue') return list.filter((member) => {
      const memberLower = member.username.toLowerCase()
      return tasks.some((task) => {
        if (task.queue_status !== 'queued' || !task.queue_department) return false
        if ((task.username || '').toLowerCase() === memberLower) return true
        if ((task.assigned_to || '').toLowerCase() === memberLower) return true
        const assignees = task.multi_assignment?.assignees ?? []
        return assignees.some((entry) => {
          if ((entry.username || '').toLowerCase() === memberLower) return true
          return Array.isArray(entry.delegated_to) && entry.delegated_to.some((sub) => (sub.username || '').toLowerCase() === memberLower)
        })
      })
    })

    return list
  }, [members, tasks, search, deptFilter, memberFilter, scope])

  const filteredTasks = useMemo(() => {
    let list = tasks
    const searchQuery = search.trim().toLowerCase()
    const today = new Date()

    if (deptFilter) {
      if (scope === 'tasks_queue') {
        list = list.filter((task) => canonicalDepartmentKey(task.queue_department || '') === canonicalDepartmentKey(deptFilter))
      } else {
        list = list.filter((task) => canonicalDepartmentKey(task.creator_department || task.category || '') === canonicalDepartmentKey(deptFilter))
      }
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
    } else if (scope === 'tasks_queue') {
      list = list.filter((task) => task.queue_status === 'queued' && !!task.queue_department)
    }

    return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [tasks, search, deptFilter, memberFilter, scope])

  const taskPaginationSignature = `${scope}|${search}|${deptFilter}|${memberFilter}`
  const currentTaskPage = paginationState.signature === taskPaginationSignature ? paginationState.page : 1
  const totalTaskPages = Math.max(1, Math.ceil(filteredTasks.length / TASKS_PER_PAGE))
  const visibleTaskPage = Math.min(currentTaskPage, totalTaskPages)
  const paginatedTasks = useMemo(() => {
    const start = (visibleTaskPage - 1) * TASKS_PER_PAGE
    return filteredTasks.slice(start, start + TASKS_PER_PAGE)
  }, [filteredTasks, visibleTaskPage])

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
      queue: tasks.filter((task) => task.queue_status === 'queued' && !!task.queue_department).length,
    }
  }, [tasks])

  const scopeLabel = useMemo(() => {
    if (scope === 'tasks_all') return 'Task'
    if (scope === 'tasks_completed') return 'Completed Task'
    if (scope === 'tasks_pending') return 'Pending Task'
    if (scope === 'tasks_overdue') return 'Overdue Task'
    if (scope === 'tasks_queue') return 'Queue Task'
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
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { key: 'tasks_all', label: 'Total Task', value: taskKpis.total, icon: ListTodo, tone: 'text-[#2B7FFF]', bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]' },
              { key: 'tasks_completed', label: 'Completed Task', value: taskKpis.completed, icon: CircleCheckBig, tone: 'text-[#059669]', bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]' },
              { key: 'tasks_pending', label: 'Pending', value: taskKpis.pending, icon: Hourglass, tone: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', border: 'border-[#FDE68A]' },
              { key: 'tasks_overdue', label: 'Overdue', value: taskKpis.overdue, icon: AlertTriangle, tone: 'text-[#E11D48]', bg: 'bg-[#FFF1F2]', border: 'border-[#FECDD3]' },
              { key: 'tasks_queue', label: 'Queue', value: taskKpis.queue, icon: Inbox, tone: 'text-[#7C3AED]', bg: 'bg-[#F3E8FF]', border: 'border-[#DDD6FE]' },
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
            {scope === 'tasks_queue' && (
              <button
                onClick={() => {
                  setModalDeptSearch('')
                  setSelectedQueueDept('')
                  setShowDeptQueueModal(true)
                }}
                className="flex h-10 items-center gap-2 rounded-lg border border-[#0ea5e9] bg-[#f0f9ff] px-4 text-sm font-semibold text-[#0284c7] transition-all hover:bg-[#e0f2fe]"
              >
                <Inbox size={15} />
                Dept Queue
              </button>
            )}
          </div>
        </div>

        {showDeptQueueModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between bg-[#0EA5E9] p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center rounded-lg bg-white/20 p-2">
                    <Building2 size={20} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold leading-tight">Select Department</h2>
                    <p className="text-xs font-medium text-white/80">View queued tasks and assign</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDeptQueueModal(false)}
                  className="rounded-lg bg-white/10 p-1.5 transition-colors hover:bg-white/20"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col overflow-hidden p-5">
                <h3 className="mb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">Search</h3>
                <div className="relative mb-5">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={modalDeptSearch}
                    onChange={(e) => setModalDeptSearch(e.target.value)}
                    placeholder="Type to search..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition-colors focus:border-[#0EA5E9] focus:ring-2 focus:ring-[#0EA5E9]/10"
                  />
                </div>

                <div className="flex-1 overflow-y-auto pr-2" style={{ maxHeight: '35vh' }}>
                  {filteredModalDepts.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                      No departments found in queue.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredModalDepts.map(([dept, count]) => {
                        const isSelected = selectedQueueDept === dept
                        return (
                          <div
                            key={dept}
                            onClick={() => setSelectedQueueDept(dept)}
                            className={cn(
                              'flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-all hover:bg-slate-50',
                              isSelected ? 'border-[#0EA5E9] bg-[#f0f9ff]' : 'border-slate-200'
                            )}
                          >
                            <label className="flex cursor-pointer items-center gap-3">
                              <div className="flex items-center justify-center h-4 w-4 rounded-full border border-slate-300 bg-white">
                                {isSelected && <div className="h-2 w-2 rounded-full bg-[#0EA5E9]" />}
                              </div>
                              <span className="text-sm font-semibold text-slate-700">{dept}</span>
                            </label>
                            <span className="rounded-full bg-[#0EA5E9] px-2.5 py-0.5 text-[11px] font-bold text-white">
                              {count} queued
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/50 p-4">
                <button
                  type="button"
                  onClick={() => setShowDeptQueueModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedQueueDept}
                  onClick={() => {
                    setDeptFilter(selectedQueueDept)
                    router.replace('/dashboard/team?scope=tasks_queue', { scroll: false })
                    setShowDeptQueueModal(false)
                  }}
                  className="rounded-xl bg-[#0EA5E9] px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#0284c7] disabled:opacity-50"
                >
                  Open Queue
                </button>
              </div>
            </div>
          </div>
        )}

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

                  {paginatedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      currentUsername={user?.username ?? ''}
                      currentUserDept={user?.department ?? null}
                      currentUserTeamMembers={user?.teamMembers ?? []}
                      currentUserTeamMemberDeptKeys={teamMemberDeptKeys}
                      enableQueueAssign
                      onEdit={(nextTask) => {
                        sessionStorage.setItem('task-detail-back', '/dashboard/team?scope=tasks_queue')
                        router.push(`/dashboard/tasks/${nextTask.id}`)
                      }}
                      onViewDetail={(nextTask) => {
                        sessionStorage.setItem('task-detail-back', '/dashboard/team?scope=tasks_queue')
                        router.push(`/dashboard/tasks/${nextTask.id}`)
                      }}
                      onShare={() => undefined}
                      onRefresh={() => router.refresh()}
                    />
                  ))}

                  {filteredTasks.length > TASKS_PER_PAGE && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfe5f1] bg-white px-4 py-3">
                      <p className="text-sm text-slate-500">
                        Showing {(visibleTaskPage - 1) * TASKS_PER_PAGE + 1}-{Math.min(visibleTaskPage * TASKS_PER_PAGE, filteredTasks.length)} of {filteredTasks.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPaginationState({ signature: taskPaginationSignature, page: Math.max(1, visibleTaskPage - 1) })}
                          disabled={visibleTaskPage === 1}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                          Page {visibleTaskPage} / {totalTaskPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPaginationState({ signature: taskPaginationSignature, page: Math.min(totalTaskPages, visibleTaskPage + 1) })}
                          disabled={visibleTaskPage === totalTaskPages}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
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
