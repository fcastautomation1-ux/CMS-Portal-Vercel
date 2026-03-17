'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Plus, Trash2, BarChart3, Search, Link as LinkIcon, Users, Calendar, UserPlus, X } from 'lucide-react'
import { deleteLookerReport, getLookerAccessUsers, saveLookerReport } from '@/app/dashboard/looker/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { LookerReport, SessionUser } from '@/types'

interface Props { reports: LookerReport[]; user: SessionUser }

const CARD_GRADIENTS = [
  { from: '#2B7FFF', to: '#1A6AE4', light: 'rgba(43,127,255,0.1)' },
  { from: '#8B5CF6', to: '#7C3AED', light: 'rgba(139,92,246,0.1)' },
  { from: '#14B8A6', to: '#0D9488', light: 'rgba(20,184,166,0.1)' },
  { from: '#F97316', to: '#EA580C', light: 'rgba(249,115,22,0.1)' },
  { from: '#EC4899', to: '#DB2777', light: 'rgba(236,72,153,0.1)' },
  { from: '#10B981', to: '#059669', light: 'rgba(16,185,129,0.1)' },
  { from: '#6366F1', to: '#4F46E5', light: 'rgba(99,102,241,0.1)' },
  { from: '#F59E0B', to: '#D97706', light: 'rgba(245,158,11,0.1)' },
]

