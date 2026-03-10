'use client'

import { useState } from 'react'
import { Building2, Plus, Pencil, Trash2, X, Users } from 'lucide-react'
import { saveDepartment, deleteDepartment } from '@/app/dashboard/departments/actions'
import type { Department, SessionUser } from '@/types'

interface Props { departments: Department[]; memberCounts: Record<string, number>; user: SessionUser }

export function DepartmentsPage({ departments: initial, memberCounts, user }: Props) {
  const canEdit = ['Admin', 'Super Manager'].includes(user.role)
  const [departments, setDepartments] = useState(initial)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)

  async function handleDelete(dept: Department) {
    const count = memberCounts[dept.name] || 0
    if (count > 0 && !confirm(`"${dept.name}" has ${count} members. Delete anyway?`)) return
    if (count === 0 && !confirm(`Delete "${dept.name}"?`)) return
    const res = await deleteDepartment(dept.id)
    if (res.success) setDepartments(prev => prev.filter(d => d.id !== dept.id))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Departments</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{departments.length} departments</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditing(null); setModalOpen(true) }} className="h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
            <Plus size={16} /> Add Department
          </button>
        )}
      </div>

      {departments.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No departments found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map(dept => {
            const count = memberCounts[dept.name] || 0
            return (
              <div key={dept.id} className="card p-5 group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(37,99,235,0.05))' }}>
                    <Building2 size={22} style={{ color: '#2563EB' }} />
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditing(dept); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(dept)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--slate-900)' }}>{dept.name}</h3>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--slate-500)' }}>
                  <Users size={12} /> {count} {count === 1 ? 'member' : 'members'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <DeptModal
          dept={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={(d, isNew) => {
            if (isNew) setDepartments(prev => [...prev, d])
            else setDepartments(prev => prev.map(x => x.id === d.id ? d : x))
            setModalOpen(false); setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function DeptModal({ dept, onClose, onSaved }: { dept: Department | null; onClose: () => void; onSaved: (d: Department, isNew: boolean) => void }) {
  const isEdit = !!dept
  const [name, setName] = useState(dept?.name || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await saveDepartment({ id: dept?.id, name })
    if (res.success) {
      onSaved({ id: dept?.id || crypto.randomUUID(), name, created_at: dept?.created_at || new Date().toISOString() }, !isEdit)
    } else setError(res.error || 'Failed')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl overflow-hidden animate-slide-up" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid var(--slate-200)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>{isEdit ? 'Edit Department' : 'Add Department'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          {error && <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--slate-500)' }}>Department Name</label>
            <input value={name} onChange={e => setName(e.target.value)} required className="h-9 px-3 rounded-lg text-sm outline-none" style={{ border: '1.5px solid var(--slate-200)', background: 'rgba(255,255,255,0.7)' }} />
          </div>
          <button type="submit" disabled={saving} className="h-10 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</button>
        </form>
      </div>
    </div>
  )
}
