'use client'

import { useState, useTransition } from 'react'
import {
  Settings2,
  Layers,
  Play,
  Users,
  Eye,
  AlertTriangle,
  Check,
  RefreshCw,
  Info,
  Ban,
} from 'lucide-react'
import { getClusterSettingsAction, saveClusterSettingsAction } from '@/app/dashboard/tasks/actions'
import type { ClusterSettings } from '@/types'

// ─── Toggle switch component ──────────────────────────────────────────────────
function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  id: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        checked ? 'bg-[#2B7FFF]' : 'bg-white/10',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
        'focus-visible:ring-[#2B7FFF]',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0',
          'transition duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

// ─── Setting row ──────────────────────────────────────────────────────────────
function SettingRow({
  id,
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
  warning,
  indent,
}: {
  id: string
  icon: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  warning?: string
  indent?: boolean
}) {
  return (
    <div
      className={[
        'flex items-start justify-between gap-4 rounded-xl p-4',
        indent ? 'ml-6 border-l-2 border-white/10 pl-4' : '',
        disabled ? 'opacity-50' : 'bg-white/[0.03] hover:bg-white/[0.06] transition-colors',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label
          htmlFor={id}
          className={['flex items-center gap-2 text-sm font-medium', disabled ? 'cursor-not-allowed' : 'cursor-pointer'].join(' ')}
        >
          <span className="text-white/60">{icon}</span>
          <span className="text-white/90">{label}</span>
        </label>
        <p className="text-xs text-white/45 leading-relaxed">{description}</p>
        {warning && checked && (
          <div className="mt-1 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-400" />
            <p className="text-xs text-amber-300/90">{warning}</p>
          </div>
        )}
      </div>
      <ToggleSwitch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props {
  clusterId: string
  /** Initial settings loaded by the parent server component */
  initialSettings: ClusterSettings | null
  /** Whether the current user has permission to save (owner/manager/admin) */
  canEdit: boolean
}

export default function HallSettingsExtended({ clusterId, initialSettings, canEdit }: Props) {
  const defaults: ClusterSettings = initialSettings ?? {
    cluster_id: clusterId,
    allow_dept_users_see_queue: false,
    allow_normal_users_see_queue: true,
    single_active_task_per_user: false,
    auto_start_next_task: true,
    users_cannot_create_tasks: false,
  }

  const [allowDeptSeeQueue, setAllowDeptSeeQueue] = useState(defaults.allow_dept_users_see_queue)
  const [allowNormalUsersSeeQueue, setAllowNormalUsersSeeQueue] = useState(defaults.allow_normal_users_see_queue ?? true)
  const [singleActive, setSingleActive] = useState(defaults.single_active_task_per_user)
  const [autoStart, setAutoStart] = useState(defaults.auto_start_next_task)
  const [usersCannotCreateTasks, setUsersCannotCreateTasks] = useState(defaults.users_cannot_create_tasks ?? false)

  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track if anything changed since last save
  const isDirty =
    allowDeptSeeQueue !== defaults.allow_dept_users_see_queue ||
    allowNormalUsersSeeQueue !== (defaults.allow_normal_users_see_queue ?? true) ||
    singleActive !== defaults.single_active_task_per_user ||
    autoStart !== defaults.auto_start_next_task ||
    usersCannotCreateTasks !== (defaults.users_cannot_create_tasks ?? false)

  function handleSingleActiveChange(v: boolean) {
    setSingleActive(v)
    // auto_start only makes sense when single_active is ON
    if (!v) setAutoStart(false)
  }

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveClusterSettingsAction(clusterId, {
        allow_dept_users_see_queue: allowDeptSeeQueue,
        allow_normal_users_see_queue: allowNormalUsersSeeQueue,
        single_active_task_per_user: singleActive,
        auto_start_next_task: autoStart,
        users_cannot_create_tasks: usersCannotCreateTasks,
      })
      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        setError(result.error ?? 'Failed to save settings.')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#12131A] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2B7FFF]/15">
          <Settings2 size={16} className="text-[#2B7FFF]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white/90">Hall Scheduler Settings</h3>
          <p className="text-xs text-white/45">Control task queue behaviour for this hall</p>
        </div>
      </div>

      <div className="p-4 space-y-1">
        {/* ── Visibility ─────────────────────────────────────── */}
        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Visibility
        </p>

        <SettingRow
          id="allow_dept_users_see_queue"
          icon={<Users size={14} />}
          label="Department members can see queue"
          description="When enabled, all users whose department belongs to this hall can view the current task queue — not just managers."
          checked={allowDeptSeeQueue}
          onChange={canEdit ? setAllowDeptSeeQueue : () => {}}
          disabled={!canEdit}
        />

        <SettingRow
          id="allow_normal_users_see_queue"
          icon={<Eye size={14} />}
          label="Normal users can view queue"
          description="When disabled, only Managers, Supervisors and Admins of this hall can see the task queue. Regular users in the department will not see it, even if the setting above is on."
          checked={allowNormalUsersSeeQueue}
          onChange={canEdit && allowDeptSeeQueue ? setAllowNormalUsersSeeQueue : () => {}}
          disabled={!canEdit || !allowDeptSeeQueue}
          indent
        />

        {/* ── Single-active enforcement ───────────────────────── */}
        <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Task Queue
        </p>

        <SettingRow
          id="single_active_task_per_user"
          icon={<Layers size={14} />}
          label="One active task at a time"
          description="Users in this hall may only have a single task in the active state. Additional assignments enter the queue automatically."
          checked={singleActive}
          onChange={canEdit ? handleSingleActiveChange : () => {}}
          disabled={!canEdit}
          warning="Enabling this will immediately move all but the highest-priority active task per user into the queue."
        />

        {/* Auto-start is indented; only relevant when single_active is ON */}
        <SettingRow
          id="auto_start_next_task"
          icon={<Play size={14} />}
          label="Auto-start next queued task"
          description="When the current active task is completed or permanently blocked, the next highest-priority queued task activates automatically."
          checked={autoStart}
          onChange={canEdit && singleActive ? setAutoStart : () => {}}
          disabled={!canEdit || !singleActive}
          indent
        />

        {/* ── Task Creation ───────────────────────────────────── */}
        <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Task Creation
        </p>

        <SettingRow
          id="users_cannot_create_tasks"
          icon={<Ban size={14} />}
          label="Restrict task creation to managers"
          description="When enabled, normal users (non-managers, non-supervisors) in this hall cannot create new tasks. They can only work on tasks assigned to them by others."
          checked={usersCannotCreateTasks}
          onChange={canEdit ? setUsersCannotCreateTasks : () => {}}
          disabled={!canEdit}
        />
      </div>

      {/* Info callout about time counting */}
      <div className="mx-4 mb-4 flex items-start gap-2 rounded-xl bg-white/[0.04] px-4 py-3">
        <Info size={13} className="mt-0.5 flex-shrink-0 text-white/40" />
        <p className="text-xs text-white/40 leading-relaxed">
          All time tracking counts only valid <strong className="text-white/60">office-hours minutes</strong> — weekends, breaks, and after-hours time are automatically excluded. Effective due dates are calculated from your hall&apos;s configured office schedule.
        </p>
      </div>

      {/* Footer: error + save button */}
      {canEdit && (
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <div className="min-h-[20px]">
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertTriangle size={12} />
                {error}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className={[
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all',
              saved
                ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                : isDirty && !isPending
                ? 'bg-[#2B7FFF] text-white hover:bg-[#2B7FFF]/90'
                : 'bg-white/10 text-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            {isPending ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Saving…
              </>
            ) : saved ? (
              <>
                <Check size={14} />
                Saved
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>
      )}

      {!canEdit && (
        <div className="border-t border-white/10 px-5 py-3">
          <p className="text-xs text-white/30">Only hall owners, managers, or admins can modify these settings.</p>
        </div>
      )}
    </div>
  )
}
