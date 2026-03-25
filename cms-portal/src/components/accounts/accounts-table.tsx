'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Trash2, Pencil, Check, ChevronDown, Copy, RefreshCw } from 'lucide-react'
import { StatusBadge, WorkflowBadge } from '@/components/ui/badges'
import { EnabledToggle } from '@/components/ui/enabled-toggle'
import { AccountModal } from './account-modal'
import { DeleteConfirm } from './delete-confirm'
import { batchToggleAccounts, getAccounts } from '@/app/dashboard/accounts/actions'
import { queryKeys } from '@/lib/query-keys'
import type { Account, SessionUser } from '@/types'

const WORKFLOW_OPTIONS = [
  { value: '', label: 'All Workflows' },
  { value: 'workflow-0', label: 'Workflow 0' },
  { value: 'workflow-1', label: 'Workflow 1' },
  { value: 'workflow-2', label: 'Workflow 2' },
  { value: 'workflow-3', label: 'Workflow 3' },
]
const STATUS_OPTIONS = ['All', 'Pending', 'Running', 'Success', 'Error']
const ENABLED_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '—'
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(isoDate).toLocaleDateString()
}

interface AccountsTableProps {
  accounts: Account[]
  user: SessionUser
  /** customer_id → usernames with explicit access */
  userAccess?: Record<string, string[]>
}

