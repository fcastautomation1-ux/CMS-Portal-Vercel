'use client'

import { useMemo, useState, useTransition } from 'react'
import Image from 'next/image'
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
  function openCreate() { setEditing(null); setModalOpen(true) }

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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Users</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{users.length} users total</p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="btn-motion h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
            style={{ background: 'var(--blue-600)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
          >
            <Plus size={16} /> Add User
          </button>
        )}
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none flex-1 min-w-[120px]" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
            <option value="">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none flex-1 min-w-[120px]" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
              {['User', 'Email', 'Role', 'Department(s)', 'Last Login', 'Actions'].map(h => (
                <th key={h} className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.username} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    {u.avatar_data ? (
                      <Image src={u.avatar_data} alt={u.username} width={36} height={36} className="w-9 h-9 rounded-lg object-cover" unoptimized />
                    ) : (
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--blue-600)' }}>
                        {initials(u.username)}
                      </div>
                    )}
                    <span className="font-medium" style={{ color: 'var(--slate-900)' }}>{u.username}</span>
                  </div>
                </td>
                <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{u.email}</td>
                <td className="px-5 py-3">
                  <span className={cn('text-xs font-medium px-2 py-1 rounded-full', ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-600')}>{u.role}</span>
                </td>
                <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{u.department || '—'}</td>
                <td className="px-5 py-3 text-xs" style={{ color: 'var(--slate-500)' }}>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                <td className="px-5 py-3">
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} className="btn-motion p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                      {u.username !== 'admin' && (
                        <button onClick={() => setDeleting(u)} className="btn-motion p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
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

      {modalOpen && (
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) setDeleting(null) }}>
          <div className="card w-full sm:rounded-2xl rounded-t-2xl sm:max-w-sm animate-slide-up">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)' }}>
              <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>Delete User</h2>
              <button onClick={() => setDeleting(null)} className="btn-motion p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="px-5 py-5">
              <p className="text-sm" style={{ color: 'var(--slate-600)' }}>Are you sure you want to delete <strong>{deleting.username}</strong>?</p>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--slate-100)' }}>
              <button onClick={() => setDeleting(null)} className="btn-motion h-9 px-4 rounded-lg text-sm font-medium" style={{ color: 'var(--slate-600)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={pending} className="btn-motion h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: '#EF4444' }}>Delete</button>
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
  const [managerId, setManagerId] = useState(user?.manager_id || '')
  const [selectedTeam, setSelectedTeam] = useState<string[]>(splitCsv(user?.team_members || ''))

  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(splitCsv(user?.allowed_accounts))
  const [selectedReports, setSelectedReports] = useState<string[]>(splitCsv(user?.allowed_looker_reports))
  const [driveAccessLevel, setDriveAccessLevel] = useState(user?.drive_access_level || 'none')
  const [driveFolders, setDriveFolders] = useState(user?.allowed_drive_folders || '')

  const initialAccess = (user?.module_access || null) as ModuleAccess | null
  const [moduleAccess, setModuleAccess] = useState<ModuleAccess | null>(initialAccess)

  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(user?.email_notifications_enabled ?? true)

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function toggleInList(list: string[], value: string, setter: (next: string[]) => void) {
    if (list.includes(value)) setter(list.filter(v => v !== value))
    else setter([...list, value])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      username,
      email,
      role,
      department: selectedDepartments.join(', '),
      password,
      manager_id: managerId,
      team_members: selectedTeam.join(', '),
      allowed_accounts: selectedAccounts.join(', '),
      allowed_campaigns: '',
      allowed_drive_folders: driveFolders,
      allowed_looker_reports: selectedReports.join(', '),
      drive_access_level: driveAccessLevel,
      module_access: moduleAccess,
      email_notifications_enabled: emailNotificationsEnabled,
    }

    const res = isEdit
      ? await updateUser(username, payload)
      : await createUser(payload)

    if (res.success) {
      const nextUser = {
        ...user,
        username,
        email,
        role,
        department: selectedDepartments.join(', ') || null,
        manager_id: managerId || null,
        team_members: selectedTeam.join(', '),
        allowed_accounts: selectedAccounts.join(', '),
        allowed_looker_reports: selectedReports.join(', '),
        drive_access_level: driveAccessLevel,
        allowed_drive_folders: driveFolders,
        module_access: moduleAccess,
        email_notifications_enabled: emailNotificationsEnabled,
      } as User
      onSaved(nextUser, !isEdit)
    } else {
      setError(res.error || 'Failed to save user.')
    }

    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="glass-strong w-full sm:rounded-2xl rounded-t-2xl sm:max-w-5xl max-h-[95vh] sm:max-h-[94vh] flex flex-col overflow-hidden animate-slide-up">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--slate-200)', background: '#0f172a', color: '#fff' }}>
          <h2 className="font-bold text-base sm:text-xl flex items-center gap-2"><UserPlus size={18} /> {isEdit ? `Edit: ${username}` : 'Add New User'}</h2>
          <button onClick={onClose} className="btn-motion p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.1)' }}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {error && <div className="lg:col-span-2 text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}

          <section className="space-y-4">
            <Field label="Username">
              <input value={username} onChange={e => setUsername(e.target.value)} disabled={isEdit} required className="h-10 px-3 rounded-lg text-sm outline-none w-full disabled:opacity-60" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
            </Field>

            <Field label="Registered Email(s)">
              <input value={email} onChange={e => setEmail(e.target.value)} required className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} placeholder="user1@gmail.com, user2@company.com" />
            </Field>

            <Field label={`Password${isEdit ? ' (leave blank to keep)' : ''}`}>
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" required={!isEdit} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} />
            </Field>

            <Field label="Role">
              <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>

            <MultiCheck
              title="Department(s)"
              helper="Managers can be in multiple departments"
              options={departments.map(d => ({ value: d, label: d }))}
              selected={selectedDepartments}
              onToggle={(v) => toggleInList(selectedDepartments, v, setSelectedDepartments)}
            />

            <Field label="Manager(s)">
              <select value={managerId} onChange={e => setManagerId(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
                <option value="">None</option>
                {options.managers.map(m => <option key={m.username} value={m.username}>{m.username} ({m.role})</option>)}
              </select>
            </Field>

            <MultiCheck
              title="Team Members (Optional)"
              options={options.teamMembers.filter(m => m.username !== username).map(m => ({ value: m.username, label: `${m.username} (${m.role}${m.department ? ` · ${m.department}` : ''})` }))}
              selected={selectedTeam}
              onToggle={(v) => toggleInList(selectedTeam, v, setSelectedTeam)}
            />

            <div className="rounded-lg p-3" style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-200)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--blue-700)' }}>Auto-Available Modules</p>
              <p className="text-xs mt-1" style={{ color: 'var(--blue-700)' }}>Todo module is available to all users. Package module is auto-enabled for Manager and Super Manager roles.</p>
            </div>
          </section>

          <section className="space-y-4">
            <MultiCheck
              title="Allowed Accounts"
              helper="If Google Account module is off, accounts are not accessible"
              options={options.accounts.map(a => ({ value: a.customer_id, label: a.account_name ? `${a.customer_id} · ${a.account_name}` : a.customer_id }))}
              selected={selectedAccounts}
              onToggle={(v) => toggleInList(selectedAccounts, v, setSelectedAccounts)}
            />

            <Field label="Allowed Drive Access Level">
              <select value={driveAccessLevel} onChange={e => setDriveAccessLevel(e.target.value as 'none' | 'view' | 'upload' | 'full')} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
                <option value="none">None</option>
                <option value="view">Viewer (Read Only)</option>
                <option value="upload">Editor (Upload/Edit)</option>
                <option value="full">Full</option>
              </select>
            </Field>

            <Field label="Allowed Drive Folders / Files">
              <textarea value={driveFolders} onChange={e => setDriveFolders(e.target.value)} rows={3} className="px-3 py-2 rounded-lg text-sm outline-none w-full" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }} placeholder="Comma-separated folder IDs or paths" />
            </Field>

            <MultiCheck
              title="Allowed Looker Reports"
              helper="If Looker module is off, reports are not accessible"
              options={options.lookerReports.map(r => ({ value: r.id, label: r.title }))}
              selected={selectedReports}
              onToggle={(v) => toggleInList(selectedReports, v, setSelectedReports)}
            />

            <ModuleAccessEditor moduleAccess={moduleAccess} setModuleAccess={setModuleAccess} />

            {isEdit && (
              <div className="rounded-lg p-3" style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-200)' }}>
                <p className="text-xs uppercase font-semibold" style={{ color: 'var(--blue-700)' }}>Last Login</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--slate-700)' }}>{user?.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</p>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--slate-600)' }}>
              <input type="checkbox" checked={emailNotificationsEnabled} onChange={e => setEmailNotificationsEnabled(e.target.checked)} />
              Email notifications enabled
            </label>
          </section>
        </form>

        <div className="px-4 sm:px-6 py-3 sm:py-4 flex gap-2 shrink-0" style={{ borderTop: '1px solid var(--slate-200)' }}>
          <button type="submit" onClick={() => { const form = document.querySelector('form'); if (form) form.requestSubmit() }} disabled={saving} className="btn-motion h-10 px-5 rounded-lg text-sm font-semibold text-white" style={{ background: '#059669' }}>
            {saving ? 'Saving...' : 'Save User'}
          </button>
          <button onClick={onClose} className="btn-motion h-10 px-5 rounded-lg text-sm font-medium" style={{ color: 'var(--slate-600)' }}>
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

