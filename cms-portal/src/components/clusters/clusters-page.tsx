'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  Layers, Plus, Pencil, Trash2, X, ChevronDown, ChevronUp,
  Building2, Users, UserPlus, Crown, ShieldCheck, User, Check,
  RefreshCw, Circle, Search,
} from 'lucide-react'
import {
  saveClusterAction,
  deleteClusterAction,
  setClusterDepartmentsAction,
  upsertClusterMemberAction,
  removeClusterMemberAction,
} from '@/app/dashboard/clusters/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ClusterDetail, ClusterRole, Department, User as PortalUser } from '@/types'

const CLUSTER_COLORS = [
  '#2B7FFF', '#8B5CF6', '#14B8A6', '#F97316',
  '#EC4899', '#10B981', '#F59E0B', '#6366F1',
  '#EF4444', '#06B6D4',
]

const ROLE_META: Record<ClusterRole, { label: string; icon: React.ReactNode; color: string }> = {
  owner:      { label: 'Cluster Owner',  icon: <Crown size={13} />,      color: '#F59E0B' },
  manager:    { label: 'Manager',        icon: <ShieldCheck size={13} />, color: '#2B7FFF' },
  supervisor: { label: 'Supervisor',     icon: <Users size={13} />,       color: '#8B5CF6' },
  member:     { label: 'Member',         icon: <User size={13} />,        color: '#10B981' },
}

