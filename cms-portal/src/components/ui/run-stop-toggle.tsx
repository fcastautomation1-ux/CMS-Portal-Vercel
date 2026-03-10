'use client'

interface RunStopToggleProps {
  enabled: boolean
  disabled?: boolean
  onToggle?: () => void
}

export function RunStopToggle({ enabled, disabled = false, onToggle }: RunStopToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className="relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
      style={{
        background: enabled ? '#059669' : '#DC2626',
        boxShadow: enabled ? '0 2px 8px rgba(5,150,105,0.35)' : '0 2px 8px rgba(220,38,38,0.35)',
      }}
    >
      <span
        className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: enabled ? 'translateX(31px)' : 'translateX(4px)' }}
      />
      <span
        className="absolute left-2 text-[10px] font-extrabold tracking-wide text-white transition-opacity"
        style={{ opacity: enabled ? 1 : 0 }}
      >
        RUN
      </span>
      <span
        className="absolute right-1.5 text-[10px] font-extrabold tracking-wide text-white transition-opacity"
        style={{ opacity: enabled ? 0 : 1 }}
      >
        STOP
      </span>
    </button>
  )
}
