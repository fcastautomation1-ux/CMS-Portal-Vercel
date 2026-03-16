'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { saveDepartment } from '@/app/dashboard/departments/actions'

export function NewDepartmentPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const res = await saveDepartment({ name, description })
    if (res.success) {
      router.push('/dashboard/departments')
      router.refresh()
      return
    }

    setError(res.error || 'Failed to save department.')
    setSaving(false)
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Add New Department</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Use full-page form instead of popup modal.</p>
        </div>
        <Link
          href="/dashboard/departments"
          className="h-10 px-4 rounded-xl text-sm font-semibold flex items-center gap-2"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}
        >
          <ArrowLeft size={15} /> Back
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-5">
        {error && (
          <div className="text-sm p-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>Department Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Automation/Development"
            className="h-11 px-4 rounded-xl text-sm outline-none"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Add a description for this department..."
            className="px-4 py-3 rounded-xl text-sm outline-none resize-y"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
        </div>

        <div className="flex items-center gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            type="submit"
            disabled={saving}
            className="h-11 px-5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
          >
            {saving ? 'Saving...' : 'Save Department'}
          </button>
          <Link
            href="/dashboard/departments"
            className="h-11 px-5 rounded-xl text-sm font-semibold inline-flex items-center"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
