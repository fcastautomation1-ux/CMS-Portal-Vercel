'use client'

import { useState, useRef, useEffect, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { Building2, Plus, Pencil, Trash2, X, Users, UserPlus, Briefcase, Code2, HeadphonesIcon, BarChart2, Settings, Megaphone, BookOpen, ShieldCheck, Search, RefreshCw } from 'lucide-react'
import { saveDepartment, deleteDepartment, getUsersForDepartmentAssignment, assignUsersToDepartment, syncUserDepartmentNamesAction } from '@/app/dashboard/departments/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { Department, SessionUser } from '@/types'

interface Props { departments: Department[]; memberNames: Record<string, string[]>; user: SessionUser }

const DEPT_THEMES: Array<{ gradient: string; iconBg: string; color: string; icon: React.ReactNode }> = [
  { gradient: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)',  iconBg: 'rgba(43,127,255,0.15)',  color: '#2B7FFF',  icon: <Briefcase size={22} /> },
  { gradient: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',  iconBg: 'rgba(139,92,246,0.15)', color: '#8B5CF6',  icon: <Code2 size={22} /> },
  { gradient: 'linear-gradient(135deg, #14B8A6, #0D9488)',  iconBg: 'rgba(20,184,166,0.15)', color: '#14B8A6',  icon: <HeadphonesIcon size={22} /> },
  { gradient: 'linear-gradient(135deg, #F97316, #EA580C)',  iconBg: 'rgba(249,115,22,0.15)', color: '#F97316',  icon: <BarChart2 size={22} /> },
  { gradient: 'linear-gradient(135deg, #EC4899, #DB2777)',  iconBg: 'rgba(236,72,153,0.15)', color: '#EC4899',  icon: <Megaphone size={22} /> },
  { gradient: 'linear-gradient(135deg, #F59E0B, #D97706)',  iconBg: 'rgba(245,158,11,0.15)', color: '#F59E0B',  icon: <Settings size={22} /> },
  { gradient: 'linear-gradient(135deg, #10B981, #059669)',  iconBg: 'rgba(16,185,129,0.15)', color: '#10B981',  icon: <BookOpen size={22} /> },
  { gradient: 'linear-gradient(135deg, #6366F1, #4F46E5)',  iconBg: 'rgba(99,102,241,0.15)', color: '#6366F1',  icon: <ShieldCheck size={22} /> },
]

const AVATAR_COLORS = ['#2B7FFF', '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#10B981', '#F59E0B', '#6366F1']

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/** Avatar circle with initials; on hover cluster shows full member list popup */
function MemberAvatars({ names, themeColor }: { names: string[]; themeColor: string }) {
  const [showPopup, setShowPopup] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const MAX_VISIBLE = 5
  const visible = names.slice(0, MAX_VISIBLE)
  const overflow = names.length - MAX_VISIBLE

  // Close on outside click
  useEffect(() => {
    if (!showPopup) return
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPopup(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopup])

  if (names.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}
    >
      {/* Avatar cluster */}
      <div
        className="flex items-center cursor-pointer select-none"
        onClick={() => setShowPopup(p => !p)}
        title="Click to see all members"
      >
        <div className="flex items-center" style={{ gap: -6 }}>
          {visible.map((name, idx) => (
            <div
              key={name}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 border-2"
              style={{
                background: AVATAR_COLORS[idx % AVATAR_COLORS.length],
                borderColor: 'var(--color-card)',
                marginLeft: idx > 0 ? -8 : 0,
                zIndex: visible.length - idx,
                position: 'relative',
              }}
              title={name}
            >
              {getInitials(name)}
            </div>
          ))}
          {overflow > 0 && (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 border-2"
              style={{
                background: themeColor,
                borderColor: 'var(--color-card)',
                marginLeft: -8,
                position: 'relative',
                zIndex: 0,
              }}
            >
              +{overflow}
            </div>
          )}
        </div>
      </div>

      {/* Full member list popup */}
      {showPopup && (
        <div
          className="absolute bottom-full left-0 mb-2 rounded-xl overflow-hidden z-20 animate-fade-in"
          style={{
            width: 220,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}
        >
          <div
            className="px-3 py-2 text-xs font-bold uppercase tracking-wide"
            style={{ background: themeColor, color: 'white' }}
          >
            {names.length} member{names.length !== 1 ? 's' : ''}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {names.map((name, idx) => (
              <div
                key={name}
                className="flex items-center gap-2.5 px-3 py-2"
                style={{ borderBottom: idx < names.length - 1 ? '1px solid var(--color-border)' : 'none' }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}
                >
                  {getInitials(name)}
                </div>
                <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function DepartmentsPage({ departments: initial, memberNames, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const canSync = ['Admin', 'Super Manager'].includes(user.role)
  const [syncPending, startSyncTransition] = useTransition()
  const [syncMsg, setSyncMsg] = useState('')
  const [departments, setDepartments] = useState(initial)
  const [editing, setEditing] = useState<Department | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ dept: Department; count: number } | null>(null)
  const [assigningDept, setAssigningDept] = useState<Department | null>(null)
  const [assignUsers, setAssignUsers] = useState<Array<{ username: string; department: string | null }>>([])
  const [assignSelected, setAssignSelected] = useState<string[]>([])
  const [assignSearch, setAssignSearch] = useState('')
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [departmentMemberNames, setDepartmentMemberNames] = useState<Record<string, string[]>>(memberNames)

  const normalizeDepartment = (value: string) => value.trim().toLowerCase()
  const membersByNormalizedDept: Record<string, string[]> = {}
  for (const [deptName, names] of Object.entries(departmentMemberNames)) {
    const key = normalizeDepartment(deptName)
    if (!membersByNormalizedDept[key]) membersByNormalizedDept[key] = []
    for (const name of names) {
      if (!membersByNormalizedDept[key].includes(name)) membersByNormalizedDept[key].push(name)
    }
  }

  async function handleDelete(dept: Department) {
    const res = await deleteDepartment(dept.id)
    if (res.success) setDepartments(prev => prev.filter(d => d.id !== dept.id))
  }

  useEffect(() => {
    // Only fetch once, and only when the assign-users modal is first opened.
    if (!canEdit || !assigningDept || assignUsers.length > 0) return
    let cancelled = false
    getUsersForDepartmentAssignment().then((rows) => {
      if (!cancelled) setAssignUsers(rows)
    })
    return () => { cancelled = true }
  }, [canEdit, assigningDept, assignUsers.length])

  const filteredAssignUsers = useMemo(() => {
    const q = assignSearch.toLowerCase().trim()
    if (!q) return assignUsers
    return assignUsers.filter((entry) => entry.username.toLowerCase().includes(q))
  }, [assignSearch, assignUsers])

  const openAssignModal = (dept: Department) => {
    setAssigningDept(dept)
    setAssignSearch('')
    setAssignError('')
    setAssignSelected([])
  }

  const toggleAssignSelection = (username: string) => {
    setAssignSelected((prev) => (
      prev.includes(username) ? prev.filter((v) => v !== username) : [...prev, username]
    ))
  }

  const submitAssign = async () => {
    if (!assigningDept) return
    if (!assignSelected.length) {
      setAssignError('Select at least one user.')
      return
    }
    setAssignSaving(true)
    setAssignError('')
    const res = await assignUsersToDepartment(assigningDept.name, assignSelected)
    if (!res.success) {
      setAssignError(res.error || 'Failed to assign users.')
      setAssignSaving(false)
      return
    }
    const refreshed = await getUsersForDepartmentAssignment()
    setAssignUsers(refreshed)
    setDepartmentMemberNames((prev) => {
      const next = { ...prev }
      const deptKey = normalizeDepartment(assigningDept.name)
      const existing = new Set(next[deptKey] ?? [])
      assignSelected.forEach((username) => existing.add(username))
      next[deptKey] = Array.from(existing).sort((a, b) => a.localeCompare(b))
      return next
    })
    setAssignSaving(false)
    setAssigningDept(null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Departments</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{departments.length} departments</p>
        </div>
        {canEdit && (
          <Link
            href="/dashboard/departments/new"
            className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2 btn-motion"
            style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', boxShadow: '0 2px 8px rgba(43,127,255,0.3)' }}
          >
            <Plus size={16} /> Add Department
          </Link>
        )}
        {canSync && (
          <div className="flex items-center gap-2">
            {syncMsg && <span className="text-xs" style={{ color: syncMsg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{syncMsg}</span>}
            <button
              type="button"
              disabled={syncPending}
              onClick={() => {
                setSyncMsg('')
                startSyncTransition(async () => {
                  const result = await syncUserDepartmentNamesAction()
                  if (result.success) setSyncMsg(`✓ ${result.updated} user(s) updated`)
                  else setSyncMsg(`✗ ${result.error}`)
                })
              }}
              className="h-10 px-3 rounded-xl text-sm font-semibold flex items-center gap-2 btn-motion"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              title="Sync department names in users table to match official names"
            >
              <RefreshCw size={14} className={syncPending ? 'animate-spin' : ''} />
              {syncPending ? 'Syncing…' : 'Sync Names'}
            </button>
          </div>
        )}
      </div>

      {departments.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 size={40} className="mx-auto mb-3" style={{ color: 'var(--slate-300)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No departments found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {departments.map((dept, i) => {
            const theme = DEPT_THEMES[i % DEPT_THEMES.length]
            const names = membersByNormalizedDept[normalizeDepartment(dept.name)] ?? []
            const count = names.length

            return (
              <div key={dept.id} className="card p-0 overflow-visible group hover:shadow-lg transition-shadow duration-300 animate-fade-in">
                {/* Top color band */}
                <div className="h-2 w-full rounded-t-xl" style={{ background: theme.gradient }} />

                <div className="p-5">
                  {/* Icon + actions row */}
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ background: theme.iconBg, color: theme.color }}
                    >
                      {theme.icon}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditing(dept)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--color-text-muted)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--blue-50)'; (e.currentTarget as HTMLElement).style.color = '#2563EB' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)' }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => openAssignModal(dept)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--color-text-muted)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--blue-50)'; (e.currentTarget as HTMLElement).style.color = '#2563EB' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)' }}
                          title="Add users to department"
                        >
                          <UserPlus size={14} />
                        </button>
                        <button
                          onClick={() => {
                            const count = (membersByNormalizedDept[normalizeDepartment(dept.name)] ?? []).length
                            setPendingDelete({ dept, count })
                          }}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--color-text-muted)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FEF2F2'; (e.currentTarget as HTMLElement).style.color = '#EF4444' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <h3 className="text-base font-bold mb-1 truncate" style={{ color: 'var(--color-text)' }}>{dept.name}</h3>

                  {/* Member count */}
                  <div className="flex items-center gap-1.5 mb-4">
                    <Users size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {count} {count === 1 ? 'member' : 'members'}
                    </span>
                  </div>

                  {/* Avatar bubbles with hover popup */}
                  <MemberAvatars names={names} themeColor={theme.color} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <DeptModal
          dept={editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => {
            setDepartments(prev => prev.map(x => x.id === d.id ? d : x))
            setEditing(null)
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete "${pendingDelete.dept.name}"?` : 'Delete department?'}
        description={pendingDelete && pendingDelete.count > 0 ? `${pendingDelete.count} members are currently in this department.` : 'This action cannot be undone.'}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await handleDelete(pendingDelete.dept)
          setPendingDelete(null)
        }}
      />
      {assigningDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setAssigningDept(null) }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Add Users: {assigningDept.name}</h3>
              <button onClick={() => setAssigningDept(null)} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="p-5">
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Search users..."
                  className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
                  style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                />
              </div>
              {assignError && <div className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ background: '#FEF2F2', color: '#DC2626' }}>{assignError}</div>}
              <div className="max-h-72 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
                {filteredAssignUsers.map((entry) => (
                  <label key={entry.username} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ color: 'var(--color-text)' }}>{entry.username}</span>
                    <input
                      type="checkbox"
                      checked={assignSelected.includes(entry.username)}
                      onChange={() => toggleAssignSelection(entry.username)}
                    />
                  </label>
                ))}
                {filteredAssignUsers.length === 0 && (
                  <div className="px-3 py-4 text-sm text-slate-400">No users found.</div>
                )}
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setAssigningDept(null)} className="h-10 px-4 rounded-lg text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancel</button>
              <button onClick={submitAssign} disabled={assignSaving} className="h-10 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', opacity: assignSaving ? 0.6 : 1 }}>
                {assignSaving ? 'Saving...' : 'Add Selected Users'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DeptModal({ dept, onClose, onSaved }: { dept: Department | null; onClose: () => void; onSaved: (d: Department) => void }) {
  const isEdit = !!dept
  const [name, setName] = useState(dept?.name || '')
  const [description, setDescription] = useState(dept?.description || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await saveDepartment({ id: dept?.id, name, description })
    if (res.success && res.department) {
      onSaved(res.department)
    } else setError(res.error || 'Failed to save department.')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-3xl overflow-hidden animate-slide-up" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="font-bold text-3xl leading-none" style={{ color: 'var(--color-text)', letterSpacing: '-0.02em' }}>{isEdit ? 'Edit Department' : 'Add New Department'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" aria-label="Close"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-5">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-2">
            <label className="text-base font-semibold" style={{ color: 'var(--color-text-muted)' }}>Department Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="e.g. Automation/Development"
              className="h-11 px-4 rounded-2xl text-base outline-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-base font-semibold" style={{ color: 'var(--color-text-muted)' }}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add a description for this department..."
              rows={3}
              className="px-4 py-3 rounded-2xl text-base outline-none resize-none"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>

          <div className="pt-2 flex items-center gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button
              type="submit"
              disabled={saving}
              className="h-11 px-5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
            >
              {saving ? 'Saving...' : isEdit ? 'Save Department' : 'Save Department'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-5 rounded-xl text-sm font-semibold"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


