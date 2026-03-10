'use client'

import { useTransition, useEffect } from 'react'
import { X, Trash2, AlertTriangle } from 'lucide-react'
import { deleteAccount } from '@/app/dashboard/accounts/actions'
import type { Account } from '@/types'

interface DeleteConfirmProps {
  account: Account
  onClose: () => void
}

export function DeleteConfirm({ account, onClose }: DeleteConfirmProps) {
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function handleDelete() {
    startTransition(async () => {
      await deleteAccount(account.customer_id)
      onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rounded-2xl w-full max-w-sm animate-slide-up"
        style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(200%)', WebkitBackdropFilter: 'blur(20px) saturate(200%)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--slate-900)' }}>Delete Account</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl transition-all"
            style={{ color: 'var(--slate-500)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--slate-100)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--color-error-bg)' }}
          >
            <AlertTriangle size={22} style={{ color: 'var(--color-error)' }} />
          </div>
          <p className="text-center text-sm mb-2" style={{ color: 'var(--slate-600)' }}>
            Are you sure you want to delete account
          </p>
          <p
            className="text-center font-mono font-bold text-base mb-3"
            style={{ color: 'var(--slate-900)' }}
          >
            {account.customer_id}
          </p>
          <div
            className="text-xs p-3 rounded-lg text-center"
            style={{ background: 'var(--color-warning-bg)', color: '#92400E' }}
          >
            ⚠️ This will also delete all linked campaign rules. This action cannot be undone.
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--slate-100)', background: 'var(--slate-50)' }}
        >
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ color: 'var(--slate-600)', background: 'white', border: '1.5px solid var(--slate-200)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--slate-100)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-70"
            style={{ background: 'var(--color-error)' }}
          >
            {isPending ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            ) : (
              <Trash2 size={15} />
            )}
            {isPending ? 'Deleting...' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  )
}
