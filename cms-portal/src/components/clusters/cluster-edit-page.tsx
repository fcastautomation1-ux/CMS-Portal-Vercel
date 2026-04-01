'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TimeSelectPicker } from '@/components/ui/time-select-picker'
import {
  ArrowLeft, Layers, Save, Building2, Users, UserPlus, Crown,
  ShieldCheck, User, Check, Trash2, Search, X, Plus, Settings2,
  Clock, Palette, Info, Play, PauseCircle, CheckCircle, ChevronRight,
} from 'lucide-react'
import {
  saveClusterAction,
  deleteClusterAction,
  setClusterDepartmentsAction,
  upsertClusterMemberAction,
  removeClusterMemberAction,
} from '@/app/dashboard/clusters/actions'
import {
  saveClusterSettingsAction,
} from '@/app/dashboard/tasks/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ClusterDetail, ClusterRole, ClusterSettings, Department, User as PortalUser } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────
const CLUSTER_COLORS = [
  '#2B7FFF', '#8B5CF6', '#14B8A6', '#F97316',
  '#EC4899', '#10B981', '#F59E0B', '#6366F1',
  '#EF4444', '#06B6D4',
]

const ROLE_META: Record<ClusterRole, { label: string; icon: React.ReactNode; color: string }> = {
  owner:      { label: 'Owner',      icon: <Crown size={12} />,      color: '#F59E0B' },
  manager:    { label: 'Manager',    icon: <ShieldCheck size={12} />, color: '#2B7FFF' },
  supervisor: { label: 'Supervisor', icon: <Users size={12} />,       color: '#8B5CF6' },
  member:     { label: 'Member',     icon: <User size={12} />,        color: '#10B981' },
}

const AVATAR_COLORS = ['#2B7FFF', '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#10B981', '#F59E0B', '#6366F1']
function getInitials(name: string) {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}
function avatarColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function splitDepartments(value: string | null | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function mapPortalRoleToClusterRole(role: string): ClusterRole {
  if (role === 'Supervisor') return 'supervisor'
  if (role === 'Manager' || role === 'Super Manager') return 'manager'
  return 'member'
}

type Tab = 'basic' | 'hours' | 'queue' | 'departments' | 'members'

interface Props {
  cluster: ClusterDetail | null          // null = create new
  departments: Department[]
  users: PortalUser[]
  settings: ClusterSettings | null
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="relative flex-shrink-0 focus:outline-none"
      style={{ width: 40, height: 22 }}
    >
      <div
        className="absolute inset-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? '#2B7FFF' : 'var(--color-border)', opacity: disabled ? 0.4 : 1 }}
      />
      <div
        className="absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform duration-200"
        style={{ width: 18, height: 18, transform: checked ? 'translateX(18px)' : 'translateX(0)' }}
      />
    </button>
  )
}

