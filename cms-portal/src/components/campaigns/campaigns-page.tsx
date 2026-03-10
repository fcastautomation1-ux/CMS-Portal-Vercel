'use client'

import { useState, useMemo } from 'react'
import { Search, Filter, TrendingUp, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import type { Campaign, Account, SessionUser } from '@/types'
import { saveCampaign, deleteCampaign } from '@/app/dashboard/campaigns/actions'

function formatWf(w: string) {
  const map: Record<string, string> = { 'workflow-0': 'W0 · Default', 'workflow-1': 'W1', 'workflow-2': 'W2', 'workflow-3': 'W3' }
  return map[w] || w
}

interface Props { campaigns: Campaign[]; accounts: Account[]; user: SessionUser }

export function CampaignsPage({ campaigns: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const [campaigns, setCampaigns] = useState(initial)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = campaigns
    if (accountFilter) list = list.filter(c => c.customer_id === accountFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c => c.campaign_name.toLowerCase().includes(q) || c.customer_id.toLowerCase().includes(q))
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

  async function handleToggle(c: Campaign) {
    const key = `${c.customer_id}-${c.campaign_name}`
    setSaving(key)
    const res = await saveCampaign({ ...c, enabled: !c.enabled, removal_conditions: c.removal_conditions || '' })
    if (res.success) setCampaigns(prev => prev.map(x => x.customer_id === c.customer_id && x.campaign_name === c.campaign_name ? { ...x, enabled: !x.enabled } : x))
    setSaving(null)
  }

  async function handleDelete(c: Campaign) {
    if (!confirm(`Delete campaign "${c.campaign_name}"?`)) return
    const res = await deleteCampaign(c.customer_id, c.campaign_name, c.workflow)
    if (res.success) setCampaigns(prev => prev.filter(x => !(x.customer_id === c.customer_id && x.campaign_name === c.campaign_name)))
  }

  const uniqueAccounts = [...new Set(campaigns.map(c => c.customer_id))].sort()

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Campaigns</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{campaigns.length} campaigns across {uniqueAccounts.length} accounts</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-60">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" placeholder="Search campaigns..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400" />
            <select
              value={accountFilter} onChange={e => setAccountFilter(e.target.value)}
              className="h-10 px-3 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }}
            >
              <option value="">All Accounts</option>
              {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Campaign Groups */}
      {Object.keys(grouped).length === 0 ? (
        <div className="card p-12 text-center">
          <TrendingUp size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No campaigns found</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([accountId, camps]) => (
            <div key={accountId} className="card overflow-hidden">
              <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--slate-100)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                  {accountId.split('-')[0]?.slice(0, 2)}
                </div>
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--slate-900)' }}>{accountId}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--slate-400)' }}>{camps.length} campaigns</span>
                </div>
              </div>
              <table className="w-full text-sm">
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
                        <td className="px-5 py-3 text-xs" style={{ color: 'var(--slate-500)', maxWidth: 200 }}>
                          <span className="truncate block">{c.removal_conditions || '—'}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <button
                            onClick={() => canEdit && handleToggle(c)}
                            disabled={saving === key || !canEdit}
                            className="inline-flex items-center"
                          >
                            {c.enabled
                              ? <ToggleRight size={28} className="text-blue-600" />
                              : <ToggleLeft size={28} className="text-slate-300" />}
                          </button>
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3 text-center">
                            <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
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
          ))}
        </div>
      )}
    </div>
  )
}
