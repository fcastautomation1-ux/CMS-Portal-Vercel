'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, UserPlus } from 'lucide-react'
import { createUser, type UserFormOptions } from '@/app/dashboard/users/actions'
import type { ModuleAccess, SessionUser, UserRole } from '@/types'

const ROLES: UserRole[] = ['Admin', 'Super Manager', 'Manager', 'Supervisor', 'User']

interface Props {
  departments: string[]
  currentUser: SessionUser
  options: UserFormOptions
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

export function NewUserPage({ departments, options }: Props) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('User')
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [selectedManagers, setSelectedManagers] = useState<string[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [selectedReports, setSelectedReports] = useState<string[]>([])
  const [moduleAccess, setModuleAccess] = useState<ModuleAccess | null>(normalizeModuleAccess('User', null))
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function toggleValue(list: string[], value: string, setter: (next: string[]) => void) {
    if (list.includes(value)) setter(list.filter(v => v !== value))
    else setter([...list, value])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const normalizedAccess = normalizeModuleAccess(role, moduleAccess)
    const res = await createUser({
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
    })

    if (res.success) {
      router.push('/dashboard/users')
      router.refresh()
      return
    }

    setError(res.error || 'Failed to save user.')
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2">
            <Link href="/dashboard/users" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-700">
              <ArrowLeft size={15} />
              Back to Users
            </Link>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <UserPlus size={22} />
            Add New User
          </h1>
          <p className="mt-1 text-sm text-slate-500">Create a new portal user with modules, managers, team members, accounts, and reports.</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-200 bg-[#111827] px-5 py-4 text-white sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">User Details</h2>
              <p className="mt-1 text-sm text-white/70">This page replaces the popup and uses the same add-user logic as before, without Drive.</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-2 sm:p-6">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 sm:col-span-2">{error}</div>}

          <section className="space-y-4">
            <Field label="Username">
              <input value={username} onChange={e => setUsername(e.target.value)} required placeholder="e.g. john.doe" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none" />
            </Field>

            <Field label="Registered Email(s)">
              <input value={email} onChange={e => setEmail(e.target.value)} required placeholder="e.g. user1@gmail.com, user2@company.com" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none" />
            </Field>

            <Field label="Password">
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" required placeholder="Enter password" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none" />
            </Field>

            <Field label="Role">
              <select
                value={role}
                onChange={e => {
                  const nextRole = e.target.value as UserRole
                  setRole(nextRole)
                  setModuleAccess(current => normalizeModuleAccess(nextRole, current))
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>

            <MultiCheck
              title="Department(s)"
              helper="Managers can be in multiple departments."
              options={departments.map(d => ({ value: d, label: d }))}
              selected={selectedDepartments}
              onToggle={(value) => toggleValue(selectedDepartments, value, setSelectedDepartments)}
              onSelectAll={() => setSelectedDepartments(departments)}
              onClearAll={() => setSelectedDepartments([])}
            />

            <MultiCheck
              title="Manager(s) (Optional)"
              helper="Tasks assigned to this user will be visible to all selected managers."
              options={options.managers.filter(m => m.username !== username).map(m => ({ value: m.username, label: `${m.username} (${m.role})` }))}
              selected={selectedManagers}
              onToggle={(value) => toggleValue(selectedManagers, value, setSelectedManagers)}
              onSelectAll={() => setSelectedManagers(options.managers.filter(m => m.username !== username).map(m => m.username))}
              onClearAll={() => setSelectedManagers([])}
            />

            <MultiCheck
              title="Team Members (Optional)"
              helper="Select users who will work under this user."
              options={options.teamMembers.filter(m => m.username !== username).map(m => ({ value: m.username, label: `${m.username} (${m.role}${m.department ? ` · ${m.department}` : ''})` }))}
              selected={selectedTeam}
              onToggle={(value) => toggleValue(selectedTeam, value, setSelectedTeam)}
              onSelectAll={() => setSelectedTeam(options.teamMembers.filter(m => m.username !== username).map(m => m.username))}
              onClearAll={() => setSelectedTeam([])}
            />

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold text-blue-700">Auto-Available Modules</p>
              <p className="mt-1 text-xs leading-5 text-blue-600">Todo module is available to all users. Package module is auto-enabled for Manager and Super Manager roles.</p>
            </div>
          </section>

          <section className="space-y-4">
            <MultiCheck
              title="Allowed Accounts"
              helper="If Google Account module is off, accounts are not accessible."
              options={options.accounts.map(a => ({ value: a.customer_id, label: a.account_name ? `${a.customer_id} · ${a.account_name}` : a.customer_id }))}
              selected={selectedAccounts}
              onToggle={(value) => toggleValue(selectedAccounts, value, setSelectedAccounts)}
              onSelectAll={() => setSelectedAccounts(options.accounts.map(a => a.customer_id))}
              onClearAll={() => setSelectedAccounts([])}
            />

            <MultiCheck
              title="Allowed Looker Reports"
              helper="If Looker module is off, reports are not accessible."
              options={options.lookerReports.map(r => ({ value: r.id, label: r.title }))}
              selected={selectedReports}
              onToggle={(value) => toggleValue(selectedReports, value, setSelectedReports)}
              onSelectAll={() => setSelectedReports(options.lookerReports.map(r => r.id))}
              onClearAll={() => setSelectedReports([])}
            />

            <ModuleAccessEditor moduleAccess={moduleAccess} setModuleAccess={setModuleAccess} />

            <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <input type="checkbox" checked={emailNotificationsEnabled} onChange={e => setEmailNotificationsEnabled(e.target.checked)} />
              Email notifications enabled
            </label>
          </section>

          <div className="flex gap-3 sm:col-span-2">
            <button type="submit" disabled={saving} className="btn-motion h-11 rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white">
              {saving ? 'Saving...' : 'Save User'}
            </button>
            <Link href="/dashboard/users" className="btn-motion inline-flex h-11 items-center rounded-xl px-6 text-sm font-medium text-slate-600">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
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
        <label className="text-xs font-semibold text-slate-500">{title}</label>
        {options.length > 0 && (
          <div className="flex items-center gap-3 text-[11px] font-semibold">
            {onSelectAll && <button type="button" onClick={onSelectAll} className="text-blue-600">Select All</button>}
            {onClearAll && <button type="button" onClick={onClearAll} className="text-slate-500">Deselect All</button>}
          </div>
        )}
      </div>
      <div className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
        {options.length === 0 ? (
          <p className="text-xs text-slate-400">No options</p>
        ) : options.map(option => (
          <label key={option.value} className="flex items-center gap-2 px-1.5 py-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {helper && <p className="mt-1 text-xs text-slate-400">{helper}</p>}
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold text-slate-500">Module Access</p>
      <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
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
