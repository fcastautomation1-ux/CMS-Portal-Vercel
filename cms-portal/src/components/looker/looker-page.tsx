'use client'

import { useState } from 'react'
import { ExternalLink, Plus, Trash2, FileBarChart, X, Search, Link as LinkIcon } from 'lucide-react'
import { saveLookerReport, deleteLookerReport } from '@/app/dashboard/looker/actions'
import type { LookerReport, SessionUser } from '@/types'

interface Props { reports: LookerReport[]; user: SessionUser }

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
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{reports.length} reports available</p>
        </div>
        {canEdit && (
          <button onClick={() => setModalOpen(true)} className="btn-motion h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'var(--blue-600)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
            <Plus size={16} /> Add Report
          </button>
        )}
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
        <div className="card p-12 text-center">
          <FileBarChart size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No reports available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(r => (
            <div key={r.id} className="card p-4 flex flex-col gap-3 group overflow-hidden relative" style={{ boxShadow: '0 10px 24px rgba(15,23,42,0.08)' }}>
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #2B7FFF, #6366F1)' }} />
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.12)' }}>
                  <FileBarChart size={20} style={{ color: '#2563EB' }} />
                </div>
                {canEdit && (
                  <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1.5 line-clamp-2" style={{ color: 'var(--color-text)' }}>{r.title}</h3>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <LinkIcon size={12} />
                  <span className="truncate">{r.report_url}</span>
                </div>
                <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {r.allowed_users && r.allowed_users.trim() && r.allowed_users.trim().toLowerCase() !== 'empty'
                    ? `Allowed: ${r.allowed_users}`
                    : 'Allowed: All portal users'}
                </p>
              </div>
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div
                  className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-text-muted)', background: 'linear-gradient(90deg, rgba(59,130,246,0.1), rgba(99,102,241,0.08))' }}
                >
                  Preview
                </div>
                <div className="relative h-40 bg-slate-50">
                  <iframe
                    src={r.report_url}
                    title={`Preview of ${r.title}`}
                    className="absolute inset-0 w-full h-full border-0 pointer-events-none"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to top, rgba(15,23,42,0.14), transparent 45%)' }}
                  />
                </div>
              </div>
              <a
                href={r.report_url} target="_blank" rel="noopener noreferrer"
                className="btn-motion mt-auto inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors text-white"
                style={{ background: 'linear-gradient(135deg, #2B7FFF, #1D4ED8)' }}
              >
                <ExternalLink size={12} /> Open Report
              </a>
            </div>
          ))}
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
    setSaving(true); setError('')
    const res = await saveLookerReport({ title, report_url: reportUrl, allowed_users: allowedUsers })
    if (res.success) {
      onSaved({ id: crypto.randomUUID(), title, report_url: reportUrl, allowed_users: allowedUsers, created_by: null, sort_order: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    } else setError(res.error || 'Failed')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:rounded-2xl rounded-t-2xl sm:max-w-md overflow-hidden animate-slide-up" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--color-text)' }}>Add Report</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Report URL</label>
            <input value={reportUrl} onChange={e => setReportUrl(e.target.value)} type="url" required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Allowed Users <span className="font-normal">(comma-separated, blank = all)</span></label>
            <input value={allowedUsers} onChange={e => setAllowedUsers(e.target.value)} placeholder="user1, user2" className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </div>
          <button type="submit" disabled={saving} className="h-10 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>{saving ? 'Saving...' : 'Add Report'}</button>
        </form>
      </div>
    </div>
  )
}
