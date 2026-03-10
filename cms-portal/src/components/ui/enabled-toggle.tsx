'use client'

import { useTransition } from 'react'
import { toggleAccount } from '@/app/dashboard/accounts/actions'

interface EnabledToggleProps {
  customerId: string
  enabled: boolean
  canEdit: boolean
}

export function EnabledToggle({ customerId, enabled, canEdit }: EnabledToggleProps) {
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    if (!canEdit) return
    startTransition(async () => {
      await toggleAccount(customerId, !enabled)
    })
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={!canEdit || isPending}
      onClick={handleToggle}
      className="relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      style={{
        background: isPending
          ? '#94A3B8'
          : enabled
          ? 'var(--blue-600)'
          : 'var(--slate-200)',
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: enabled ? 'translateX(18px)' : 'translateX(3px)' }}
      />
    </button>
  )
}