function MultiCheck({ title, helper, options, selected, onToggle }: { title: string; helper?: string; options: Array<{ value: string; label: string }>; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div>
      <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>{title}</label>
      <div className="mt-1 rounded-lg p-2 max-h-44 overflow-y-auto" style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}>
        {options.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--slate-400)' }}>No options</p>
        ) : options.map(o => (
          <label key={o.value} className="flex items-center gap-2 px-1.5 py-1.5 text-sm" style={{ color: 'var(--slate-700)' }}>
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {helper && <p className="text-xs mt-1" style={{ color: 'var(--slate-400)' }}>{helper}</p>}
    </div>
  )
}

function ModuleAccessEditor({ moduleAccess, setModuleAccess }: { moduleAccess: ModuleAccess | null; setModuleAccess: (next: ModuleAccess | null) => void }) {
  function setEnabled(key: keyof ModuleAccess, enabled: boolean) {
    const next = { ...(moduleAccess || {}) }
    if (key === 'googleAccount') next.googleAccount = { enabled, accessLevel: 'all' }
    if (key === 'users') next.users = { enabled, departmentRestricted: true }
    if (key === 'looker') next.looker = { enabled }
    if (key === 'drive') next.drive = { enabled }
    if (key === 'todos') next.todos = { enabled }
    if (key === 'packages') next.packages = { enabled }
    setModuleAccess(next)
  }

  return (
    <div className="rounded-lg p-3" style={{ border: '1px solid var(--slate-200)', background: '#fff' }}>
      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--slate-500)' }}>Module Access</p>
      <div className="grid grid-cols-2 gap-2 text-sm" style={{ color: 'var(--slate-700)' }}>
        {[
          ['googleAccount', 'Google Accounts'],
          ['users', 'Users'],
          ['drive', 'Drive'],
          ['looker', 'Looker Reports'],
          ['todos', 'Tasks'],
          ['packages', 'Packages'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean((moduleAccess as Record<string, { enabled?: boolean }> | null)?.[key]?.enabled)}
              onChange={e => setEnabled(key as keyof ModuleAccess, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
