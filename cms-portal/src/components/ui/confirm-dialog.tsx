'use client'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.2)]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={danger
              ? 'rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700'
              : 'rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