export function LookerPage({ reports: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const [reports, setReports] = useState(initial)
  const [search, setSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [accessUsers, setAccessUsers] = useState<string[]>([])
  const [sharingReport, setSharingReport] = useState<LookerReport | null>(null)
  const [shareSelected, setShareSelected] = useState<string[]>([])
  const [shareSearch, setShareSearch] = useState('')
  const [shareAllUsers, setShareAllUsers] = useState(false)
  const [shareSaving, setShareSaving] = useState(false)
  const [shareError, setShareError] = useState('')

  const filtered = reports.filter(r => r.title.toLowerCase().includes(search.toLowerCase()))

  async function handleDelete(id: string) {
    const res = await deleteLookerReport(id)
    if (res.success) setReports(prev => prev.filter(r => r.id !== id))
  }

  useEffect(() => {
    if (!canEdit) return
    let cancelled = false
    getLookerAccessUsers().then((rows) => {
      if (!cancelled) setAccessUsers(rows)
    })
    return () => { cancelled = true }
  }, [canEdit])

  const filteredAccessUsers = useMemo(() => {
    const q = shareSearch.toLowerCase().trim()
    if (!q) return accessUsers
    return accessUsers.filter((u) => u.toLowerCase().includes(q))
  }, [accessUsers, shareSearch])

  const openShareModal = (report: LookerReport) => {
    setSharingReport(report)
    const rawAllowed = report.allowed_users || ''
    const isAll = !rawAllowed.trim() || rawAllowed.trim().toLowerCase() === 'all portal users' || rawAllowed.trim().toLowerCase() === 'all'
    setShareAllUsers(isAll)
    setShareSelected(
      isAll ? [] : rawAllowed.split(',').map((v) => v.trim()).filter(Boolean)
    )
    setShareSearch('')
    setShareError('')
  }

  const toggleShareUser = (username: string) => {
    setShareSelected((prev) => (
      prev.includes(username) ? prev.filter((v) => v !== username) : [...prev, username]
    ))
  }

  const submitShare = async () => {
    if (!sharingReport) return
    if (!shareAllUsers && shareSelected.length === 0) {
      setShareError('Select at least one user or choose all users.')
      return
    }
    setShareSaving(true)
    setShareError('')
    const allowedUsers = shareAllUsers ? 'All portal users' : shareSelected.join(', ')
    const res = await saveLookerReport({
      id: sharingReport.id,
      title: sharingReport.title,
      report_url: sharingReport.report_url,
      allowed_users: allowedUsers,
    })
    if (!res.success || !res.report) {
      setShareSaving(false)
      setShareError(res.error || 'Failed to update sharing.')
      return
    }
    setReports((prev) => prev.map((r) => (r.id === res.report!.id ? res.report! : r)))
    setShareSaving(false)
    setSharingReport(null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Looker Reports</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {reports.length} report{reports.length !== 1 ? 's' : ''} available
          </p>
        </div>
        {canEdit && (
          <Link
            href="/dashboard/looker/new"
            className="btn-motion h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', boxShadow: '0 2px 8px rgba(43,127,255,0.3)' }}
          >
            <Plus size={16} /> Add Report
          </Link>
        )}
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            placeholder="Search reports..."
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(59,130,246,0.08)' }}>
            <BarChart3 size={28} style={{ color: '#3B82F6' }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            {search ? `No reports match "${search}"` : 'No reports available'}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {search ? 'Try a different keyword' : canEdit ? 'Add your first Looker Studio report.' : 'Reports will appear here.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((r, i) => {
            const g = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
            const isAllUsers = !r.allowed_users || !r.allowed_users.trim() || r.allowed_users.trim().toLowerCase() === 'empty' || r.allowed_users.trim().toLowerCase() === 'all portal users'
            const allowedList = isAllUsers ? null : r.allowed_users.split(',').map(s => s.trim()).filter(Boolean)

            return (
              <div
                key={r.id}
                className="group relative overflow-hidden rounded-2xl flex flex-col"
                style={{
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  transition: 'box-shadow 0.2s, transform 0.2s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px rgba(0,0,0,0.12)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
              >
                <div className="h-1.5 w-full shrink-0" style={{ background: `linear-gradient(90deg, ${g.from}, ${g.to})` }} />

                <div className="p-5 flex flex-col flex-1 gap-4">
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: g.light }}>
                      <BarChart3 size={22} style={{ color: g.from }} />
                    </div>
                    {canEdit && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <button
                          onClick={() => openShareModal(r)}
                          className="p-1.5 rounded-lg"
                          style={{ color: '#2563EB', background: 'rgba(37,99,235,0.08)' }}
                          title="Share report"
                        >
                          <UserPlus size={14} />
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(r.id)}
                          className="p-1.5 rounded-lg"
                          style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)' }}
                          title="Delete report"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-base font-bold leading-snug mb-2" style={{ color: 'var(--color-text)' }}>
                      {r.title}
                    </h3>

                    <div className="flex items-center gap-1.5 mb-3">
                      <LinkIcon size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      <span className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)', maxWidth: '100%' }} title={r.report_url}>
                        {r.report_url}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Users size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      {isAllUsers ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}>
                          All portal users
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(allowedList ?? []).slice(0, 3).map(u => (
                            <span key={u} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: g.light, color: g.from }}>
                              {u}
                            </span>
                          ))}
                          {(allowedList?.length ?? 0) > 3 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(148,163,184,0.15)', color: 'var(--color-text-muted)' }}>
                              +{(allowedList?.length ?? 0) - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {r.created_at && (
                    <div className="flex items-center gap-1.5 mt-auto pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Calendar size={11} style={{ color: 'var(--color-text-muted)' }} />
                      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        Added {new Date(r.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}

                  <a
                    href={r.report_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-motion flex items-center justify-center gap-2 text-sm font-semibold py-2.5 px-4 rounded-xl text-white transition-opacity"
                    style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})`, boxShadow: `0 2px 8px ${g.light}` }}
                  >
                    <ExternalLink size={14} /> Open Report
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="Delete this report?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={async () => {
          if (!pendingDeleteId) return
          await handleDelete(pendingDeleteId)
          setPendingDeleteId(null)
        }}
      />
      {sharingReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setSharingReport(null) }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Share Report</h3>
              <button onClick={() => setSharingReport(null)} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="p-5">
              <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>{sharingReport.title}</p>
              <label className="mb-3 flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={shareAllUsers} onChange={(e) => setShareAllUsers(e.target.checked)} />
                Share with all portal users
              </label>
              {!shareAllUsers && (
                <>
                  <div className="relative mb-3">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={shareSearch}
                      onChange={(e) => setShareSearch(e.target.value)}
                      placeholder="Search users..."
                      className="w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none"
                      style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
                    {filteredAccessUsers.map((username) => (
                      <label key={username} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <span style={{ color: 'var(--color-text)' }}>{username}</span>
                        <input type="checkbox" checked={shareSelected.includes(username)} onChange={() => toggleShareUser(username)} />
                      </label>
                    ))}
                    {filteredAccessUsers.length === 0 && (
                      <div className="px-3 py-4 text-sm text-slate-400">No users found.</div>
                    )}
                  </div>
                </>
              )}
              {shareError && <div className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: '#FEF2F2', color: '#DC2626' }}>{shareError}</div>}
            </div>
            <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setSharingReport(null)} className="h-10 px-4 rounded-lg text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancel</button>
              <button onClick={submitShare} disabled={shareSaving} className="h-10 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', opacity: shareSaving ? 0.6 : 1 }}>
                {shareSaving ? 'Saving...' : 'Save Sharing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
