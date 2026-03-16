'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, ChevronDown } from 'lucide-react'
import { saveLookerReport } from '@/app/dashboard/looker/actions'

interface Props {
  users: string[]
}

export function NewLookerReportPage({ users }: Props) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [reportUrl, setReportUrl] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedUsersCsv = selectedUsers.join(', ')

  useEffect(() => {
    if (!dropdownOpen) return
    function onClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [dropdownOpen])

  function toggleUser(username: string) {
    setSelectedUsers(prev => prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const res = await saveLookerReport({
      title,
      report_url: reportUrl,
      allowed_users: selectedUsersCsv,
    })

    if (res.success) {
      router.push('/dashboard/looker')
      router.refresh()
      return
    }

    setError(res.error || 'Failed to save report.')
    setSaving(false)
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Add Looker Report</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Create report access with proper full-page form.</p>
        </div>
        <Link
          href="/dashboard/looker"
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
          <label className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>Report Name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. Monthly Performance"
            className="h-11 px-4 rounded-xl text-sm outline-none"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>Report URL / Embed Code</label>
          <textarea
            value={reportUrl}
            onChange={(e) => setReportUrl(e.target.value)}
            required
            rows={4}
            placeholder="Paste the Looker Studio URL or Embed Code here..."
            className="px-4 py-3 rounded-xl text-sm outline-none resize-y"
            style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Works with direct links (lookerstudio.google.com/reporting/...) or Embed Code (&lt;iframe...&gt;).
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>Shared With (Optional)</label>
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen(prev => !prev)}
              className="w-full h-11 px-4 rounded-xl text-sm outline-none flex items-center justify-between"
              style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              <span className="truncate text-left" style={{ color: selectedUsers.length ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {selectedUsers.length ? `${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''} selected` : 'Select users (leave empty = everyone)'}
              </span>
              <ChevronDown size={16} />
            </button>

            {dropdownOpen && (
              <div
                className="absolute z-20 mt-2 w-full rounded-xl overflow-hidden"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', boxShadow: '0 10px 24px rgba(0,0,0,0.12)' }}
              >
                <div className="max-h-60 overflow-auto">
                  {users.length === 0 ? (
                    <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>No users found</div>
                  ) : (
                    users.map((username) => {
                      const selected = selectedUsers.includes(username)
                      return (
                        <button
                          key={username}
                          type="button"
                          onClick={() => toggleUser(username)}
                          className="w-full px-4 py-2.5 text-sm flex items-center justify-between hover:bg-slate-50"
                          style={{ color: 'var(--color-text)' }}
                        >
                          <span>{username}</span>
                          {selected ? <Check size={14} style={{ color: '#059669' }} /> : null}
                        </button>
                      )
                    })
                  )}
                </div>
                {selectedUsers.length > 0 && (
                  <div className="px-3 py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedUsers([])}
                      className="text-xs font-semibold"
                      style={{ color: '#2563EB' }}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Select from dropdown. Leave empty to share with everyone.
          </p>
          <input
            value={selectedUsersCsv}
            readOnly
            placeholder="Selected users will appear as comma-separated"
            className="h-11 px-4 rounded-xl text-sm outline-none"
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
            {saving ? 'Saving...' : 'Save Report'}
          </button>
          <Link
            href="/dashboard/looker"
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
