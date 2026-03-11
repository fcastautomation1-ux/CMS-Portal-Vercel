'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Search, RefreshCw, Upload, CheckSquare, Square, Users, Building2, Check } from 'lucide-react'
import {
  addPackagesBulk,
  getPackageAssignmentUsers,
  getUserPackageAssignments,
  savePackage,
  bulkAssignDepartments,
  bulkAssignPackagesToUsers,
} from '@/app/dashboard/packages/actions'
import type { Package, SessionUser } from '@/types'

interface Props { packages: Package[]; user: SessionUser }

type AssignmentRow = { username: string; package_id: string }
type UserRow = { username: string; role: string; department: string | null }

export function PackagesPage({ packages: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const router = useRouter()

  const packages = initial
  const [users, setUsers] = useState<UserRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])

  const [packageSearch, setPackageSearch] = useState('')

  // Bulk-edit: row selection
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [bulkDeptOpen, setBulkDeptOpen] = useState(false)
  const [bulkUsersOpen, setBulkUsersOpen] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [userRows, assignmentRows] = await Promise.all([
        getPackageAssignmentUsers(),
        getUserPackageAssignments(),
      ])
      if (cancelled) return
      setUsers(userRows)
      setAssignments(assignmentRows)
    })()
    return () => { cancelled = true }
  }, [])

  const departments = useMemo(() => {
    return Array.from(new Set(users.map(u => (u.department || '').trim()).filter(Boolean))).sort()
  }, [users])

  const filteredPackages = useMemo(() => {
    const q = packageSearch.trim().toLowerCase()
    if (!q) return packages
    return packages.filter(pkg => {
      const blob = [
        pkg.app_name || '',
        pkg.name || '',
        pkg.playconsole_account || '',
        pkg.marketer || '',
        pkg.product_owner || '',
        pkg.monetization || '',
        pkg.admob || '',
        pkg.department || '',
        pkg.description || '',
      ].join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [packages, packageSearch])

  const assignedByPackage = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const row of assignments) {
      if (!map[row.package_id]) map[row.package_id] = []
      map[row.package_id].push(row.username)
    }
    return map
  }, [assignments])

  // Row selection helpers
  const allRowsSelected = filteredPackages.length > 0 && filteredPackages.every(p => selectedRows.has(p.id))
  function toggleAllRows() {
    if (allRowsSelected) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(filteredPackages.map(p => p.id)))
    }
  }
  function toggleRow(id: string) {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function openAddModal() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEditModal(pkg: Package) {
    setEditing(pkg)
    setModalOpen(true)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Package Management</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>Manage packages and assign them to users</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={openAddModal} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: '#16A34A' }}>
              <Plus size={16} /> Add Package
            </button>
            <button onClick={() => setBulkOpen(true)} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: '#2563EB' }}>
              <Upload size={16} /> Bulk Import
            </button>
            <button onClick={() => router.refresh()} className="h-10 px-4 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: '#F1F5F9', color: '#334155' }}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={packageSearch}
            onChange={e => setPackageSearch(e.target.value)}
            placeholder="Search package name..."
            className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
            style={{ border: '1px solid #E2E8F0', background: '#fff' }}
          />
        </div>
        <span className="text-xs font-semibold" style={{ color: '#64748B' }}>{filteredPackages.length} / {packages.length} packages</span>
      </div>

      {/* ── Bulk action bar ─────────────────────────────── */}
      {canEdit && selectedRows.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl mb-4 animate-fade-in"
          style={{ background: 'rgba(37,99,235,0.06)', border: '1.5px solid rgba(37,99,235,0.2)' }}
        >
          <CheckSquare size={16} style={{ color: '#2563EB' }} />
          <span className="text-sm font-semibold" style={{ color: '#2563EB' }}>
            {selectedRows.size} package{selectedRows.size !== 1 ? 's' : ''} selected
          </span>
          <div className="h-4 w-px" style={{ background: 'rgba(37,99,235,0.3)' }} />
          <button
            onClick={() => setBulkDeptOpen(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-white"
            style={{ background: '#0D9488' }}
          >
            <Building2 size={13} /> Assign Departments
          </button>
          <button
            onClick={() => setBulkUsersOpen(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-white"
            style={{ background: '#7C3AED' }}
          >
            <Users size={13} /> Assign to Users
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="ml-auto text-xs"
            style={{ color: '#64748B' }}
          >
            Clear
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              {canEdit && <col style={{ width: 32 }} />}
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {canEdit && (
                  <th className="px-2 py-2.5 w-8">
                    <button
                      type="button"
                      onClick={toggleAllRows}
                      className="flex items-center justify-center"
                      title={allRowsSelected ? 'Deselect all' : 'Select all'}
                    >
                      {allRowsSelected
                        ? <CheckSquare size={14} style={{ color: '#2563EB' }} />
                        : <Square size={14} style={{ color: '#CBD5E1' }} />}
                    </button>
                  </th>
                )}
                {['APP/Games Name', 'Package Name', 'Playconsole', 'Marketer', 'Prod. Owner', 'Monetization', 'Admob', 'Dept.', 'Assigned Users', 'Actions'].map(h => (
                  <th key={h} className="text-left px-2 py-2.5 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap overflow-hidden" style={{ color: '#64748B' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPackages.length === 0 ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="px-4 py-12 text-center text-sm" style={{ color: '#94A3B8' }}>No packages match your search.</td></tr>
              ) : (
                filteredPackages.map(pkg => {
                  const assignedUsers = assignedByPackage[pkg.id] || []
                  const rowSelected = selectedRows.has(pkg.id)
                  return (
                    <tr key={pkg.id} className="group" style={{ borderBottom: '1px solid #F1F5F9', background: rowSelected ? 'rgba(37,99,235,0.04)' : undefined }}>
                      {canEdit && (
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => toggleRow(pkg.id)}
                            className="flex items-center justify-center"
                          >
                            {rowSelected
                              ? <CheckSquare size={14} style={{ color: '#2563EB' }} />
                              : <Square size={14} style={{ color: '#CBD5E1' }} />}
                          </button>
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <span className="block truncate font-semibold" style={{ color: '#1E293B' }} title={pkg.app_name || ''}>
                          {pkg.app_name || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" style={{ color: '#64748B' }} title={pkg.name}>
                          {pkg.name}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={pkg.playconsole_account || ''}>
                          {pkg.playconsole_account || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={pkg.marketer || ''}>{pkg.marketer || '—'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={pkg.product_owner || ''}>{pkg.product_owner || '—'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={pkg.monetization || ''}>{pkg.monetization || '—'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={pkg.admob || ''}>{pkg.admob || '—'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="block truncate" title={pkg.department || ''}>{pkg.department || '—'}</span>
                      </td>
                      <td className="px-2 py-2">
                        {assignedUsers.length === 0 ? (
                          <span style={{ color: '#94A3B8' }}>—</span>
                        ) : (
                          <div className="flex flex-wrap gap-0.5">
                            {assignedUsers.slice(0, 2).map(u => (
                              <span key={`${pkg.id}-${u}`} className="px-1.5 py-0.5 rounded-full text-[10px] truncate max-w-17.5" style={{ background: '#EEF2FF', color: '#6366F1' }} title={u}>{u}</span>
                            ))}
                            {assignedUsers.length > 2 && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: '#F1F5F9', color: '#64748B' }} title={assignedUsers.slice(2).join(', ')}>+{assignedUsers.length - 2}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => openEditModal(pkg)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: 'rgba(59,130,246,0.12)', color: '#2563EB' }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <PackageModal
          pkg={editing}
          departments={departments}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={async () => {
            router.refresh()
            setModalOpen(false)
            setEditing(null)
          }}
        />
      )}

      {bulkOpen && (
        <BulkImportModal
          departments={departments}
          onClose={() => setBulkOpen(false)}
          onSaved={async () => {
            router.refresh()
            setBulkOpen(false)
          }}
        />
      )}

      {bulkDeptOpen && canEdit && (
        <BulkDeptModal
          selectedPackageIds={Array.from(selectedRows)}
          departments={departments}
          onClose={() => setBulkDeptOpen(false)}
          onSaved={async () => {
            router.refresh()
            setBulkDeptOpen(false)
            setSelectedRows(new Set())
          }}
        />
      )}

      {bulkUsersOpen && canEdit && (
        <BulkUsersModal
          selectedPackageIds={Array.from(selectedRows)}
          users={users}
          onClose={() => setBulkUsersOpen(false)}
          onSaved={async () => {
            const refreshed = await getUserPackageAssignments()
            setAssignments(refreshed)
            setBulkUsersOpen(false)
            setSelectedRows(new Set())
          }}
        />
      )}
    </div>
  )
}

function PackageModal({
  pkg,
  departments,
  onClose,
  onSaved,
}: {
  pkg: Package | null
  departments: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!pkg

  const [name, setName] = useState(pkg?.name || '')
  const [appName, setAppName] = useState(pkg?.app_name || '')
  const [playconsole, setPlayconsole] = useState(pkg?.playconsole_account || '')
  const [marketer, setMarketer] = useState(pkg?.marketer || '')
  const [productOwner, setProductOwner] = useState(pkg?.product_owner || '')
  const [monetization, setMonetization] = useState(pkg?.monetization || '')
  const [admob, setAdmob] = useState(pkg?.admob || '')
  const [description, setDescription] = useState(pkg?.description || '')
  const [selectedDepts, setSelectedDepts] = useState<string[]>(pkg?.department ? pkg.department.split(',').map(d => d.trim()).filter(Boolean) : [])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDept(dept: string) {
    setSelectedDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    const res = await savePackage({
      id: pkg?.id,
      name,
      app_name: appName,
      playconsole_account: playconsole,
      marketer,
      product_owner: productOwner,
      monetization,
      admob,
      description,
      department: selectedDepts.join(', '),
    })

    if (!res.success) {
      setError(res.error || 'Failed to save package.')
      setSaving(false)
      return
    }

    await onSaved()
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" style={{ background: '#fff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <h2 className="font-bold text-base" style={{ color: '#0F172A' }}>{isEdit ? 'Edit App Name' : 'Add New App Name'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}

          <Field label="APP/Games Name *">
            <input value={appName} onChange={e => setAppName(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Package Name *">
            <input value={name} onChange={e => setName(e.target.value)} disabled={isEdit} className="h-10 px-3 rounded-lg text-sm outline-none w-full disabled:bg-slate-100" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Playconsole Account Name">
            <input value={playconsole} onChange={e => setPlayconsole(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Marketer">
            <input value={marketer} onChange={e => setMarketer(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Product Owner">
            <input value={productOwner} onChange={e => setProductOwner(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Monitization">
            <input value={monetization} onChange={e => setMonetization(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Admob">
            <input value={admob} onChange={e => setAdmob(e.target.value)} className="h-10 px-3 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="px-3 py-2 rounded-lg text-sm outline-none w-full" style={{ border: '1px solid #CBD5E1' }} />
          </Field>

          <Field label="Departments">
            <div className="rounded-lg p-2 max-h-32 overflow-y-auto" style={{ border: '1px solid #CBD5E1' }}>
              {departments.map(dept => (
                <label key={dept} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={selectedDepts.includes(dept)} onChange={() => toggleDept(dept)} />
                  <span>{dept}</span>
                </label>
              ))}
            </div>
          </Field>

          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm" style={{ color: '#64748B' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: '#16A34A', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : isEdit ? 'Update App Name' : 'Save App Name'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BulkImportModal({
  departments,
  onClose,
  onSaved,
}: {
  departments: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedDepts, setSelectedDepts] = useState<string[]>([])
  const [rawText, setRawText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDept(dept: string) {
    setSelectedDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
  }

  function parseInput(text: string): string[] {
    return text
      .split(/\r?\n|,|;/)
      .map(x => x.trim())
      .filter(Boolean)
  }

  async function handleImport() {
    const names = parseInput(rawText)
    if (names.length === 0) {
      setError('Please paste at least one package name.')
      return
    }

    setSaving(true)
    setError('')
    const res = await addPackagesBulk(names, selectedDepts.join(', '))
    if (!res.success) {
      setError(res.error || 'Bulk import failed.')
      setSaving(false)
      return
    }

    await onSaved()
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" style={{ background: '#fff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <h2 className="font-bold text-base" style={{ color: '#0F172A' }}>Bulk Import Packages</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-3">
          <p className="text-sm" style={{ color: '#475569' }}>Paste one package name per line. Duplicates are skipped automatically.</p>

          <Field label="Assign to Departments">
            <div className="rounded-lg p-2 max-h-32 overflow-y-auto" style={{ border: '1px solid #CBD5E1' }}>
              {departments.map(dept => (
                <label key={dept} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={selectedDepts.includes(dept)} onChange={() => toggleDept(dept)} />
                  <span>{dept}</span>
                </label>
              ))}
            </div>
          </Field>

          <textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            rows={12}
            placeholder={'com.example.app\ncom.example.app2'}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: '1px solid #CBD5E1', fontFamily: 'monospace' }}
          />

          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm" style={{ color: '#64748B' }}>Cancel</button>
            <button onClick={handleImport} disabled={saving} className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: '#16A34A', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Importing...' : 'Import to DB'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold" style={{ color: '#334155' }}>{label}</label>
      {children}
    </div>
  )
}

// ── Bulk-assign departments modal ─────────────────────────────
function BulkDeptModal({
  selectedPackageIds,
  departments,
  onClose,
  onSaved,
}: {
  selectedPackageIds: string[]
  departments: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedDepts, setSelectedDepts] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDept(dept: string) {
    setSelectedDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
  }

  async function handleSave() {
    if (selectedDepts.length === 0) { setError('Select at least one department.'); return }
    setSaving(true)
    setError('')
    const res = await bulkAssignDepartments(selectedPackageIds, selectedDepts)
    setSaving(false)
    if (!res.success) { setError(res.error || 'Failed to assign departments.'); return }
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" style={{ background: '#fff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div>
            <h2 className="font-bold text-base" style={{ color: '#0F172A' }}>Assign Departments</h2>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              Applying to {selectedPackageIds.length} selected package{selectedPackageIds.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}

          <p className="text-sm" style={{ color: '#475569' }}>
            Select one or more departments. This will <strong>replace</strong> the department field for all selected packages.
          </p>

          <Field label="Departments (multi-select)">
            <div className="rounded-lg p-2 max-h-48 overflow-y-auto" style={{ border: '1px solid #CBD5E1' }}>
              {departments.length === 0 ? (
                <p className="text-xs p-2" style={{ color: '#94A3B8' }}>No departments found.</p>
              ) : departments.map(dept => {
                const checked = selectedDepts.includes(dept)
                return (
                  <label
                    key={dept}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm"
                    style={{ background: checked ? 'rgba(13,148,136,0.08)' : undefined }}
                  >
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                      style={{
                        border: `1.5px solid ${checked ? '#0D9488' : '#CBD5E1'}`,
                        background: checked ? '#0D9488' : '#fff',
                      }}
                      onClick={() => toggleDept(dept)}
                    >
                      {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                    </div>
                    <span style={{ color: '#1E293B' }}>{dept}</span>
                  </label>
                )
              })}
            </div>
          </Field>

          {selectedDepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedDepts.map(d => (
                <span key={d} className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: 'rgba(13,148,136,0.1)', color: '#0D9488' }}>
                  {d}
                </span>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm" style={{ color: '#64748B' }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || selectedDepts.length === 0}
              className="h-9 px-4 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#0D9488', opacity: (saving || selectedDepts.length === 0) ? 0.6 : 1 }}
            >
              {saving ? 'Applying...' : 'Apply to Selected'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Bulk-assign users modal ───────────────────────────────────
function BulkUsersModal({
  selectedPackageIds,
  users,
  onClose,
  onSaved,
}: {
  selectedPackageIds: string[]
  users: Array<{ username: string; role: string; department: string | null }>
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => u.username.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q))
  }, [users, userSearch])

  function toggleUser(username: string) {
    setSelectedUsers(prev => prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username])
  }

  async function handleSave() {
    if (selectedUsers.length === 0) { setError('Select at least one user.'); return }
    setSaving(true)
    setError('')
    const res = await bulkAssignPackagesToUsers(selectedUsers, selectedPackageIds)
    setSaving(false)
    if (!res.success) { setError(res.error || 'Failed to assign packages.'); return }
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" style={{ background: '#fff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div>
            <h2 className="font-bold text-base" style={{ color: '#0F172A' }}>Assign to Multiple Users</h2>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              Assign {selectedPackageIds.length} package{selectedPackageIds.length !== 1 ? 's' : ''} to selected users (merges with existing)
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search users..."
              className="w-full h-9 pl-9 pr-3 rounded-lg text-sm outline-none"
              style={{ border: '1px solid #CBD5E1', background: '#fff' }}
            />
          </div>

          <div className="rounded-lg overflow-hidden max-h-64 overflow-y-auto" style={{ border: '1px solid #E2E8F0' }}>
            {filteredUsers.length === 0 ? (
              <p className="text-xs p-3" style={{ color: '#94A3B8' }}>No users found.</p>
            ) : filteredUsers.map(u => {
              const checked = selectedUsers.includes(u.username)
              return (
                <label
                  key={u.username}
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b last:border-b-0"
                  style={{
                    borderColor: '#F1F5F9',
                    background: checked ? 'rgba(124,58,237,0.05)' : '#fff',
                  }}
                >
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                    style={{
                      border: `1.5px solid ${checked ? '#7C3AED' : '#CBD5E1'}`,
                      background: checked ? '#7C3AED' : '#fff',
                    }}
                    onClick={() => toggleUser(u.username)}
                  >
                    {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: '#1E293B' }}>{u.username}</p>
                    <p className="text-xs" style={{ color: '#64748B' }}>{u.role}{u.department ? ` · ${u.department}` : ''}</p>
                  </div>
                </label>
              )
            })}
          </div>

          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedUsers.map(u => (
                <span key={u} className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED' }}>
                  {u}
                </span>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm" style={{ color: '#64748B' }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || selectedUsers.length === 0}
              className="h-9 px-4 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#7C3AED', opacity: (saving || selectedUsers.length === 0) ? 0.6 : 1 }}
            >
              {saving ? 'Assigning...' : `Assign to ${selectedUsers.length || ''} User${selectedUsers.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
