'use client'

import { useMemo, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Search, Plus, Trash2, Pencil, X, UserPlus } from 'lucide-react'
import { createUser, updateUser, deleteUser, type UserFormOptions } from '@/app/dashboard/users/actions'
import type { User, SessionUser, UserRole, ModuleAccess } from '@/types'
import { cn } from '@/lib/cn'

const ROLES: UserRole[] = ['Admin', 'Super Manager', 'Manager', 'Supervisor', 'User']

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-purple-100 text-purple-700',
  'Super Manager': 'bg-blue-100 text-blue-700',
  Manager: 'bg-sky-100 text-sky-700',
  Supervisor: 'bg-teal-100 text-teal-700',
  User: 'bg-slate-100 text-slate-600',
}

interface Props {
  users: User[]
  departments: string[]
  currentUser: SessionUser
  options: UserFormOptions
}

function splitCsv(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(',').map(v => v.trim()).filter(Boolean)
}

function normalizeModuleAccess(role: UserRole, moduleAccess: ModuleAccess | null): ModuleAccess {
  return {
    googleAccount: { enabled: moduleAccess?.googleAccount?.enabled ?? false, accessLevel: 'all' },
    users: { enabled: moduleAccess?.users?.enabled ?? false, departmentRestricted: true },
    looker: { enabled: moduleAccess?.looker?.enabled ?? false },
    todos: { enabled: true },
    packages: { enabled: role === 'Manager' || role === 'Super Manager' || moduleAccess?.packages?.enabled === true },
  }
}

function initials(name: string) {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase())
    .join('') || 'U'
}

