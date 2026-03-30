'use client'

import { useMemo, useState } from 'react'
import { Search, Filter, TrendingUp, Trash2, Settings2, Save, X } from 'lucide-react'
import type { Campaign, Account, SessionUser } from '@/types'
import { saveCampaign, saveCampaignBatch, deleteCampaign } from '@/app/dashboard/campaigns/actions'
import { RunStopToggle } from '@/components/ui/run-stop-toggle'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

type Condition = { id: string; name: string; description: string | null }

type DraftCampaign = {
  campaign_name: string
  workflow: string
  enabled: boolean
  conditions: string[]
}

function formatWf(w: string) {
  const map: Record<string, string> = {
    'workflow-0': 'W0 · Default',
    'workflow-1': 'W1',
    'workflow-2': 'W2',
    'workflow-3': 'W3',
  }
  return map[w] || w
}

interface Props {
  campaigns: Campaign[]
  accounts: Account[]
  user: SessionUser
  conditions: Condition[]
  initialAccountFilter?: string
}

export function CampaignsPage({ campaigns: initial, accounts, user, conditions, initialAccountFilter = '' }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const [campaigns, setCampaigns] = useState(initial)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState(initialAccountFilter)
  const [saving, setSaving] = useState<string | null>(null)
  const [managingAccount, setManagingAccount] = useState<string | null>(null)
  const [savingBulk, setSavingBulk] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, DraftCampaign>>({})
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null)

  const accountNameMap = useMemo(() => {
    return Object.fromEntries(accounts.map(a => [a.customer_id, a.account_name || '']))
  }, [accounts])

  const filtered = useMemo(() => {
    let list = campaigns
    if (accountFilter) list = list.filter(c => c.customer_id === accountFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.campaign_name.toLowerCase().includes(q) ||
        c.customer_id.toLowerCase().includes(q)
      )
    }
    return list
  }, [campaigns, search, accountFilter])

  const grouped = useMemo(() => {
    const map: Record<string, Campaign[]> = {}
    for (const c of filtered) {
      if (!map[c.customer_id]) map[c.customer_id] = []
      map[c.customer_id].push(c)
    }
    return map
  }, [filtered])

  const uniqueAccounts = useMemo(() => [...new Set(campaigns.map(c => c.customer_id))].sort(), [campaigns])

  function openManage(accountId: string) {
    const accountCampaigns = campaigns.filter(c => c.customer_id === accountId)
    const next: Record<string, DraftCampaign> = {}
    accountCampaigns.forEach(c => {
      const key = `${c.customer_id}::${c.campaign_name}`
      next[key] = {
        campaign_name: c.campaign_name,
        workflow: c.workflow,
        enabled: c.enabled,
        conditions: c.removal_conditions ? c.removal_conditions.split(',').map(s => s.trim()).filter(Boolean) : [],
      }
    })
    setDrafts(next)
    setManagingAccount(accountId)
  }

  function updateDraft(accountId: string, campaignName: string, patch: Partial<DraftCampaign>) {
    const key = `${accountId}::${campaignName}`
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function handleToggle(c: Campaign) {
    const key = `${c.customer_id}-${c.campaign_name}`
    setSaving(key)
    const res = await saveCampaign({
      ...c,
      enabled: !c.enabled,
      removal_conditions: c.removal_conditions || '',
    })
    if (res.success) {
      setCampaigns(prev => prev.map(x =>
        x.customer_id === c.customer_id && x.campaign_name === c.campaign_name ? { ...x, enabled: !x.enabled } : x
      ))
    }
    setSaving(null)
  }

  async function handleDelete(c: Campaign) {
    const res = await deleteCampaign(c.customer_id, c.campaign_name, c.workflow)
    if (res.success) {
      setCampaigns(prev => prev.filter(x => !(x.customer_id === c.customer_id && x.campaign_name === c.campaign_name)))
    }
  }

  async function saveAllForAccount() {
    if (!managingAccount) return
    setSavingBulk(true)
    const payload = Object.entries(drafts).map(([key, draft]) => {
      const customer_id = key.split('::')[0]
      return {
        customer_id,
        campaign_name: draft.campaign_name,
        workflow: draft.workflow,
        enabled: draft.enabled,
        removal_conditions: draft.conditions.join(','),
      }
    })

    const res = await saveCampaignBatch(payload)
    if (res.success) {
      setCampaigns(prev => prev.map(c => {
        if (c.customer_id !== managingAccount) return c
        const d = drafts[`${c.customer_id}::${c.campaign_name}`]
        if (!d) return c
        return {
          ...c,
          enabled: d.enabled,
          workflow: d.workflow,
          removal_conditions: d.conditions.join(','),
        }
      }))
      setManagingAccount(null)
    }
    setSavingBulk(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Campaigns</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>
            {campaigns.length} campaigns across {uniqueAccounts.length} accounts
          </p>
        </div>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search campaigns..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}
            />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0 sm:min-w-[150px]">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={accountFilter}
              onChange={e => setAccountFilter(e.target.value)}
              className="h-10 px-3 rounded-lg text-sm outline-none w-full"
              style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}
            >
              <option value="">All Accounts</option>
              {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="card p-12 text-center">
          <TrendingUp size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No campaigns found</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([accountId, camps]) => (
            <div key={accountId} className="card overflow-hidden">
              <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--slate-100)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: 'var(--blue-600)' }}>
                    {accountId.split('-')[0]?.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold truncate" style={{ color: 'var(--slate-900)' }}>{accountId}</span>
                      {!!accountNameMap[accountId] && (
                        <span className="text-xs truncate max-w-[160px]" style={{ color: 'var(--slate-500)' }}>
                          {accountNameMap[accountId]}
                        </span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--slate-400)' }}>{camps.length} campaigns</span>
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => openManage(accountId)}
                    className="btn-motion h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                    style={{ background: 'var(--blue-50)', color: 'var(--blue-700)', border: '1px solid var(--blue-200)' }}
                  >
                    <Settings2 size={13} /> Manage Conditions
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '35%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: canEdit ? '32%' : '37%' }} />
                  <col style={{ width: '10%' }} />
                  {canEdit && <col style={{ width: '10%' }} />}
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
                    <th className="text-left px-5 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>Campaign Name</th>
                    <th className="text-left px-5 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>Workflow</th>
                    <th className="text-left px-5 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>Conditions</th>
                    <th className="text-center px-5 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>Enabled</th>
                    {canEdit && <th className="text-center px-5 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {camps.map(c => {
                    const key = `${c.customer_id}-${c.campaign_name}`
                    return (
                      <tr key={key} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                        <td className="px-5 py-3 font-medium" style={{ color: 'var(--slate-800)' }}>{c.campaign_name}</td>
                        <td className="px-5 py-3">
                          <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: 'var(--blue-50)', color: 'var(--blue-700)' }}>{formatWf(c.workflow)}</span>
                        </td>
                        <td className="px-5 py-3 text-xs overflow-hidden" style={{ color: 'var(--slate-500)' }}>
                          <span className="truncate block max-w-full">{c.removal_conditions || '—'}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <RunStopToggle
                            enabled={c.enabled}
                            disabled={saving === key || !canEdit}
                            onToggle={() => canEdit && handleToggle(c)}
                          />
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3 text-center">
                            <button onClick={() => setPendingDelete(c)} className="btn-motion p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {managingAccount && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={e => { if (e.target === e.currentTarget) setManagingAccount(null) }}>
          <div className="glass-strong w-full sm:max-w-6xl max-h-[95vh] sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden animate-slide-up">
            <div className="px-4 py-3 sm:px-6 sm:py-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--slate-200)' }}>
              <div className="min-w-0">
                <h3 className="font-bold text-base sm:text-lg truncate" style={{ color: 'var(--slate-900)' }}>Conditions — {managingAccount}</h3>
                {!!accountNameMap[managingAccount] && <p className="text-sm truncate" style={{ color: 'var(--slate-500)' }}>{accountNameMap[managingAccount]}</p>}
              </div>
              <button onClick={() => setManagingAccount(null)} className="btn-motion p-2 rounded-lg hover:bg-slate-100 shrink-0"><X size={16} /></button>
            </div>

            <div className="p-3 sm:p-4 md:p-6 overflow-y-auto space-y-4">
              {campaigns.filter(c => c.customer_id === managingAccount).map((c, idx) => {
                const key = `${c.customer_id}::${c.campaign_name}`
                const draft = drafts[key]
                if (!draft) return null

                return (
                  <div key={key} className="card p-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h4 className="font-semibold" style={{ color: 'var(--slate-800)' }}>{idx + 1}. {c.campaign_name}</h4>
                      </div>
                      <RunStopToggle
                        enabled={draft.enabled}
                        onToggle={() => updateDraft(c.customer_id, c.campaign_name, { enabled: !draft.enabled })}
                      />
                    </div>

                    <div className="mb-3">
                      <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Workflow</label>
                      <select
                        value={draft.workflow}
                        onChange={e => updateDraft(c.customer_id, c.campaign_name, { workflow: e.target.value })}
                        className="mt-1 w-full h-10 px-3 rounded-lg text-sm outline-none"
                        style={{ border: '1.5px solid var(--slate-200)', background: '#fff' }}
                      >
                        <option value="workflow-0">Workflow 0 (Default)</option>
                        <option value="workflow-1">Workflow 1</option>
                        <option value="workflow-2">Workflow 2</option>
                        <option value="workflow-3">Workflow 3</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {conditions.map(cond => {
                        const checked = draft.conditions.includes(cond.id)
                        return (
                          <label
                            key={cond.id}
                            className="rounded-xl p-3 border cursor-pointer transition-all"
                            style={{
                              border: checked ? '1.5px solid var(--blue-600)' : '1px solid var(--color-border)',
                              background: checked ? 'var(--blue-50)' : 'var(--color-surface)',
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...draft.conditions, cond.id]
                                    : draft.conditions.filter(x => x !== cond.id)
                                  updateDraft(c.customer_id, c.campaign_name, { conditions: next })
                                }}
                                className="mt-1"
                              />
                              <div>
                                <div className="text-sm font-semibold" style={{ color: 'var(--slate-800)' }}>{cond.name}</div>
                                <div className="text-xs" style={{ color: 'var(--slate-500)' }}>{cond.description || 'No description'}</div>
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="px-4 py-3 sm:px-6 sm:py-4 flex flex-wrap justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              <button className="btn-motion h-10 px-4 rounded-lg text-sm" onClick={() => setManagingAccount(null)} style={{ color: 'var(--slate-600)' }}>Close</button>
              <button
                className="btn-motion h-10 px-4 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
                style={{ background: '#059669' }}
                disabled={savingBulk}
                onClick={saveAllForAccount}
              >
                <Save size={14} /> {savingBulk ? 'Saving...' : 'Save All Conditions'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete campaign "${pendingDelete.campaign_name}"?` : 'Delete campaign?'}
        description="This action cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await handleDelete(pendingDelete)
          setPendingDelete(null)
        }}
      />
    </div>
  )
}