export function AccountsTable({ accounts: initialAccounts, user, userAccess = {} }: AccountsTableProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)

  // Serve from React Query cache on revisit (PortalWarmup pre-populates this)
  const { data: accounts = initialAccounts } = useQuery({
    queryKey: queryKeys.accounts(user.username),
    queryFn: () => getAccounts(),
    initialData: initialAccounts,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  // ── Filters ───────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [workflowFilter, setWorkflowFilter] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('')

  // ── Selection ─────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchPending, startBatch] = useTransition()

  // ── Modals ────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null)

  // ── Filtered data ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return accounts.filter(a => {
      if (search && !a.customer_id.toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter !== 'All' && a.status !== statusFilter) return false
      if (workflowFilter && a.workflow !== workflowFilter) return false
      if (enabledFilter && String(a.enabled) !== enabledFilter) return false
      return true
    })
  }, [accounts, search, statusFilter, workflowFilter, enabledFilter])

  // ── Selection helpers ─────────────────────────────────────
  const allOnPageSelected = filtered.length > 0 && filtered.every(a => selected.has(a.customer_id))

  function toggleSelectAll() {
    if (allOnPageSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(a => next.delete(a.customer_id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(a => next.add(a.customer_id))
        return next
      })
    }
  }

  function toggleSelect(customerId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(customerId)) next.delete(customerId)
      else next.add(customerId)
      return next
    })
  }

  function handleBatch(enable: boolean) {
    const ids = Array.from(selected)
    startBatch(async () => {
      await batchToggleAccounts(ids, enable)
      setSelected(new Set())
    })
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  function openAdd() {
    setEditingAccount(null)
    setModalOpen(true)
  }

  function openEdit(account: Account) {
    setEditingAccount(account)
    setModalOpen(true)
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Google Accounts</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--slate-500)' }}>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''} total
            {filtered.length !== accounts.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={openAdd}
            className="btn-motion flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: 'var(--blue-600)', boxShadow: '0 2px 8px rgba(37,99,235,0.25)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--blue-700)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--blue-600)'; }}
          >
            <Plus size={16} />
            Add Account
          </button>
        )}
      </div>

      {/* ── Filters ───────────────────────────────────────── */}
      <div className="card p-4 flex flex-col sm:flex-row flex-wrap gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--slate-400)' }} />
          <input
            type="text"
            placeholder="Search by Customer ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg text-sm outline-none"
            style={{ border: '1.5px solid var(--slate-200)', color: 'var(--slate-800)' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--blue-400)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--slate-200)'; }}
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center flex-wrap gap-1">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: statusFilter === s ? 'var(--blue-600)' : 'var(--slate-100)',
                color: statusFilter === s ? 'white' : 'var(--slate-600)',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Workflow filter */}
        <div className="relative">
          <select
            value={workflowFilter}
            onChange={e => setWorkflowFilter(e.target.value)}
            className="h-9 pl-3 pr-8 rounded-lg text-sm cursor-pointer outline-none appearance-none"
            style={{ border: '1.5px solid var(--slate-200)', color: 'var(--slate-700)', minWidth: '130px' }}
          >
            {WORKFLOW_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--slate-400)' }} />
        </div>

        {/* Enabled filter */}
        <div className="relative">
          <select
            value={enabledFilter}
            onChange={e => setEnabledFilter(e.target.value)}
            className="h-9 pl-3 pr-8 rounded-lg text-sm cursor-pointer outline-none appearance-none"
            style={{ border: '1.5px solid var(--slate-200)', color: 'var(--slate-700)', minWidth: '100px' }}
          >
            {ENABLED_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--slate-400)' }} />
        </div>
      </div>

      {/* ── Batch action bar ──────────────────────────────── */}
      {selected.size > 0 && canEdit && (
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl animate-fade-in"
          style={{ background: 'var(--blue-50)', border: '1.5px solid var(--blue-200)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--blue-700)' }}>
            {selected.size} selected
          </span>
          <div className="h-4 w-px" style={{ background: 'var(--blue-200)' }} />
          <button
            onClick={() => handleBatch(true)}
            disabled={batchPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: '#10B981' }}
          >
            <Check size={13} /> Enable All
          </button>
          <button
            onClick={() => handleBatch(false)}
            disabled={batchPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
            style={{ background: 'var(--slate-200)', color: 'var(--slate-700)' }}
          >
            Disable All
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs"
            style={{ color: 'var(--slate-500)' }}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[880px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
                {canEdit && (
                  <th className="py-3.5 pl-4 pr-2 w-10">
                    <div
                      className="w-4 h-4 rounded cursor-pointer flex items-center justify-center transition-all"
                      style={{
                        border: `1.5px solid ${allOnPageSelected ? 'var(--blue-600)' : 'var(--slate-300)'}`,
                        background: allOnPageSelected ? 'var(--blue-600)' : 'var(--color-surface)',
                      }}
                      onClick={toggleSelectAll}
                      role="checkbox"
                      aria-checked={allOnPageSelected}
                    >
                      {allOnPageSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                    </div>
                  </th>
                )}
                {['Customer ID', 'Account Name', 'Workflow', 'Status', 'Enabled', 'Last Run', 'Created', 'Users with Access', 'Actions'].map(h => (
                  <th
                    key={h}
                    className="py-3.5 px-4 text-left font-semibold text-xs uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'var(--slate-500)', background: 'var(--slate-50)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={canEdit ? 10 : 9}
                    className="py-20 text-center"
                    style={{ color: 'var(--slate-400)' }}
                  >
                    <RefreshCw size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No accounts found</p>
                    <p className="text-xs mt-1">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : (
                filtered.map((account, idx) => {
                  const isSelected = selected.has(account.customer_id)
                  return (
                    <tr
                      key={account.customer_id}
                      className="group transition-colors"
                      style={{
                        background: isSelected ? 'var(--blue-50)' : idx % 2 === 0 ? 'var(--color-surface)' : 'var(--slate-50)',
                        borderBottom: '1px solid var(--slate-100)',
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--slate-50)'; }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'var(--color-surface)' : 'var(--slate-50)'; }}
                    >
                      {canEdit && (
                        <td className="py-3.5 pl-4 pr-2">
                          <div
                            className="w-4 h-4 rounded cursor-pointer flex items-center justify-center transition-all"
                            style={{
                              border: `1.5px solid ${isSelected ? 'var(--blue-600)' : 'var(--slate-300)'}`,
                              background: isSelected ? 'var(--blue-600)' : 'var(--color-surface)',
                            }}
                            onClick={() => toggleSelect(account.customer_id)}
                          >
                            {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                          </div>
                        </td>
                      )}

                      {/* Customer ID */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-mono font-semibold text-sm"
                            style={{ color: 'var(--slate-900)' }}
                          >
                            {account.customer_id}
                          </span>
                          <button
                            onClick={() => copyToClipboard(account.customer_id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                            style={{ color: 'var(--slate-400)' }}
                            title="Copy customer ID"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </td>

                      <td className="py-3.5 px-4" style={{ color: 'var(--slate-600)' }}>
                        {account.account_name || account.drive_code_comments || '—'}
                      </td>

                      {/* Workflow */}
                      <td className="py-3.5 px-4">
                        <WorkflowBadge workflow={account.workflow} />
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <StatusBadge status={account.status} />
                      </td>

                      {/* Enabled toggle */}
                      <td className="py-3.5 px-4">
                        <EnabledToggle
                          customerId={account.customer_id}
                          enabled={account.enabled}
                          canEdit={canEdit}
                        />
                      </td>

                      {/* Last run */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-sm" style={{ color: 'var(--slate-500)' }}>
                        {formatRelativeTime(account.last_run)}
                      </td>

                      {/* Created */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-sm" style={{ color: 'var(--slate-500)' }}>
                        {new Date(account.created_date).toLocaleDateString()}
                      </td>

                      {/* Users with Access */}
                      <td className="py-3.5 px-4">
                        {(() => {
                          const users = userAccess[account.customer_id] ?? []
                          if (users.length === 0) return (
                            <span className="text-xs" style={{ color: 'var(--slate-400)' }}>—</span>
                          )
                          return (
                            <div className="flex flex-wrap gap-1 max-w-[180px]">
                              {users.slice(0, 3).map(u => (
                                <span
                                  key={u}
                                  className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                                  style={{ background: 'rgba(99,102,241,0.1)', color: '#6366F1' }}
                                >
                                  {u}
                                </span>
                              ))}
                              {users.length > 3 && (
                                <span
                                  className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                                  style={{ background: 'var(--slate-100)', color: 'var(--slate-500)' }}
                                  title={users.slice(3).join(', ')}
                                >
                                  +{users.length - 3}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4">
                        {canEdit && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEdit(account)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                              style={{ color: 'var(--slate-500)' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--blue-50)'; e.currentTarget.style.color = 'var(--blue-600)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--slate-500)'; }}
                              title="Edit"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => router.push(`/dashboard/campaigns?account=${encodeURIComponent(account.customer_id)}`)}
                              className="btn-motion px-2.5 h-8 rounded-lg text-xs font-semibold"
                              style={{ background: 'var(--slate-100)', color: 'var(--slate-700)' }}
                              title="Manage campaigns"
                            >
                              Manage
                            </button>
                            <button
                              onClick={() => setDeletingAccount(account)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                              style={{ color: 'var(--slate-500)' }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#EF4444'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--slate-500)'; }}
                              title="Delete"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer */}
        {filtered.length > 0 && (
          <div
            className="px-4 py-3 flex items-center justify-between text-xs"
            style={{ color: 'var(--slate-500)', borderTop: '1px solid var(--slate-100)' }}
          >
            <span>Showing {filtered.length} of {accounts.length} accounts</span>
            {selected.size > 0 && (
              <span style={{ color: 'var(--blue-600)' }}>{selected.size} selected</span>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────── */}
      {modalOpen && (
        <AccountModal
          account={editingAccount}
          onClose={() => {
            setModalOpen(false)
            // Invalidate React Query cache so next render shows fresh data
            queryClient.invalidateQueries({ queryKey: queryKeys.accounts(user.username) })
          }}
        />
      )}

      {deletingAccount && (
        <DeleteConfirm
          account={deletingAccount}
          onClose={() => setDeletingAccount(null)}
        />
      )}
    </div>
  )
}