export function UsersPage({ users: initial, departments, currentUser, options }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(currentUser.role)
  const [users, setUsers] = useState(initial)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [pending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    let list = users
    if (roleFilter) list = list.filter(u => u.role === roleFilter)
    if (deptFilter) list = list.filter(u => (u.department || '').split(',').map(x => x.trim()).includes(deptFilter))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(u =>
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      )
    }
    return list
  }, [users, search, roleFilter, deptFilter])

  function openEdit(u: User) { setEditing(u); setModalOpen(true) }

  async function handleDelete() {
    if (!deleting) return
    startTransition(async () => {
      const res = await deleteUser(deleting.username)
      if (res.success) setUsers(prev => prev.filter(u => u.username !== deleting.username))
      setDeleting(null)
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl" style={{ color: 'var(--slate-900)' }}>Users</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--slate-500)' }}>{users.length} users total</p>
        </div>
        {canEdit && (
          <Link
            href="/dashboard/users/new"
            className="btn-motion flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white"
            style={{ background: 'var(--blue-600)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
          >
            <Plus size={16} /> Add User
          </Link>
        )}
      </div>

      <div className="card mb-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:min-w-[180px] sm:flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="h-10 w-full rounded-lg pl-9 pr-3 text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-10 min-w-[120px] flex-1 rounded-lg px-3 text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
            <option value="">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="h-10 min-w-[120px] flex-1 rounded-lg px-3 text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
                {['User', 'Email', 'Role', 'Department(s)', 'Last Login', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.username} className="transition-colors hover:bg-blue-50/30" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      {u.avatar_data ? (
                        <Image src={u.avatar_data} alt={u.username} width={36} height={36} className="h-9 w-9 rounded-lg object-cover" unoptimized />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'var(--blue-600)' }}>
                          {initials(u.username)}
                        </div>
                      )}
                      <span className="font-medium" style={{ color: 'var(--slate-900)' }}>{u.username}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{u.email}</td>
                  <td className="px-5 py-3">
                    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-600')}>{u.role}</span>
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{u.department || '-'}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--slate-500)' }}>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                  <td className="px-5 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)} className="btn-motion rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"><Pencil size={14} /></button>
                        {u.username !== 'admin' && (
                          <button onClick={() => setDeleting(u)} className="btn-motion rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--slate-400)' }}>No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && editing && (
        <UserModal
          user={editing}
          departments={departments}
          options={options}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={(u, isNew) => {
            if (isNew) setUsers(prev => [...prev, u])
            else setUsers(prev => prev.map(x => x.username === u.username ? u : x))
            setModalOpen(false)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) setDeleting(null) }}>
          <div className="card w-full rounded-t-2xl sm:max-w-sm sm:rounded-2xl animate-slide-up">
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--slate-100)' }}>
              <h2 className="text-base font-bold" style={{ color: 'var(--slate-900)' }}>Delete User</h2>
              <button onClick={() => setDeleting(null)} className="btn-motion rounded-lg p-1 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="px-5 py-5">
              <p className="text-sm" style={{ color: 'var(--slate-600)' }}>Are you sure you want to delete <strong>{deleting.username}</strong>?</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--slate-100)' }}>
              <button onClick={() => setDeleting(null)} className="btn-motion h-9 rounded-lg px-4 text-sm font-medium" style={{ color: 'var(--slate-600)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={pending} className="btn-motion h-9 rounded-lg px-4 text-sm font-semibold text-white" style={{ background: '#EF4444' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UserModal({
  user,
  departments,
  options,
  onClose,
  onSaved,
}: {
  user: User | null
  departments: string[]
  options: UserFormOptions
  onClose: () => void
  onSaved: (u: User, isNew: boolean) => void
}) {
  const isEdit = !!user
  const [username, setUsername] = useState(user?.username || '')
  const [email, setEmail] = useState(user?.email || '')
  const [role, setRole] = useState<UserRole>((user?.role as UserRole) || 'User')
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(splitCsv(user?.department || ''))
  const [password, setPassword] = useState('')
  const [selectedManagers, setSelectedManagers] = useState<string[]>(splitCsv(user?.manager_id || ''))
  const [selectedTeam, setSelectedTeam] = useState<string[]>(splitCsv(user?.team_members || ''))
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(splitCsv(user?.allowed_accounts))
  const [selectedReports, setSelectedReports] = useState<string[]>(splitCsv(user?.allowed_looker_reports))
  const [moduleAccess, setModuleAccess] = useState<ModuleAccess | null>(normalizeModuleAccess((user?.role as UserRole) || 'User', (user?.module_access || null) as ModuleAccess | null))
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(user?.email_notifications_enabled ?? true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function toggleValue(list: string[], value: string, setter: (next: string[]) => void) {
    if (list.includes(value)) setter(list.filter(v => v !== value))
    else setter([...list, value])
  }

  function replaceValues(setter: (next: string[]) => void, values: string[]) {
    setter(values)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const normalizedAccess = normalizeModuleAccess(role, moduleAccess)
    const payload = {
      username,
      email,
      role,
      department: selectedDepartments.join(', '),
      password,
      manager_id: selectedManagers.join(', '),
      team_members: selectedTeam.join(', '),
      allowed_accounts: selectedAccounts.join(', '),
      allowed_campaigns: '',
      allowed_drive_folders: '',
      allowed_looker_reports: selectedReports.join(', '),
      drive_access_level: 'none',
      module_access: normalizedAccess,
      email_notifications_enabled: emailNotificationsEnabled,
    }

    const res = isEdit ? await updateUser(username, payload) : await createUser(payload)
    if (res.success) {
      onSaved({
        ...user,
        username,
        email,
        role,
        department: selectedDepartments.join(', ') || null,
        manager_id: selectedManagers.join(', ') || null,
        team_members: selectedTeam.join(', '),
        allowed_accounts: selectedAccounts.join(', '),
        allowed_campaigns: '',
        allowed_drive_folders: '',
        allowed_looker_reports: selectedReports.join(', '),
        drive_access_level: 'none',
        module_access: normalizedAccess,
        email_notifications_enabled: emailNotificationsEnabled,
      } as User, !isEdit)
    } else {
      setError(res.error || 'Failed to save user.')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(15,23,42,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] sm:max-h-[94vh] sm:max-w-5xl sm:rounded-2xl animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3 shrink-0 sm:px-6 sm:py-4" style={{ borderBottom: '1px solid #1e293b', background: '#111827', color: '#fff' }}>
          <h2 className="flex items-center gap-2 text-base font-bold sm:text-xl"><UserPlus size={18} /> {isEdit ? `Edit: ${username}` : 'Add New User'}</h2>
          <button onClick={onClose} className="btn-motion rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.08)' }}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto bg-white p-4 sm:grid-cols-2 sm:gap-6 sm:p-6">
          {error && <div className="rounded-lg p-3 text-sm sm:col-span-2" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}

          <section className="space-y-4">
            <Field label="Username">
              <input value={username} onChange={e => setUsername(e.target.value)} disabled={isEdit} required placeholder="e.g. john.doe" className="h-11 w-full rounded-xl px-3 text-sm outline-none disabled:opacity-60" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
            </Field>

            <Field label="Registered Email(s)">
              <input value={email} onChange={e => setEmail(e.target.value)} required placeholder="e.g. user1@gmail.com, user2@company.com" className="h-11 w-full rounded-xl px-3 text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
            </Field>

            <Field label={`Password${isEdit ? ' (leave blank to keep)' : ''}`}>
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" required={!isEdit} placeholder="Enter password" className="h-11 w-full rounded-xl px-3 text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
            </Field>

            <Field label="Role">
              <select value={role} onChange={e => { const nextRole = e.target.value as UserRole; setRole(nextRole); setModuleAccess(current => normalizeModuleAccess(nextRole, current)) }} className="h-11 w-full rounded-xl px-3 text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>

            <MultiCheck
              title="Department(s)"
              helper="Managers can be in multiple departments"
              options={departments.map(d => ({ value: d, label: d }))}
              selected={selectedDepartments}
              onToggle={(value) => toggleValue(selectedDepartments, value, setSelectedDepartments)}
              onSelectAll={() => replaceValues(setSelectedDepartments, departments)}
              onClearAll={() => replaceValues(setSelectedDepartments, [])}
            />

            <MultiCheck
              title="Manager(s) (Optional)"
              helper="Select one or more managers for this user. Tasks assigned to this user will be visible to all selected managers."
              options={options.managers.filter(m => m.username !== username).map(m => ({ value: m.username, label: `${m.username} (${m.role})` }))}
              selected={selectedManagers}
              onToggle={(value) => toggleValue(selectedManagers, value, setSelectedManagers)}
              onSelectAll={() => replaceValues(setSelectedManagers, options.managers.filter(m => m.username !== username).map(m => m.username))}
              onClearAll={() => replaceValues(setSelectedManagers, [])}
            />

            <MultiCheck
              title="Team Members (Optional)"
              helper="Select users who will work under this user."
              options={options.teamMembers.filter(m => m.username !== username).map(m => ({ value: m.username, label: `${m.username} (${m.role}${m.department ? ` · ${m.department}` : ''})` }))}
              selected={selectedTeam}
              onToggle={(value) => toggleValue(selectedTeam, value, setSelectedTeam)}
              onSelectAll={() => replaceValues(setSelectedTeam, options.teamMembers.filter(m => m.username !== username).map(m => m.username))}
              onClearAll={() => replaceValues(setSelectedTeam, [])}
            />

            <div className="rounded-2xl p-4" style={{ background: '#eff6ff', border: '1px solid #93c5fd' }}>
              <p className="text-xs font-semibold" style={{ color: '#1d4ed8' }}>Auto-Available Modules</p>
              <p className="mt-1 text-xs leading-5" style={{ color: '#2563eb' }}>Todo module is available to all users. Package module is auto-enabled for Manager and Super Manager roles.</p>
            </div>
          </section>

          <section className="space-y-4">
            <MultiCheck
              title="Allowed Accounts"
              helper="If Google Account module is off, accounts are not accessible"
              options={options.accounts.map(a => ({ value: a.customer_id, label: a.account_name ? `${a.customer_id} · ${a.account_name}` : a.customer_id }))}
              selected={selectedAccounts}
              onToggle={(value) => toggleValue(selectedAccounts, value, setSelectedAccounts)}
              onSelectAll={() => replaceValues(setSelectedAccounts, options.accounts.map(a => a.customer_id))}
              onClearAll={() => replaceValues(setSelectedAccounts, [])}
            />

            <MultiCheck
              title="Allowed Looker Reports"
              helper="If Looker module is off, reports are not accessible"
              options={options.lookerReports.map(r => ({ value: r.id, label: r.title }))}
              selected={selectedReports}
              onToggle={(value) => toggleValue(selectedReports, value, setSelectedReports)}
              onSelectAll={() => replaceValues(setSelectedReports, options.lookerReports.map(r => r.id))}
              onClearAll={() => replaceValues(setSelectedReports, [])}
            />

            <ModuleAccessEditor moduleAccess={moduleAccess} setModuleAccess={setModuleAccess} />

            {isEdit && (
              <div className="rounded-2xl p-4" style={{ background: '#eff6ff', border: '1px solid #93c5fd' }}>
                <p className="text-xs font-semibold uppercase" style={{ color: '#1d4ed8' }}>Last Login</p>
                <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--slate-700)' }}>{user?.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</p>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--slate-600)' }}>
              <input type="checkbox" checked={emailNotificationsEnabled} onChange={e => setEmailNotificationsEnabled(e.target.checked)} />
              Email notifications enabled
            </label>
          </section>
        </form>

        <div className="flex gap-2 px-4 py-3 shrink-0 sm:px-6 sm:py-4" style={{ borderTop: '1px solid var(--slate-200)' }}>
          <button type="submit" onClick={() => { const form = document.querySelector('form'); if (form) form.requestSubmit() }} disabled={saving} className="btn-motion h-11 rounded-xl px-5 text-sm font-semibold text-white" style={{ background: '#059669' }}>
            {saving ? 'Saving...' : 'Save User'}
          </button>
          <button onClick={onClose} className="btn-motion h-11 rounded-xl px-5 text-sm font-medium" style={{ color: 'var(--slate-600)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>{label}</label>
      {children}
    </div>
  )
}

function MultiCheck({
  title,
  helper,
  options,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  title: string
  helper?: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  onToggle: (value: string) => void
  onSelectAll?: () => void
  onClearAll?: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>{title}</label>
        {options.length > 0 && (onSelectAll || onClearAll) && (
          <div className="flex items-center gap-3 text-[11px] font-semibold">
            {onSelectAll && <button type="button" onClick={onSelectAll} style={{ color: '#2563eb' }}>Select All</button>}
            {onClearAll && <button type="button" onClick={onClearAll} style={{ color: '#64748b' }}>Deselect All</button>}
          </div>
        )}
      </div>
      <div className="mt-1 max-h-44 overflow-y-auto rounded-xl p-2" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
        {options.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--slate-400)' }}>No options</p>
        ) : options.map(o => (
          <label key={o.value} className="flex items-center gap-2 px-1.5 py-1.5 text-sm" style={{ color: 'var(--slate-700)' }}>
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {helper && <p className="mt-1 text-xs" style={{ color: 'var(--slate-400)' }}>{helper}</p>}
    </div>
  )
}

function ModuleAccessEditor({ moduleAccess, setModuleAccess }: { moduleAccess: ModuleAccess | null; setModuleAccess: (next: ModuleAccess | null) => void }) {
  function setEnabled(key: keyof ModuleAccess, enabled: boolean) {
    const next = { ...(moduleAccess || {}) }
    if (key === 'googleAccount') next.googleAccount = { enabled, accessLevel: 'all' }
    if (key === 'users') next.users = { enabled, departmentRestricted: true }
    if (key === 'looker') next.looker = { enabled }
    if (key === 'todos') next.todos = { enabled: true }
    if (key === 'packages') next.packages = { enabled }
    setModuleAccess(next)
  }

  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--slate-200)', background: '#fff' }}>
      <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Module Access</p>
      <div className="grid grid-cols-2 gap-2 text-sm" style={{ color: 'var(--slate-700)' }}>
        {[
          ['googleAccount', 'Google Accounts'],
          ['users', 'Users'],
          ['looker', 'Looker Reports'],
          ['todos', 'Tasks'],
          ['packages', 'Packages'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={key === 'todos' ? true : Boolean((moduleAccess as Record<string, { enabled?: boolean }> | null)?.[key]?.enabled)}
              disabled={key === 'todos'}
              onChange={e => setEnabled(key as keyof ModuleAccess, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
