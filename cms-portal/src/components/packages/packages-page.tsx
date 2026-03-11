'use client'

import { useState } from 'react'
import { Package as PackageIcon, Plus, Pencil, Trash2, X, DollarSign, Tag } from 'lucide-react'
import { savePackage, deletePackage } from '@/app/dashboard/packages/actions'
import type { Package, SessionUser } from '@/types'

interface Props { packages: Package[]; user: SessionUser }

export function PackagesPage({ packages: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager'].includes(user.role)
  const [packages, setPackages] = useState(initial)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('Delete this package?')) return
    const res = await deletePackage(id)
    if (res.success) setPackages(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Packages</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{packages.length} packages</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditing(null); setModalOpen(true) }} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
            <Plus size={16} /> Add Package
          </button>
        )}
      </div>

      {packages.length === 0 ? (
        <div className="card p-12 text-center">
          <PackageIcon size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No packages found</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[580px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
                {['Name', 'Category', 'Price', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {packages.map(pkg => (
                <tr key={pkg.id} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.08)' }}>
                        <PackageIcon size={16} style={{ color: '#2563EB' }} />
                      </div>
                      <div>
                        <span className="font-medium" style={{ color: 'var(--slate-900)' }}>{pkg.name}</span>
                        {pkg.description && <p className="text-xs mt-0.5 truncate max-w-50" style={{ color: 'var(--slate-400)' }}>{pkg.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {pkg.category ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--slate-100)', color: 'var(--slate-600)' }}>
                        <Tag size={10} /> {pkg.category}
                      </span>
                    ) : <span style={{ color: 'var(--slate-400)' }}>—</span>}
                  </td>
                  <td className="px-5 py-3">
                    {pkg.price != null ? (
                      <span className="inline-flex items-center gap-0.5 text-sm font-semibold" style={{ color: 'var(--slate-900)' }}>
                        <DollarSign size={13} />{pkg.price.toFixed(2)}
                      </span>
                    ) : <span className="text-xs" style={{ color: 'var(--slate-400)' }}>Free</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: pkg.is_active ? '#22C55E' : '#94A3B8' }} />
                      {pkg.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditing(pkg); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(pkg.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <PackageModal
          pkg={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={(p, isNew) => {
            if (isNew) setPackages(prev => [...prev, p])
            else setPackages(prev => prev.map(x => x.id === p.id ? p : x))
            setModalOpen(false); setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function PackageModal({ pkg, onClose, onSaved }: { pkg: Package | null; onClose: () => void; onSaved: (p: Package, isNew: boolean) => void }) {
  const isEdit = !!pkg
  const [form, setForm] = useState({
    name: pkg?.name || '',
    description: pkg?.description || '',
    category: pkg?.category || '',
    price: pkg?.price?.toString() || '',
    is_active: pkg?.is_active ?? true,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await savePackage({ id: pkg?.id, name: form.name, description: form.description, category: form.category, price: form.price ? parseFloat(form.price) : null, is_active: form.is_active })
    if (res.success) {
      onSaved({
        id: pkg?.id || crypto.randomUUID(), name: form.name, description: form.description || null,
        category: form.category || null, price: form.price ? parseFloat(form.price) : null,
        is_active: form.is_active, created_by: pkg?.created_by || null,
        created_at: pkg?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
      }, !isEdit)
    } else setError(res.error || 'Failed')
    setSaving(false)
  }

  const set = (k: string, v: string | boolean) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid var(--slate-200)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>{isEdit ? 'Edit Package' : 'Add Package'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} className="px-3 py-2 rounded-lg text-sm outline-none resize-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Category</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Price</label>
              <input value={form.price} onChange={e => set('price', e.target.value)} type="number" step="0.01" placeholder="Free" className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: '#2563EB' }} />
            <span className="text-sm" style={{ color: 'var(--slate-600)' }}>Active</span>
          </label>
          <button type="submit" disabled={saving} className="h-10 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</button>
        </form>
      </div>
    </div>
  )
}