// ─── Save feedback button ─────────────────────────────────────────────────────
function SaveBtn({ saving, saved, onClick, label = 'Save' }: { saving: boolean; saved: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
      style={{ background: saved ? '#10B981' : 'linear-gradient(135deg,#2B7FFF,#1A6AE4)' }}
    >
      {saving ? (
        <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      ) : saved ? (
        <CheckCircle size={14} />
      ) : (
        <Save size={14} />
      )}
      {saving ? 'Saving…' : saved ? 'Saved!' : label}
    </button>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function ClusterEditPage({ cluster, departments, users, settings }: Props) {
  const router = useRouter()
  const isNew = !cluster

  const [activeTab, setActiveTab] = useState<Tab>('basic')

  // ── Basic Info state ──────────────────────────────────────────────────────
  const [name, setName] = useState(cluster?.name ?? '')
  const [description, setDescription] = useState(cluster?.description ?? '')
  const [color, setColor] = useState(cluster?.color ?? '#2B7FFF')
  const [basicSaving, setBasicSaving] = useStateTransition()
  const [basicSaved, setBasicSaved] = useState(false)
  const [basicError, setBasicError] = useState('')
  const [managerUsername, setManagerUsername] = useState('')
  const [managerSearch, setManagerSearch] = useState('')
  const [showManagerDropdown, setShowManagerDropdown] = useState(false)
  const [managerError, setManagerError] = useState('')

  // ── Manager picker state (required on create) ─────────────────────────────

  // ── Office Hours state ────────────────────────────────────────────────────
  const [officeStart, setOfficeStart] = useState(cluster?.office_start ?? '09:00')
  const [officeEnd, setOfficeEnd] = useState(cluster?.office_end ?? '18:00')
  const [breakStart, setBreakStart] = useState(cluster?.break_start ?? '13:00')
  const [breakEnd, setBreakEnd] = useState(cluster?.break_end ?? '14:00')
  const [fridayBreakStart, setFridayBreakStart] = useState(cluster?.friday_break_start ?? '12:30')
  const [fridayBreakEnd, setFridayBreakEnd] = useState(cluster?.friday_break_end ?? '14:30')
  const [hoursSaving, setHoursSaving] = useStateTransition()
  const [hoursSaved, setHoursSaved] = useState(false)

  // ── Queue Settings state ──────────────────────────────────────────────────
  const [allowDeptSeeQueue, setAllowDeptSeeQueue] = useState(settings?.allow_dept_users_see_queue ?? false)
  const [singleActive, setSingleActive] = useState(settings?.single_active_task_per_user ?? false)
  const [autoStart, setAutoStart] = useState(settings?.auto_start_next_task ?? true)
  const [requirePauseReason, setRequirePauseReason] = useState(settings?.require_pause_reason ?? false)
  const [queueSaving, startQueueTransition] = useTransition()
  const [queueSaved, setQueueSaved] = useState(false)
  const [queueError, setQueueError] = useState('')
  // Track if we have a cluster id to save settings against
  const [savedClusterId, setSavedClusterId] = useState(cluster?.id ?? '')

  // ── Departments state ─────────────────────────────────────────────────────
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(
    new Set(cluster?.departments.map((d) => d.id) ?? [])
  )
  const [deptSearch, setDeptSearch] = useState('')
  const [deptSaving, setDeptSaving] = useStateTransition()
  const [deptSaved, setDeptSaved] = useState(false)
  const [deptError, setDeptError] = useState('')
  const [leaderSearch, setLeaderSearch] = useState('')
  const [leaderError, setLeaderError] = useState('')

  // ── Members state ─────────────────────────────────────────────────────────
  type LocalMember = { username: string; cluster_role: ClusterRole; scoped_departments: string[] }
  const [members, setMembers] = useState<LocalMember[]>(
    (cluster?.members ?? []).map((m) => ({
      username: m.username,
      cluster_role: m.cluster_role,
      scoped_departments: m.scoped_departments ?? [],
    }))
  )
  const [memberSearch, setMemberSearch] = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [showAddDropdown, setShowAddDropdown] = useState(false)
  const [memberSaving, setMemberSaving] = useState<string | null>(null)
  const [memberRemoving, setMemberRemoving] = useState<string | null>(null)
  const [, startMemberTransition] = useTransition()

  // ── Creating state ──────────────────────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false)

  // ── Delete state ──────────────────────────────────────────────────────────
  const [showDelete, setShowDelete] = useState(false)
  const [deletePending, startDeleteTransition] = useTransition()

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function flashSaved(setter: React.Dispatch<React.SetStateAction<boolean>>) {
    setter(true)
    setTimeout(() => setter(false), 2500)
  }

  function buildClusterPayload() {
    return {
      id: savedClusterId || undefined,
      name,
      description,
      color,
      office_start: officeStart,
      office_end: officeEnd,
      break_start: breakStart,
      break_end: breakEnd,
      friday_break_start: fridayBreakStart,
      friday_break_end: fridayBreakEnd,
    }
  }

  // ─── Save: Basic Info ─────────────────────────────────────────────────────
  async function saveBasic() {
    if (!name.trim()) { setBasicError('Cluster name is required'); return }
    setBasicError('')
    setBasicSaving(true)
    const result = await saveClusterAction(buildClusterPayload())
    if (result.success && result.id) {
      setSavedClusterId(result.id)
      setBasicSaving(false)
      flashSaved(setBasicSaved)
    } else {
      setBasicSaving(false)
      setBasicError(result.error ?? 'Failed to save')
    }
  }

  // ─── Save: Office Hours ────────────────────────────────────────────────────
  async function saveHours() {
    if (!savedClusterId) { await saveBasic(); return }
    setHoursSaving(true)
    const result = await saveClusterAction(buildClusterPayload())
    setHoursSaving(false)
    if (result.success) flashSaved(setHoursSaved)
  }

  // ─── Save: Queue Settings ─────────────────────────────────────────────────
  function saveQueue() {
    if (!savedClusterId) return
    setQueueError('')
    setQueueSaved(false)
    startQueueTransition(async () => {
      const result = await saveClusterSettingsAction(savedClusterId, {
        allow_dept_users_see_queue: allowDeptSeeQueue,
        single_active_task_per_user: singleActive,
        auto_start_next_task: autoStart,
        require_pause_reason: requirePauseReason,
      })
      if (result.success) {
        flashSaved(setQueueSaved)
      } else {
        setQueueError(result.error ?? 'Failed to save')
      }
    })
  }

  // ─── Save: Departments ─────────────────────────────────────────────────────
  async function saveDepts() {
    if (!savedClusterId) return
    setDeptError('')
    setDeptSaving(true)
    const result = await setClusterDepartmentsAction(savedClusterId, Array.from(selectedDepts))
    if (!result.success) {
      setDeptSaving(false)
      setDeptError(result.error ?? 'Failed to save departments')
      return
    }

    // Auto-upsert all users from selected departments
    const deptNames = new Set(departments.filter((d) => selectedDepts.has(d.id)).map((d) => d.name))
    const deptUsers = users.filter((u) => u.department && deptNames.has(u.department))
    for (const u of deptUsers) {
      const existing = members.find((m) => m.username === u.username)
      await upsertClusterMemberAction(savedClusterId, {
        username: u.username,
        cluster_role: existing?.cluster_role ?? mapPortalRoleToClusterRole(u.role),
        scoped_departments: existing?.scoped_departments?.length ? existing.scoped_departments : null,
      })
    }
    // Also ensure any manually-picked leaders not in the selected depts are saved
    const deptUsernames = new Set(deptUsers.map((u) => u.username))
    for (const m of members) {
      if (deptUsernames.has(m.username)) continue
      await upsertClusterMemberAction(savedClusterId, {
        username: m.username,
        cluster_role: m.cluster_role,
        scoped_departments: m.scoped_departments.length > 0 ? m.scoped_departments : null,
      })
    }

    setDeptSaving(false)
    flashSaved(setDeptSaved)
  }

  // ─── Member actions ────────────────────────────────────────────────────────
  function addMember(username: string) {
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
      const next = m.scoped_departments.includes(deptName)
        ? m.scoped_departments.filter((d) => d !== deptName)
        : [...m.scoped_departments, deptName]
      return { ...m, scoped_departments: next }
    }))
  }

  function handleSaveMember(username: string) {
    if (!savedClusterId) return
    const m = members.find((mm) => mm.username === username)
    if (!m) return
    setMemberSaving(username)
    startMemberTransition(async () => {
      await upsertClusterMemberAction(savedClusterId, {
        username: m.username,
        cluster_role: m.cluster_role,
        scoped_departments: m.scoped_departments.length > 0 ? m.scoped_departments : null,
      })
      setMemberSaving(null)
    })
  }

  function handleRemoveMember(username: string) {
    if (!savedClusterId) return
    setMemberRemoving(username)
    startMemberTransition(async () => {
      await removeClusterMemberAction(savedClusterId, username)
      setMembers((prev) => prev.filter((m) => m.username !== username))
      setMemberRemoving(null)
    })
  }

  function handleDelete() {
    if (!savedClusterId) return
    startDeleteTransition(async () => {
      await deleteClusterAction(savedClusterId)
      router.replace('/dashboard/clusters')
      router.refresh()
    })
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const existingUsernames = new Set(members.map((m) => m.username))
  const existingManagers = members.filter((m) => m.cluster_role === 'manager' || m.cluster_role === 'owner')
  const eligibleManagers = users.filter(
    (u) =>
      (u.role === 'Super Manager' || u.role === 'Manager' || u.role === 'Supervisor') &&
      u.username.toLowerCase().includes(managerSearch.toLowerCase()),
  )
  const leadershipRoles = new Set(['Super Manager', 'Manager', 'Supervisor'])
  // Names of selected departments for filtering
  const selectedDeptNames = new Set(
    departments.filter((d) => selectedDepts.has(d.id)).map((d) => d.name)
  )
  const eligibleLeaders = users.filter((u) => {
    if (existingUsernames.has(u.username)) return false
    if (!leadershipRoles.has(u.role)) return false
    // If departments are selected, only show users whose department is in the selection
    if (selectedDepts.size > 0 && u.department && !selectedDeptNames.has(u.department)) return false
    if (!leaderSearch) return true
    return (
      u.username.toLowerCase().includes(leaderSearch.toLowerCase()) ||
      u.role.toLowerCase().includes(leaderSearch.toLowerCase())
    )
  })
  const availableUsers = users.filter(
    (u) => !existingUsernames.has(u.username) &&
      u.username.toLowerCase().includes(addSearch.toLowerCase())
  )
  const filteredMembers = members.filter((m) =>
    m.username.toLowerCase().includes(memberSearch.toLowerCase())
  )
  const filteredDepts = departments.filter((d) =>
    d.name.toLowerCase().includes(deptSearch.toLowerCase())
  )

  const stepOrder: Tab[] = ['basic', 'hours', 'queue', 'departments']
  const activeStepIndex = stepOrder.indexOf(activeTab)
  const isFirstStep = activeStepIndex === 0
  const isLastStep = activeStepIndex === stepOrder.length - 1
  const createMode = isNew && !savedClusterId

  const tabs: { key: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { key: 'basic',       label: 'Basic Info',    icon: <Palette size={14} /> },
    { key: 'hours',       label: 'Office Hours',  icon: <Clock size={14} /> },
    { key: 'queue',       label: 'Queue Settings',icon: <Settings2 size={14} /> },
    { key: 'departments', label: 'Departments',   icon: <Building2 size={14} /> },
  ]

  function addLeader(username: string) {
    const found = users.find((u) => u.username === username)
    if (!found || existingUsernames.has(username)) return
    setMembers((prev) => [
      ...prev,
      { username, cluster_role: mapPortalRoleToClusterRole(found.role), scoped_departments: [] },
    ])
    setLeaderSearch('')
    setLeaderError('')
  }

  async function finalizeCreateCluster() {
    setIsCreating(true)
    const basicResult = await saveClusterAction(buildClusterPayload())
    if (!basicResult.success || !basicResult.id) {
      setIsCreating(false)
      setBasicError(basicResult.error ?? 'Failed to create cluster')
      return
    }

    const clusterId = basicResult.id
    setSavedClusterId(clusterId)

    const deptResult = await setClusterDepartmentsAction(clusterId, Array.from(selectedDepts))
    if (!deptResult.success) {
      setIsCreating(false)
      setDeptError(deptResult.error ?? 'Failed to save departments')
      return
    }

    const settingsResult = await saveClusterSettingsAction(clusterId, {
      allow_dept_users_see_queue: allowDeptSeeQueue,
      single_active_task_per_user: singleActive,
      auto_start_next_task: autoStart,
      require_pause_reason: requirePauseReason,
    })
    if (!settingsResult.success) {
      setIsCreating(false)
      setQueueError(settingsResult.error ?? 'Failed to save queue settings')
      return
    }

    // Auto-add all users from selected departments
    const deptNames = new Set(departments.filter((d) => selectedDepts.has(d.id)).map((d) => d.name))
    const deptUsers = users.filter((u) => u.department && deptNames.has(u.department))
    const deptUsernames = new Set(deptUsers.map((u) => u.username))

    for (const u of deptUsers) {
      const existing = members.find((m) => m.username === u.username)
      await upsertClusterMemberAction(clusterId, {
        username: u.username,
        cluster_role: existing?.cluster_role ?? mapPortalRoleToClusterRole(u.role),
        scoped_departments: existing?.scoped_departments?.length ? existing.scoped_departments : null,
      })
    }
    // Also save manually-picked leaders not already in the selected depts
    for (const m of members) {
      if (deptUsernames.has(m.username)) continue
      const memberResult = await upsertClusterMemberAction(clusterId, {
        username: m.username,
        cluster_role: m.cluster_role,
        scoped_departments: m.scoped_departments.length > 0 ? m.scoped_departments : null,
      })
      if (!memberResult.success) {
        setLeaderError(memberResult.error ?? 'Failed to save cluster leaders')
        return
      }
    }

    router.replace(`/dashboard/clusters/${clusterId}`)
    router.refresh()
  }

  function goBack() {
    if (isFirstStep) return
    setActiveTab(stepOrder[activeStepIndex - 1])
  }

  function goNext() {
    if (activeTab === 'basic') {
      if (!name.trim()) {
        setBasicError('Cluster name is required')
        return
      }
      setBasicError('')
      setActiveTab('hours')
      return
    }

    if (activeTab === 'hours') {
      setActiveTab('queue')
      return
    }

    if (activeTab === 'queue') {
      setActiveTab('departments')
      return
    }

    if (activeTab === 'departments') {
      if (selectedDepts.size === 0) {
        setDeptError('Select at least one department before continuing')
        return
      }
      if (existingManagers.length === 0) {
        setLeaderError('Add at least one supervisor, manager, or super manager before continuing')
        return
      }
      setDeptError('')
      setLeaderError('')
      // departments is the last step in create mode — finalize
      finalizeCreateCluster()
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/clusters"
            className="flex items-center justify-center w-9 h-9 rounded-xl transition-all hover:opacity-80"
            style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
          >
            <ArrowLeft size={16} />
          </Link>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: color + '20' }}
          >
            <Layers size={16} style={{ color }} />
          </div>
          <div>
            <h1 className="text-lg font-bold">{isNew ? 'New Cluster' : (name || 'Edit Cluster')}</h1>
            <p className="text-xs opacity-50">{isNew ? 'Create a new hall / realm' : `Cluster settings`}</p>
          </div>
        </div>

        {!isNew && (
          <button
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-red-400 transition-all hover:bg-red-500/10"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <Trash2 size={13} />
            Delete Cluster
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}>
        {tabs.map(({ key, label, icon, disabled }) => {
          const tabIndex = stepOrder.indexOf(key)
          const lockedByWizard = isNew && tabIndex > activeStepIndex
          const isDisabled = Boolean(disabled || lockedByWizard)
          return (
          <button
            key={key}
            onClick={() => !isDisabled && setActiveTab(key)}
            disabled={isDisabled}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: activeTab === key ? 'var(--color-card)' : 'transparent',
              color: activeTab === key ? color : isDisabled ? 'var(--color-text-muted)' : undefined,
              opacity: isDisabled ? 0.4 : 1,
              boxShadow: activeTab === key ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
            }}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </button>
        )})}
      </div>

      {/* ── Tab: Basic Info ─────────────────────────────────────────────────── */}
      {activeTab === 'basic' && (
        <Section title="Basic Information" icon={<Palette size={15} />}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 opacity-70">Cluster Name *</label>
              <input
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2F Hall"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5 opacity-70">Description (optional)</label>
              <textarea
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
                style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
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
                    className="w-8 h-8 rounded-full transition-all"
                    style={{
                      background: c,
                      outline: color === c ? `3px solid ${c}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* ── Manager picker (new) / manager info (edit) ── */}
            {isNew ? null : (
              <div>
                <label className="block text-xs font-medium mb-1">
                  Cluster Manager <span className="text-red-400">*</span>
                </label>
                <p className="text-xs opacity-50 mb-2">Must be a Supervisor, Manager, or Super Manager.</p>
                {managerUsername ? (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: '#2B7FFF15', border: '1px solid #2B7FFF40' }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: avatarColor(managerUsername) }}
                    >
                      {getInitials(managerUsername)}
                    </div>
                    <span className="flex-1 text-sm font-medium">{managerUsername}</span>
                    <button onClick={() => setManagerUsername('')} className="opacity-50 hover:opacity-100 transition-opacity">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                    <input
                      className="w-full rounded-xl pl-8 pr-3 py-2.5 text-sm outline-none"
                      style={{
                        background: 'var(--color-input)',
                        border: managerError ? '1px solid #EF4444' : '1px solid var(--color-border)',
                      }}
                      placeholder="Search by username…"
                      value={managerSearch}
                      onChange={(e) => { setManagerSearch(e.target.value); setShowManagerDropdown(true) }}
                      onFocus={() => setShowManagerDropdown(true)}
                      onBlur={() => setTimeout(() => setShowManagerDropdown(false), 150)}
                    />
                    {showManagerDropdown && (
                      <div
                        className="absolute top-full mt-1 left-0 right-0 rounded-xl shadow-2xl z-20 overflow-auto"
                        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', maxHeight: 220 }}
                      >
                        {eligibleManagers.length === 0 ? (
                          <p className="text-xs opacity-40 text-center py-4">No eligible users found</p>
                        ) : eligibleManagers.slice(0, 20).map((u) => (
                          <button
                            key={u.username}
                            onMouseDown={() => {
                              setManagerUsername(u.username)
                              setManagerSearch('')
                              setShowManagerDropdown(false)
                              setManagerError('')
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-all hover:opacity-80"
                            style={{ borderBottom: '1px solid var(--color-border)' }}
                          >
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                              style={{ background: avatarColor(u.username) }}
                            >
                              {getInitials(u.username)}
                            </div>
                            <span className="flex-1 font-medium">{u.username}</span>
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full"
                              style={{ background: 'var(--color-input)' }}
                            >
                              {u.role}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {managerError && <p className="text-xs text-red-400 mt-1.5">{managerError}</p>}
              </div>
            )}
            {!isNew && (
              <div>
                <label className="block text-xs font-medium mb-1.5 opacity-70">Cluster Managers</label>
                {existingManagers.length === 0 ? (
                  <p className="text-xs" style={{ color: '#F59E0B' }}>⚠ No manager assigned — go to Members tab to add one.</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {existingManagers.map((m) => (
                      <div
                        key={m.username}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
                        style={{ background: '#2B7FFF15', border: '1px solid #2B7FFF40' }}
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                          style={{ background: avatarColor(m.username) }}
                        >
                          {getInitials(m.username)}
                        </div>
                        <span className="text-xs font-medium">{m.username}</span>
                        <span className="text-[10px] opacity-40 capitalize">{m.cluster_role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {basicError && <p className="text-xs text-red-400">{basicError}</p>}

            <div className="flex justify-between pt-2">
              <div />
              {isNew ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${color}, #1A6AE4)` }}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              ) : (
                <SaveBtn
                  saving={basicSaving}
                  saved={basicSaved}
                  onClick={saveBasic}
                  label="Save Changes"
                />
              )}
            </div>
          </div>
        </Section>
      )}

      {/* ── Tab: Office Hours ────────────────────────────────────────────────── */}
      {activeTab === 'hours' && (
        <Section title="Office Hours (PKT)" icon={<Clock size={15} />}>
          <div className="space-y-5">
            <div>
              <p className="text-xs opacity-60 mb-2">Work Hours</p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs opacity-50 mb-1.5">Start</label>
                  <TimeSelectPicker
                    value={officeStart}
                    onChange={setOfficeStart}
                    className="w-full"
                    style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs opacity-50 mb-1.5">End</label>
                  <TimeSelectPicker
                    value={officeEnd}
                    onChange={setOfficeEnd}
                    className="w-full"
                    style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs opacity-60 mb-2">Mon–Thu Break</p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs opacity-50 mb-1.5">From</label>
                  <TimeSelectPicker
                    value={breakStart}
                    onChange={setBreakStart}
                    className="w-full"
                    style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs opacity-50 mb-1.5">To</label>
                  <TimeSelectPicker
                    value={breakEnd}
                    onChange={setBreakEnd}
                    className="w-full"
                    style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs opacity-60 mb-2">Friday Break (Jumu&apos;ah)</p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs opacity-50 mb-1.5">From</label>
                  <TimeSelectPicker
                    value={fridayBreakStart}
                    onChange={setFridayBreakStart}
                    className="w-full"
                    style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs opacity-50 mb-1.5">To</label>
                  <TimeSelectPicker
                    value={fridayBreakEnd}
                    onChange={setFridayBreakEnd}
                    className="w-full"
                    style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-1">
              {isNew ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                >
                  Back
                </button>
              ) : <div />}
              {isNew ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${color}, #1A6AE4)` }}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              ) : (
                <SaveBtn saving={hoursSaving} saved={hoursSaved} onClick={saveHours} />
              )}
            </div>
          </div>
        </Section>
      )}

      {/* ── Tab: Queue Settings ──────────────────────────────────────────────── */}
      {activeTab === 'queue' && (
        <Section title="Queue & Scheduler Settings" icon={<Settings2 size={15} />}>
          <div className="space-y-1">
            {/* Info callout */}
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 mb-4" style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}>
              <Info size={13} className="mt-0.5 flex-shrink-0 opacity-40" />
              <p className="text-xs opacity-50 leading-relaxed">
                These settings control how tasks are queued and processed within this hall.
                Time tracking counts only valid <strong>office-hours minutes</strong>.
              </p>
            </div>

            {[
              {
                id: 'allow_dept_see_queue',
                icon: <Users size={14} />,
                label: 'Department members can view queue',
                desc: 'Allow all users whose department belongs to this hall to see the task queue — not just managers.',
                checked: allowDeptSeeQueue,
                onChange: (v: boolean) => setAllowDeptSeeQueue(v),
              },
              {
                id: 'single_active',
                icon: <Layers size={14} />,
                label: 'One active task at a time',
                desc: 'Users in this hall may only have a single task in the active state. Additional assignments enter the queue automatically.',
                checked: singleActive,
                onChange: (v: boolean) => {
                  setSingleActive(v)
                  if (!v) setAutoStart(false)
                },
                warning: singleActive
                  ? 'Enabling this will immediately move all but the highest-priority active task per user into the queue.'
                  : undefined,
              },
              {
                id: 'auto_start',
                icon: <Play size={14} />,
                label: 'Auto-start next queued task',
                desc: 'When the current active task completes or is blocked, the next highest-priority queued task activates automatically.',
                checked: autoStart,
                onChange: (v: boolean) => setAutoStart(v),
                disabled: !singleActive,
                indent: true,
              },
              {
                id: 'require_pause_reason',
                icon: <PauseCircle size={14} />,
                label: 'Require pause reason',
                desc: 'Users must provide a written reason whenever they pause an active task.',
                checked: requirePauseReason,
                onChange: (v: boolean) => setRequirePauseReason(v),
              },
            ].map(({ id, icon, label, desc, checked, onChange, disabled, indent, warning }) => (
              <div
                key={id}
                className={`flex items-start justify-between gap-4 rounded-xl p-4 ${indent ? 'ml-6' : ''}`}
                style={{
                  background: indent ? 'transparent' : 'var(--color-input)',
                  border: indent ? '1px solid var(--color-border)' : '1px solid var(--color-border)',
                  opacity: disabled ? 0.45 : 1,
                  borderLeft: indent ? `3px solid var(--color-border)` : undefined,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="opacity-50">{icon}</span>
                    <p className="text-sm font-medium">{label}</p>
                  </div>
                  <p className="text-xs opacity-50 leading-relaxed ml-6">{desc}</p>
                  {warning && (
                    <div className="mt-2 ml-6 flex items-start gap-1.5 rounded-lg px-3 py-2" style={{ background: '#F59E0B10', border: '1px solid #F59E0B30' }}>
                      <p className="text-xs" style={{ color: '#F59E0B' }}>{warning}</p>
                    </div>
                  )}
                </div>
                <Toggle checked={checked} onChange={disabled ? () => {} : onChange} disabled={disabled} />
              </div>
            ))}

            {queueError && <p className="text-xs text-red-400 px-1">{queueError}</p>}

            <div className="flex justify-between pt-3">
              {isNew ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                >
                  Back
                </button>
              ) : <div />}
              {isNew ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${color}, #1A6AE4)` }}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              ) : (
                <SaveBtn saving={queueSaving} saved={queueSaved} onClick={saveQueue} />
              )}
            </div>
          </div>
        </Section>
      )}

      {/* ── Tab: Departments ─────────────────────────────────────────────────── */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          {/* Departments section */}
          <Section title="Departments" icon={<Building2 size={15} />}>
            <div className="space-y-3">
              {/* Auto-member info */}
              <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}>
                <Info size={13} className="mt-0.5 flex-shrink-0 opacity-40" />
                <p className="text-xs opacity-50 leading-relaxed">
                  All users in the selected departments will be automatically added as cluster members. New users added to those departments later will also be included automatically.
                </p>
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                <input
                  className="w-full rounded-xl pl-8 pr-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                  placeholder="Search departments…"
                  value={deptSearch}
                  onChange={(e) => setDeptSearch(e.target.value)}
                />
              </div>

              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {filteredDepts.map((dept) => {
                  const checked = selectedDepts.has(dept.id)
                  return (
                    <button
                      key={dept.id}
                      onClick={() => {
                        setSelectedDepts((prev) => {
                          const next = new Set(prev)
                          next.has(dept.id) ? next.delete(dept.id) : next.add(dept.id)
                          return next
                        })
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-all hover:opacity-80"
                      style={{ background: 'var(--color-input)', border: `1px solid ${checked ? color + '60' : 'var(--color-border)'}` }}
                    >
                      <div
                        className="w-5 h-5 rounded-md flex items-center justify-center border-2 flex-shrink-0 transition-all"
                        style={{
                          background: checked ? color : 'transparent',
                          borderColor: checked ? color : 'var(--color-border)',
                        }}
                      >
                        {checked && <Check size={11} color="white" strokeWidth={3} />}
                      </div>
                      <Building2 size={13} className="opacity-50" />
                      <span className="flex-1">{dept.name}</span>
                      {checked && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: color + '20', color }}>
                          Selected
                        </span>
                      )}
                    </button>
                  )
                })}
                {filteredDepts.length === 0 && (
                  <p className="text-xs opacity-40 text-center py-6">No departments found</p>
                )}
              </div>

              <p className="text-xs opacity-50 pt-1">
                {selectedDepts.size} department{selectedDepts.size !== 1 ? 's' : ''} selected
              </p>
              {deptError && <p className="text-xs text-red-400">{deptError}</p>}
            </div>
          </Section>

          {/* Hall Leaders section */}
          <Section title="Hall Leaders *" icon={<ShieldCheck size={15} />}>
            <div className="space-y-4">
              <p className="text-xs opacity-50 -mt-2">
                {selectedDepts.size > 0
                  ? 'Showing Supervisors, Managers & Super Managers from the selected departments'
                  : 'Select departments first to filter by department, or search all Supervisors, Managers & Super Managers'}
              </p>

              {/* Already selected leaders */}
              {existingManagers.length > 0 && (
                <div>
                  <p className="text-xs font-medium opacity-60 mb-2">Added Leaders</p>
                  <div className="space-y-1">
                    {existingManagers.map((m) => {
                      const roleColor = m.cluster_role === 'owner' ? '#F59E0B' : m.cluster_role === 'manager' ? '#2B7FFF' : '#8B5CF6'
                      return (
                        <div
                          key={m.username}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                          style={{ background: roleColor + '12', border: `1px solid ${roleColor}30` }}
                        >
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ background: avatarColor(m.username) }}
                          >
                            {getInitials(m.username)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{m.username}</p>
                            <p className="text-[11px] capitalize" style={{ color: roleColor }}>{m.cluster_role}</p>
                          </div>
                          <button
                            onClick={() => setMembers((prev) => prev.filter((mm) => mm.username !== m.username))}
                            className="p-1.5 rounded-lg opacity-40 hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Search + inline list */}
              <div>
                <p className="text-xs font-medium opacity-60 mb-2">
                  {existingManagers.length > 0 ? 'Add More Leaders' : 'Add Leaders'}
                </p>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                  <input
                    className="w-full rounded-xl pl-8 pr-3 py-2.5 text-sm outline-none"
                    style={{
                      background: 'var(--color-input)',
                      border: leaderError ? '1px solid #EF4444' : '1px solid var(--color-border)',
                    }}
                    placeholder="Search by name or role…"
                    value={leaderSearch}
                    onChange={(e) => setLeaderSearch(e.target.value)}
                  />
                </div>

                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {eligibleLeaders.length === 0 ? (
                    <div className="text-center py-8">
                      <ShieldCheck size={24} className="mx-auto mb-2 opacity-20" />
                      <p className="text-xs opacity-40">
                        {selectedDepts.size > 0
                          ? 'No eligible leaders in the selected departments'
                          : 'No supervisors, managers, or super managers found'}
                      </p>
                    </div>
                  ) : eligibleLeaders.slice(0, 30).map((u) => {
                    const roleColor = u.role === 'Super Manager' ? '#F59E0B' : u.role === 'Manager' ? '#2B7FFF' : '#8B5CF6'
                    return (
                      <button
                        key={u.username}
                        onClick={() => addLeader(u.username)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all hover:opacity-80"
                        style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ background: avatarColor(u.username) }}
                        >
                          {getInitials(u.username)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{u.username}</p>
                          {u.department && <p className="text-[11px] opacity-40 truncate">{u.department}</p>}
                        </div>
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                          style={{ background: roleColor + '20', color: roleColor }}
                        >
                          {u.role}
                        </span>
                        <Plus size={13} className="opacity-40 flex-shrink-0" />
                      </button>
                    )
                  })}
                </div>
              </div>

              {leaderError && <p className="text-xs text-red-400">{leaderError}</p>}
            </div>
          </Section>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <div />
            {isNew ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${color}, #1A6AE4)` }}
                >
                  {isCreating ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {isCreating ? 'Creating…' : 'Create Cluster'}
                </button>
              </div>
            ) : (
              <SaveBtn saving={deptSaving} saved={deptSaved} onClick={saveDepts} label="Save Departments" />
            )}
          </div>
        </div>
      )}

      {/* Members tab removed — all users from selected departments are auto-added as cluster members */}

      {/* Creating overlay */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
          <div className="rounded-2xl px-8 py-7 flex flex-col items-center gap-4 shadow-2xl" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <div className="w-12 h-12 rounded-full border-4 border-[#2B7FFF]/30 border-t-[#2B7FFF] animate-spin" />
            <p className="text-sm font-semibold">Creating cluster&hellip;</p>
            <p className="text-xs opacity-50 text-center max-w-xs">Saving departments, settings, and auto-adding members. Please wait.</p>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDelete && (
        <ConfirmDialog
          open
          title="Delete Cluster"
          description={`Delete "${name}"? This will remove all department and member assignments. Tasks in this cluster will become unclustered.`}
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
          confirmLabel="Delete"
          danger
        />
      )}
    </div>
  )
}

// ─── Tiny hook for loading state ──────────────────────────────────────────────
function useStateTransition(): [boolean, (v: boolean) => void] {
  const [pending, setPending] = useState(false)
  return [pending, setPending]
}
