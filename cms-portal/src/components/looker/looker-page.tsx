'use client'

import { useState } from 'react'
import { ExternalLink, Plus, Trash2, BarChart3, X, Search, Link as LinkIcon, Users, Calendar } from 'lucide-react'
import { saveLookerReport, deleteLookerReport } from '@/app/dashboard/looker/actions'
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
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = reports.filter(r => r.title.toLowerCase().includes(search.toLowerCase()))

  async function handleDelete(id: string) {
    if (!confirm('Delete this report?')) return
    const res = await deleteLookerReport(id)
    if (res.success) setReports(prev => prev.filter(r => r.id !== id))
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
          <button
            onClick={() => setModalOpen(true)}
            className="btn-motion h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', boxShadow: '0 2px 8px rgba(43,127,255,0.3)' }}
          >
            <Plus size={16} /> Add Report
          </button>
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
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg"
                        style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)' }}
                        title="Delete report"
                      >
                        <Trash2 size={14} />
                      </button>
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

      {modalOpen && (
        <ReportModal
          onClose={() => setModalOpen(false)}
          onSaved={r => { setReports(prev => [...prev, r]); setModalOpen(false) }}
        />
      )}
    </div>
  )
}

function ReportModal({ onClose, onSaved }: { onClose: () => void; onSaved: (r: LookerReport) => void }) {
  const [title, setTitle] = useState('')
  const [reportUrl, setReportUrl] = useState('')
  const [allowedUsers, setAllowedUsers] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await saveLookerReport({ title, report_url: reportUrl, allowed_users: allowedUsers })
    if (res.success) {
      onSaved({ id: crypto.randomUUID(), title, report_url: reportUrl, allowed_users: allowedUsers, created_by: null, sort_order: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    } else {
      setError(res.error || 'Failed')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:rounded-2xl rounded-t-2xl sm:max-w-md overflow-hidden animate-slide-up" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--color-text)' }}>Add Looker Report</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Report Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Marketing Dashboard" className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Looker Studio URL</label>
            <input value={reportUrl} onChange={e => setReportUrl(e.target.value)} type="url" required placeholder="https://lookerstudio.google.com/..." className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Access <span className="font-normal opacity-70">(comma-separated usernames, leave blank = all users)</span></label>
            <input value={allowedUsers} onChange={e => setAllowedUsers(e.target.value)} placeholder="user1, user2  â€” or leave blank for all" className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </div>
          <button type="submit" disabled={saving} className="h-10 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)' }}>
            {saving ? 'Adding...' : 'Add Report'}
          </button>
        </form>
      </div>
    </div>
  )
}
