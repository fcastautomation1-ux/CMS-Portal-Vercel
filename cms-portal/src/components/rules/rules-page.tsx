'use client'

import { useState } from 'react'
import { Settings, Plus, Pencil, Trash2, X, Hash } from 'lucide-react'
import { saveRule, deleteRule } from '@/app/dashboard/rules/actions'
import type { Rule, SessionUser } from '@/types'

interface Props { rules: Rule[]; user: SessionUser }

export function RulesPage({ rules: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const [rules, setRules] = useState(initial)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Rule | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule?')) return
    const res = await deleteRule(id)
    if (res.success) setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Rules</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{rules.length} removal condition definitions</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditing(null); setModalOpen(true) }} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
            <Plus size={16} /> Add Rule
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <div className="card p-12 text-center">
          <Settings size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No rules defined</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
                {['ID', 'Name', 'Description', 'Actions'].map(h => (
                  <th key={h} className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                  <td className="px-5 py-3">
                    <code className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--slate-100)', color: 'var(--slate-600)' }}>{r.id}</code>
                  </td>
                  <td className="px-5 py-3 font-medium" style={{ color: 'var(--slate-900)' }}>{r.name}</td>
                  <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{r.description || '—'}</td>
                  <td className="px-5 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditing(r); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <RuleModal
          rule={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={(r, isNew) => {
            if (isNew) setRules(prev => [...prev, r])
            else setRules(prev => prev.map(x => x.id === r.id ? r : x))
            setModalOpen(false); setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function RuleModal({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: (r: Rule, isNew: boolean) => void }) {
  const isEdit = !!rule
  const [name, setName] = useState(rule?.name || '')
  const [description, setDescription] = useState(rule?.description || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await saveRule({ id: rule?.id, name, description })
    if (res.success) {
      onSaved({ id: rule?.id || crypto.randomUUID(), name, description }, !isEdit)
    } else setError(res.error || 'Failed')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-2xl w-full max-w-md overflow-hidden animate-slide-up" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>{isEdit ? 'Edit Rule' : 'Add Rule'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form id="rule-form" onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="px-3 py-2 rounded-lg text-sm outline-none resize-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <button type="submit" disabled={saving} className="h-10 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</button>
        </form>
      </div>
    </div>
  )
}
