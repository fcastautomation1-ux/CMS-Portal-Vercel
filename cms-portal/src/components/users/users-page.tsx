'use client'

import { useState, useMemo, useTransition } from 'react'
import { Search, Plus, Trash2, Pencil, X } from 'lucide-react'
import { createUser, updateUser, deleteUser } from '@/app/dashboard/users/actions'
import type { User, SessionUser, UserRole } from '@/types'
import { cn } from '@/lib/cn'

const ROLES: UserRole[] = ['Admin', 'Super Manager', 'Manager', 'Supervisor', 'User']

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-purple-100 text-purple-700',
  'Super Manager': 'bg-blue-100 text-blue-700',
  Manager: 'bg-sky-100 text-sky-700',
  Supervisor: 'bg-teal-100 text-teal-700',
  User: 'bg-slate-100 text-slate-600',
}

interface Props { users: User[]; departments: string[]; currentUser: SessionUser }

export function UsersPage({ users: initial, departments, currentUser }: Props) {
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
    if (deptFilter) list = list.filter(u => u.department === deptFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Users</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{users.length} users total</p>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
            <Plus size={16} /> Add User
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-60">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}>
            <option value="">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
              {['Username', 'Email', 'Role', 'Department', 'Last Login', 'Actions'].map(h => (
                <th key={h} className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.username} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium" style={{ color: 'var(--slate-900)' }}>{u.username}</span>
                  </div>
                </td>
                <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{u.email}</td>
                <td className="px-5 py-3">
                  <span className={cn('text-xs font-medium px-2 py-1 rounded-full', ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-600')}>{u.role}</span>
                </td>
                <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{u.department || '—'}</td>
                <td className="px-5 py-3 text-xs" style={{ color: 'var(--slate-400)' }}>{u.last_login ? new Date(u.last_login).toLocaleDateString() : '—'}</td>
                <td className="px-5 py-3">
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                      {u.username !== 'admin' && (
                        <button onClick={() => setDeleting(u)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
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

      {/* User Modal */}
      {modalOpen && (
        <UserModal
          user={editing} departments={departments}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={(u, isNew) => {
            if (isNew) setUsers(prev => [...prev, u])
            else setUsers(prev => prev.map(x => x.username === u.username ? u : x))
            setModalOpen(false); setEditing(null)
          }}
        />
      )}

      {/* Delete Confirm */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setDeleting(null) }}>
          <div className="rounded-2xl w-full max-w-sm animate-slide-up" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)' }}>
              <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>Delete User</h2>
              <button onClick={() => setDeleting(null)} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm" style={{ color: 'var(--slate-600)' }}>Are you sure you want to delete <strong>{deleting.username}</strong>? This action cannot be undone.</p>
            </div>
            <div className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--slate-100)' }}>
              <button onClick={() => setDeleting(null)} className="h-9 px-4 rounded-lg text-sm font-medium" style={{ color: 'var(--slate-600)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={pending} className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: '#EF4444' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── User Modal ──────────────────────────────────────────────────
function UserModal({ user, departments, onClose, onSaved }: { user: User | null; departments: string[]; onClose: () => void; onSaved: (u: User, isNew: boolean) => void }) {
  const isEdit = !!user
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    role: user?.role || 'User',
    department: user?.department || '',
    password: '',
    allowed_accounts: user?.allowed_accounts || '',
    allowed_campaigns: user?.allowed_campaigns || '',
    allowed_drive_folders: user?.allowed_drive_folders || '',
    allowed_looker_reports: user?.allowed_looker_reports || '',
    drive_access_level: user?.drive_access_level || 'none',
    manager_id: user?.manager_id || '',
    email_notifications_enabled: user?.email_notifications_enabled ?? true,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = isEdit
      ? await updateUser(form.username, { ...form })
      : await createUser({ ...form })
    if (res.success) {
      onSaved({ ...user!, ...form, department: form.department || null, manager_id: form.manager_id || null } as unknown as User, !isEdit)
    } else { setError(res.error || 'Failed to save.') }
    setSaving(false)
  }

  const set = (k: string, v: string | boolean) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-slide-up" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-6 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Username</label>
              <input value={form.username} onChange={e => set('username', e.target.value)} disabled={isEdit} required className="h-9 px-3 rounded-lg text-sm outline-none disabled:opacity-50" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Email</label>
              <input value={form.email} onChange={e => set('email', e.target.value)} type="email" required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Role</label>
              <select value={form.role} onChange={e => set('role', e.target.value)} className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Department</label>
              <select value={form.department} onChange={e => set('department', e.target.value)} className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}>
                <option value="">None</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Password {isEdit && '(leave blank to keep)'}</label>
            <input value={form.password} onChange={e => set('password', e.target.value)} type="password" required={!isEdit} className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Manager ID</label>
            <input value={form.manager_id} onChange={e => set('manager_id', e.target.value)} placeholder="Username of manager" className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Drive Access Level</label>
              <select value={form.drive_access_level} onChange={e => set('drive_access_level', e.target.value)} className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}>
                {['none', 'view', 'upload', 'full'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.email_notifications_enabled} onChange={e => set('email_notifications_enabled', e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: '#2563EB' }} />
                <span className="text-sm" style={{ color: 'var(--slate-600)' }}>Email Notifications</span>
              </label>
            </div>
          </div>
        </form>
        <div className="px-6 py-4 flex justify-end gap-2 shrink-0" style={{ borderTop: '1px solid var(--slate-100)' }}>
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-medium" style={{ color: 'var(--slate-600)' }}>Cancel</button>
          <button onClick={(e) => { (e.currentTarget.closest('div')?.previousElementSibling?.previousElementSibling as HTMLFormElement)?.requestSubmit() }} disabled={saving} className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}