const AVATAR_COLORS = ['#2B7FFF', '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#10B981', '#F59E0B', '#6366F1']
function getInitials(name: string) {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}
function avatarColor(name: string) {
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

interface Props {
  clusters: ClusterDetail[]
  departments: Department[]
  users: PortalUser[]
}

// ─── Cluster Form Modal ───────────────────────────────────────────────────────
function ClusterFormModal({
  cluster,
  onClose,
  onSaved,
}: {
  cluster: ClusterDetail | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState(cluster?.name ?? '')
  const [description, setDescription] = useState(cluster?.description ?? '')
  const [color, setColor] = useState(cluster?.color ?? '#2B7FFF')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSubmit() {
    if (!name.trim()) { setError('Cluster name is required'); return }
    startTransition(async () => {
      const result = await saveClusterAction({ id: cluster?.id, name, description, color })
      if (result.success && result.id) {
        onSaved(result.id)
        onClose()
      } else {
        setError(result.error ?? 'Failed to save')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 opacity-60 hover:opacity-100 transition-opacity">
          <X size={18} />
        </button>
        <h2 className="text-lg font-bold mb-5">{cluster ? 'Edit Cluster' : 'New Cluster'}</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1 opacity-70">Cluster Name</label>
            <input
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2F Hall"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 opacity-70">Description (optional)</label>
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What teams are in this cluster?"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-2 opacity-70">Color</label>
            <div className="flex gap-2 flex-wrap">
              {CLUSTER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-all"
                  style={{ background: c, borderColor: color === c ? 'white' : 'transparent', outline: color === c ? `2px solid ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="flex-1 rounded-lg py-2 text-sm font-bold text-white transition-opacity disabled:opacity-50"
              style={{ background: color }}
            >
              {isPending ? 'Saving…' : cluster ? 'Save Changes' : 'Create Cluster'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Department Picker Panel ──────────────────────────────────────────────────
function DepartmentPanel({
  cluster,
  allDepts,
  onClose,
}: {
  cluster: ClusterDetail
  allDepts: Department[]
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(cluster.departments.map((d) => d.id))
  )
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSave() {
    startTransition(async () => {
      await setClusterDepartmentsAction(cluster.id, Array.from(selected))
      onClose()
    })
  }

  const filtered = allDepts.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-sm rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <h3 className="font-bold text-sm">Select Departments — {cluster.name}</h3>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
            <input
              className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
              placeholder="Search departments…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-5 pb-3 space-y-1">
          {filtered.map((dept) => {
            const checked = selected.has(dept.id)
            return (
              <button
                key={dept.id}
                onClick={() => toggle(dept.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-left transition-colors hover:bg-white/5"
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-all"
                  style={{
                    background: checked ? cluster.color : 'transparent',
                    borderColor: checked ? cluster.color : 'var(--color-border)',
                  }}
                >
                  {checked && <Check size={10} color="white" />}
                </div>
                <Building2 size={13} className="opacity-60" />
                <span>{dept.name}</span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-xs opacity-40 py-4 text-center">No departments found</p>
          )}
        </div>
        <div className="p-5 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg py-2 text-xs font-medium"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
            >Cancel</button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex-1 rounded-lg py-2 text-xs font-bold text-white disabled:opacity-50"
              style={{ background: cluster.color }}
            >
              {isPending ? 'Saving…' : `Save (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Member Editor Panel ──────────────────────────────────────────────────────
function MemberPanel({
  cluster,
  allUsers,
  onClose,
}: {
  cluster: ClusterDetail
  allUsers: PortalUser[]
  onClose: () => void
}) {
  type LocalMember = { username: string; cluster_role: ClusterRole; scoped_departments: string[] }
  const initMembers = (): LocalMember[] =>
    cluster.members.map((m) => ({
      username: m.username,
      cluster_role: m.cluster_role,
      scoped_departments: m.scoped_departments ?? [],
    }))

  const [members, setMembers] = useState<LocalMember[]>(initMembers)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [addSearch, setAddSearch] = useState('')
  const [isPending, startTransition] = useTransition()
  const [showAddDropdown, setShowAddDropdown] = useState(false)

  const existingUsernames = new Set(members.map((m) => m.username))
  const availableUsers = allUsers.filter(
    (u) => !existingUsernames.has(u.username) &&
      u.username.toLowerCase().includes(addSearch.toLowerCase())
  )

  function addUser(username: string) {
    setMembers((prev) => [...prev, { username, cluster_role: 'member', scoped_departments: [] }])
    setAddSearch('')
    setShowAddDropdown(false)
  }

  function updateRole(username: string, role: ClusterRole) {
    setMembers((prev) => prev.map((m) => m.username === username ? { ...m, cluster_role: role } : m))
  }

  function toggleScope(username: string, deptName: string) {
    setMembers((prev) => prev.map((m) => {
      if (m.username !== username) return m
      const current = m.scoped_departments
      const next = current.includes(deptName)
        ? current.filter((d) => d !== deptName)
        : [...current, deptName]
      return { ...m, scoped_departments: next }
    }))
  }

  function handleSaveMember(username: string) {
    const m = members.find((mm) => mm.username === username)
    if (!m) return
    setSaving(username)
    startTransition(async () => {
      await upsertClusterMemberAction(cluster.id, {
        username: m.username,
        cluster_role: m.cluster_role,
        scoped_departments: m.scoped_departments.length > 0 ? m.scoped_departments : null,
      })
      setSaving(null)
    })
  }

  function handleRemoveMember(username: string) {
    setRemoving(username)
    startTransition(async () => {
      await removeClusterMemberAction(cluster.id, username)
      setMembers((prev) => prev.filter((m) => m.username !== username))
      setRemoving(null)
    })
  }

  const filtered = members.filter((m) => m.username.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <h3 className="font-bold text-sm">Manage Members — {cluster.name}</h3>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>

        {/* Add user */}
        <div className="px-5 pb-3 relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <input
                className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none"
                style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                placeholder="Add user to cluster…"
                value={addSearch}
                onChange={(e) => { setAddSearch(e.target.value); setShowAddDropdown(true) }}
                onFocus={() => setShowAddDropdown(true)}
              />
              {showAddDropdown && addSearch && availableUsers.length > 0 && (
                <div
                  className="absolute top-full mt-1 left-0 right-0 rounded-lg shadow-xl z-10 overflow-auto"
                  style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', maxHeight: 200 }}
                >
                  {availableUsers.slice(0, 20).map((u) => (
                    <button
                      key={u.username}
                      onClick={() => addUser(u.username)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-white/5"
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ background: avatarColor(u.username) }}
                      >
                        {getInitials(u.username)}
                      </div>
                      <span className="flex-1">{u.username}</span>
                      <span className="opacity-40">{u.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowAddDropdown(false)}
              className="px-3 rounded-lg text-xs"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
            >
              <X size={13} />
            </button>
          </div>

          <div className="mt-2 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
            <input
              className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
              placeholder="Search existing members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-3 space-y-3">
          {filtered.map((m) => {
            const roleMeta = ROLE_META[m.cluster_role]
            return (
              <div
                key={m.username}
                className="rounded-xl p-3"
                style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: avatarColor(m.username) }}
                  >
                    {getInitials(m.username)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{m.username}</p>
                    <div className="flex items-center gap-1 mt-0.5" style={{ color: roleMeta.color }}>
                      {roleMeta.icon}
                      <span className="text-[10px]">{roleMeta.label}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(m.username)}
                    disabled={removing === m.username}
                    className="p-1.5 rounded-lg opacity-40 hover:opacity-100 hover:text-red-400 transition-all disabled:opacity-20"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Role selector */}
                <div className="flex gap-1 mt-2 flex-wrap">
                  {(Object.keys(ROLE_META) as ClusterRole[]).map((role) => (
                    <button
                      key={role}
                      onClick={() => updateRole(m.username, role)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all"
                      style={{
                        background: m.cluster_role === role ? ROLE_META[role].color + '22' : 'transparent',
                        color: m.cluster_role === role ? ROLE_META[role].color : undefined,
                        border: `1px solid ${m.cluster_role === role ? ROLE_META[role].color : 'var(--color-border)'}`,
                      }}
                    >
                      {ROLE_META[role].icon}
                      {ROLE_META[role].label}
                    </button>
                  ))}
                </div>

                {/* Scope selector for supervisors */}
                {m.cluster_role === 'supervisor' && cluster.departments.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] opacity-50 mb-1">Scoped Departments (leave empty = all)</p>
                    <div className="flex gap-1 flex-wrap">
                      {cluster.departments.map((dept) => {
                        const inScope = m.scoped_departments.includes(dept.name)
                        return (
                          <button
                            key={dept.id}
                            onClick={() => toggleScope(m.username, dept.name)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-all"
                            style={{
                              background: inScope ? '#8B5CF622' : 'transparent',
                              color: inScope ? '#8B5CF6' : undefined,
                              border: `1px solid ${inScope ? '#8B5CF6' : 'var(--color-border)'}`,
                            }}
                          >
                            {inScope && <Check size={9} />}
                            {dept.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => handleSaveMember(m.username)}
                  disabled={saving === m.username}
                  className="mt-2 w-full rounded-lg py-1.5 text-[10px] font-semibold text-white disabled:opacity-40 transition-opacity"
                  style={{ background: cluster.color }}
                >
                  {saving === m.username ? 'Saving…' : 'Save Member'}
                </button>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-xs opacity-40 py-6 text-center">No members yet. Add users above.</p>
          )}
        </div>

        <div className="p-5 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onClose}
            className="w-full rounded-lg py-2 text-xs font-medium"
            style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
          >Done</button>
        </div>
      </div>
    </div>
  )
}

// ─── Cluster Card ─────────────────────────────────────────────────────────────
function ClusterCard({
  cluster,
  allDepts,
  allUsers,
  onEdit,
  onDelete,
  index,
}: {
  cluster: ClusterDetail
  allDepts: Department[]
  allUsers: PortalUser[]
  onEdit: (c: ClusterDetail) => void
  onDelete: (c: ClusterDetail) => void
  index: number
}) {
  const [showDepts, setShowDepts] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const owner = cluster.members.find((m) => m.cluster_role === 'owner')
  const managers = cluster.members.filter((m) => m.cluster_role === 'manager')
  const supervisors = cluster.members.filter((m) => m.cluster_role === 'supervisor')
  const memberCount = cluster.members.length

  return (
    <>
      <div
        className="rounded-2xl overflow-hidden transition-all hover:shadow-lg"
        style={{
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Color bar */}
        <div className="h-1.5 w-full" style={{ background: cluster.color }} />

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: cluster.color + '20' }}
              >
                <Layers size={18} style={{ color: cluster.color }} />
              </div>
              <div>
                <h3 className="font-bold text-sm">{cluster.name}</h3>
                {cluster.description && (
                  <p className="text-xs opacity-50 mt-0.5 line-clamp-1">{cluster.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onEdit(cluster)}
                className="p-1.5 rounded-lg opacity-50 hover:opacity-100 hover:bg-white/5 transition-all"
                title="Edit cluster"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => onDelete(cluster)}
                className="p-1.5 rounded-lg opacity-50 hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Delete cluster"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-3 mb-4">
            <div
              className="flex-1 rounded-xl px-3 py-2 text-center cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: cluster.color + '15', border: `1px solid ${cluster.color}30` }}
              onClick={() => setShowDepts(true)}
            >
              <p className="text-lg font-bold" style={{ color: cluster.color }}>{cluster.departments.length}</p>
              <p className="text-[10px] opacity-60">Departments</p>
            </div>
            <div
              className="flex-1 rounded-xl px-3 py-2 text-center cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
              onClick={() => setShowMembers(true)}
            >
              <p className="text-lg font-bold">{memberCount}</p>
              <p className="text-[10px] opacity-60">Members</p>
            </div>
          </div>

          {/* Leadership */}
          {(owner || managers.length > 0 || supervisors.length > 0) && (
            <div className="space-y-2">
              {owner && (
                <div className="flex items-center gap-2">
                  <Crown size={11} style={{ color: '#F59E0B' }} />
                  <span className="text-[10px] opacity-50">Owner:</span>
                  <span className="text-[10px] font-semibold">{owner.username}</span>
                </div>
              )}
              {managers.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <ShieldCheck size={11} className="opacity-50" style={{ color: '#2B7FFF' }} />
                  <span className="text-[10px] opacity-50">Managers:</span>
                  {managers.map((m) => (
                    <span key={m.username} className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#2B7FFF15', color: '#2B7FFF' }}>{m.username}</span>
                  ))}
                </div>
              )}
              {supervisors.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={11} className="opacity-50" style={{ color: '#8B5CF6' }} />
                    <span className="text-[10px] opacity-50">Supervisors:</span>
                  </div>
                  <div className="pl-5 space-y-1">
                    {supervisors.map((s) => (
                      <div key={s.username} className="flex items-start gap-2">
                        <span className="text-[10px] font-medium" style={{ color: '#8B5CF6' }}>{s.username}</span>
                        {s.scoped_departments && s.scoped_departments.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {s.scoped_departments.map((d) => (
                              <span key={d} className="text-[9px] px-1.5 py-0.5 rounded opacity-70" style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}>{d}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Departments preview */}
          {cluster.departments.length > 0 && (
            <button
              onClick={() => setExpanded((p) => !p)}
              className="mt-3 flex items-center gap-1 text-[10px] opacity-50 hover:opacity-80 transition-opacity"
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {expanded ? 'Hide' : `${cluster.departments.length} departments`}
            </button>
          )}
          {expanded && (
            <div className="mt-2 flex gap-1 flex-wrap">
              {cluster.departments.map((d) => (
                <span
                  key={d.id}
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: cluster.color + '18', color: cluster.color, border: `1px solid ${cluster.color}30` }}
                >
                  {d.name}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setShowDepts(true)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition-all hover:opacity-80"
              style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
            >
              <Building2 size={12} />
              Departments
            </button>
            <button
              onClick={() => setShowMembers(true)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition-all hover:opacity-80"
              style={{ background: cluster.color + '18', border: `1px solid ${cluster.color}40`, color: cluster.color }}
            >
              <UserPlus size={12} />
              Members
            </button>
          </div>
        </div>
      </div>

      {showDepts && (
        <DepartmentPanel
          cluster={cluster}
          allDepts={allDepts}
          onClose={() => setShowDepts(false)}
        />
      )}
      {showMembers && (
        <MemberPanel
          cluster={cluster}
          allUsers={allUsers}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function ClustersPage({ clusters: initialClusters, departments, users }: Props) {
  const [clusters, setClusters] = useState<ClusterDetail[]>(initialClusters)
  const [editingCluster, setEditingCluster] = useState<ClusterDetail | null | 'new'>('null_sentinel' as never)
  const [showForm, setShowForm] = useState(false)
  const [formTarget, setFormTarget] = useState<ClusterDetail | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClusterDetail | null>(null)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  function openCreate() { setFormTarget(null); setShowForm(true) }
  function openEdit(c: ClusterDetail) { setFormTarget(c); setShowForm(true) }

  function handleSaved(id: string) {
    // Refresh is handled by revalidatePath — just close modal
    // For immediate feedback, optimistically do nothing; page will rehydrate
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      await deleteClusterAction(deleteTarget.id)
      setClusters((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      setDeleteTarget(null)
    })
  }

  const filtered = clusters.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.description?.toLowerCase().includes(search.toLowerCase()) ||
    c.departments.some((d) => d.name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#2B7FFF,#1A6AE4)' }}>
            <Layers size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Clusters</h1>
            <p className="text-xs opacity-50">Group departments into halls / realms with custom routing</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#2B7FFF,#1A6AE4)' }}
        >
          <Plus size={16} />
          New Cluster
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input
          className="w-full rounded-xl pl-9 pr-3 py-2 text-sm outline-none"
          style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
          placeholder="Search clusters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-6">
        {[
          { label: 'Total Clusters', value: clusters.length, color: '#2B7FFF' },
          { label: 'Total Departments in Clusters', value: clusters.reduce((s, c) => s + c.departments.length, 0), color: '#14B8A6' },
          { label: 'Total Members', value: clusters.reduce((s, c) => s + c.members.length, 0), color: '#8B5CF6' },
          { label: 'Unclustered Depts', value: departments.filter((d) => !clusters.some((c) => c.departments.some((cd) => cd.id === d.id))).length, color: '#F59E0B' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex-1 rounded-xl p-4"
            style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
            <p className="text-[10px] opacity-50 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Cluster grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((cluster, idx) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              allDepts={departments}
              allUsers={users}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              index={idx}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 opacity-40">
          <Layers size={48} className="mb-4" />
          <p className="text-sm font-medium">No clusters yet</p>
          <p className="text-xs mt-1">Create your first cluster to group departments</p>
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <ClusterFormModal
          cluster={formTarget}
          onClose={() => setShowForm(false)}
          onSaved={handleSaved}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          title="Delete Cluster"
          description={`Delete "${deleteTarget.name}"? This will remove all department and member assignments. Tasks in this cluster will become unclustered.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          confirmLabel="Delete"
          danger
        />
      )}
    </div>
  )
}
