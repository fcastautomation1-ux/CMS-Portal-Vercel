'use client'

import { useState } from 'react'
import { ExternalLink, Plus, Trash2, FileBarChart, X } from 'lucide-react'
import { saveLookerReport, deleteLookerReport } from '@/app/dashboard/looker/actions'
import type { LookerReport, SessionUser } from '@/types'

interface Props { reports: LookerReport[]; user: SessionUser }

export function LookerPage({ reports: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const [reports, setReports] = useState(initial)
  const [modalOpen, setModalOpen] = useState(false)

  async function handleDelete(id: string) {
    if (!confirm('Delete this report?')) return
    const res = await deleteLookerReport(id)
    if (res.success) setReports(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Looker Reports</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{reports.length} reports available</p>
        </div>
        {canEdit && (
          <button onClick={() => setModalOpen(true)} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
            <Plus size={16} /> Add Report
          </button>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="card p-12 text-center">
          <FileBarChart size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No reports available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map(r => (
            <div key={r.id} className="card p-5 flex flex-col gap-3 group">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.08)' }}>
                  <FileBarChart size={20} style={{ color: '#2563EB' }} />
                </div>
                {canEdit && (
                  <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--slate-900)' }}>{r.title}</h3>
                <p className="text-xs" style={{ color: 'var(--slate-400)' }}>
                  {r.allowed_users ? `Shared with: ${r.allowed_users.split(',').length} users` : 'All users'}
                </p>
              </div>
              <a
                href={r.report_url} target="_blank" rel="noopener noreferrer"
                className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                style={{ background: 'rgba(37,99,235,0.06)', color: '#2563EB' }}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-2xl w-full max-w-md overflow-hidden animate-slide-up" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>Add Report</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Report URL</label>
            <input value={reportUrl} onChange={e => setReportUrl(e.target.value)} type="url" required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Allowed Users <span className="font-normal">(comma-separated, blank = all)</span></label>
            <input value={allowedUsers} onChange={e => setAllowedUsers(e.target.value)} placeholder="user1, user2" className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <button type="submit" disabled={saving} className="h-10 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>{saving ? 'Saving...' : 'Add Report'}</button>
        </form>
      </div>
    </div>
  )
}
