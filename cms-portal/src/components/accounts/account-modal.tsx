'use client'

import { useTransition, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Save, Loader2, Upload, FileText, Trash2 } from 'lucide-react'
import {
  createAccount,
  updateAccount,
  getAccountFiles,
  createAccountFileUploadUrlAction,
  saveAccountFileAction,
  deleteAccountFileAction,
} from '@/app/dashboard/accounts/actions'
import type { Account, AccountFile } from '@/types'

const WORKFLOW_OPTIONS = [
  { value: 'workflow-0', label: 'Workflow 0 (Default)' },
  { value: 'workflow-1', label: 'Workflow 1' },
  { value: 'workflow-2', label: 'Workflow 2' },
  { value: 'workflow-3', label: 'Workflow 3' },
]

const schema = z.object({
  customer_id: z.string().min(1, 'Customer ID is required').max(50),
  account_name: z.string().max(120).optional(),
  google_sheet_link: z.string().url('Must be a valid URL').or(z.literal('')).optional(),
  drive_code_comments: z.string().max(2000).optional(),
  workflow: z.string().min(1),
  enabled: z.boolean(),
})

type FormData = z.infer<typeof schema>

interface AccountModalProps {
  account: Account | null
  onClose: () => void
}

function FormField({
  label,
  error,
  required,
  children,
  hint,
}: {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" style={{ color: 'var(--slate-700)' }}>
        {label}
        {required && <span className="ml-0.5" style={{ color: 'var(--color-error)' }}>*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs" style={{ color: 'var(--slate-400)' }}>{hint}</p>}
      {error && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid var(--slate-200)',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '14px',
  color: 'var(--slate-900)',
  outline: 'none',
  width: '100%',
  background: 'white',
  transition: 'border-color 0.15s',
}

export function AccountModal({ account, onClose }: AccountModalProps) {
  const isEdit = account !== null
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<AccountFile[]>([])
  const [filesLoading, setFilesLoading] = useState(isEdit)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [filesError, setFilesError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_id: account?.customer_id ?? '',
      account_name: account?.account_name ?? '',
      google_sheet_link: account?.google_sheet_link ?? '',
      drive_code_comments: account?.drive_code_comments ?? '',
      workflow: account?.workflow ?? 'workflow-0',
      enabled: account?.enabled ?? true,
    },
  })

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (!account) return
    let cancelled = false
    void (async () => {
      setFilesLoading(true)
      const nextFiles = await getAccountFiles(account.customer_id)
      if (!cancelled) {
        setFiles(nextFiles)
        setFilesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [account])

  function formatFileSize(size: number | null) {
    if (!size) return 'Unknown size'
    if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    if (size >= 1024) return `${Math.round(size / 1024)} KB`
    return `${size} B`
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    if (!account) return
    const selectedFiles = Array.from(event.target.files ?? [])
    if (selectedFiles.length === 0) return

    setFilesError('')
    setUploadingFiles(true)

    for (const file of selectedFiles) {
      if (file.size > 1024 * 1024 * 1024) {
        setFilesError(`"${file.name}" is over the 1 GB limit.`)
        continue
      }

      const uploadUrl = await createAccountFileUploadUrlAction({
        accountId: account.customer_id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      })

      if (!uploadUrl.success || !uploadUrl.signedUrl || !uploadUrl.storagePath) {
        setFilesError(uploadUrl.error ?? `Failed to prepare "${file.name}".`)
        continue
      }

      const uploadResponse = await fetch(uploadUrl.signedUrl, {
        method: 'PUT',
        headers: {
          'content-type': file.type || 'application/octet-stream',
        },
        body: file,
      })

      if (!uploadResponse.ok) {
        setFilesError(`Upload failed for "${file.name}".`)
        continue
      }

      const saveResult = await saveAccountFileAction({
        accountId: account.customer_id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath: uploadUrl.storagePath,
      })

      if (!saveResult.success) {
        setFilesError(saveResult.error ?? `Failed to save "${file.name}".`)
        continue
      }
    }

    setFiles(await getAccountFiles(account.customer_id))
    setUploadingFiles(false)
    event.target.value = ''
  }

  async function handleDeleteFile(fileId: string) {
    if (!account) return
    const result = await deleteAccountFileAction(fileId, account.customer_id)
    if (!result.success) {
      setFilesError(result.error ?? 'Failed to delete file.')
      return
    }
    setFiles(prev => prev.filter(file => file.id !== fileId))
  }

  function onSubmit(data: FormData) {
    startTransition(async () => {
      const result = isEdit
        ? await updateAccount(account.customer_id, {
            google_sheet_link: data.google_sheet_link ?? '',
            account_name: data.account_name ?? '',
            drive_code_comments: data.drive_code_comments ?? '',
            workflow: data.workflow,
            enabled: data.enabled,
          })
        : await createAccount({
            customer_id: data.customer_id,
            account_name: data.account_name ?? '',
            google_sheet_link: data.google_sheet_link ?? '',
            drive_code_comments: data.drive_code_comments ?? '',
            workflow: data.workflow,
            enabled: data.enabled,
          })

      if (result.success) {
        onClose()
      } else {
        setError('root', { message: result.error ?? 'Something went wrong.' })
      }
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        {/* Modal */}
        <div
          className="relative w-full sm:max-w-lg animate-slide-up overflow-hidden sm:rounded-2xl rounded-t-2xl"
          style={{ background: 'rgba(255,255,255,0.95)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid var(--slate-200)', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--slate-100)' }}
          >
            <div>
              <h2 className="font-bold text-lg" style={{ color: 'var(--slate-900)', letterSpacing: '-0.02em' }}>
                {isEdit ? 'Edit Account' : 'Add Account'}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--slate-500)' }}>
                {isEdit ? `Editing ${account.customer_id}` : 'Add a new Google Ads account'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-all"
              style={{ color: 'var(--slate-500)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--slate-100)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="px-5 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              {/* Root error */}
              {errors.root && (
                <div
                  className="text-sm p-3 rounded-lg"
                  style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', border: '1px solid #FCA5A5' }}
                >
                  {errors.root.message}
                </div>
              )}

              {/* Customer ID */}
              <FormField label="Customer ID" error={errors.customer_id?.message} required hint="Google Ads customer ID, e.g. 123-456-7890">
                <input
                  {...register('customer_id')}
                  disabled={isEdit}
                  placeholder="123-456-7890"
                  style={{
                    ...inputStyle,
                    fontFamily: 'monospace',
                    background: isEdit ? 'var(--slate-50)' : 'white',
                    color: isEdit ? 'var(--slate-500)' : 'var(--slate-900)',
                    cursor: isEdit ? 'not-allowed' : 'text',
                  }}
                  onFocus={e => { if (!isEdit) e.currentTarget.style.borderColor = 'var(--blue-500)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = errors.customer_id ? 'var(--color-error)' : 'var(--slate-200)'; }}
                />
              </FormField>

              <FormField label="Account Name" error={errors.account_name?.message} hint="Business-friendly account label">
                <input
                  {...register('account_name')}
                  placeholder="e.g. Auto Irfan"
                  style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--blue-500)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = errors.account_name ? 'var(--color-error)' : 'var(--slate-200)'; }}
                />
              </FormField>

              {/* Google Sheet Link */}
              <FormField label="Google Sheet Link" error={errors.google_sheet_link?.message} hint="URL to the linked Google Spreadsheet">
                <input
                  {...register('google_sheet_link')}
                  type="url"
                  placeholder="https://docs.google.com/spreadsheets/..."
                  style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--blue-500)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = errors.google_sheet_link ? 'var(--color-error)' : 'var(--slate-200)'; }}
                />
              </FormField>

              <FormField label="Account Notes" error={errors.drive_code_comments?.message} hint="Optional notes, codes, or internal references">
                <textarea
                  {...register('drive_code_comments')}
                  rows={3}
                  placeholder="Enter account notes..."
                  style={{ ...inputStyle, resize: 'vertical', minHeight: '72px' }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--blue-500)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--slate-200)'; }}
                />
              </FormField>

              {isEdit && account && (
                <div className="rounded-xl p-4" style={{ border: '1px solid var(--slate-200)', background: 'var(--slate-50)' }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--slate-900)' }}>Account Files</h3>
                      <p className="text-xs mt-1" style={{ color: 'var(--slate-500)' }}>
                        Stored in Supabase under structured folders. No file-count limit, 1 GB per file.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFiles}
                      className="btn-motion inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-70"
                      style={{ background: 'var(--blue-600)' }}
                    >
                      {uploadingFiles ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {uploadingFiles ? 'Uploading...' : 'Upload Files'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFilesSelected}
                    />
                  </div>

                  {filesError && (
                    <div className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>
                      {filesError}
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {filesLoading ? (
                      <div className="text-sm flex items-center gap-2" style={{ color: 'var(--slate-500)' }}>
                        <Loader2 size={14} className="animate-spin" />
                        Loading files...
                      </div>
                    ) : files.length === 0 ? (
                      <div className="text-sm" style={{ color: 'var(--slate-500)' }}>No files uploaded for this account yet.</div>
                    ) : (
                      files.map(file => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-white"
                          style={{ border: '1px solid var(--slate-200)' }}
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <FileText size={15} style={{ color: 'var(--slate-500)' }} />
                            <div className="min-w-0">
                              {file.file_url ? (
                                <a
                                  href={file.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm font-medium truncate block"
                                  style={{ color: 'var(--blue-700)' }}
                                >
                                  {file.file_name}
                                </a>
                              ) : (
                                <span className="text-sm font-medium block truncate" style={{ color: 'var(--slate-800)' }}>
                                  {file.file_name}
                                </span>
                              )}
                              <p className="text-xs" style={{ color: 'var(--slate-500)' }}>
                                {formatFileSize(file.file_size)} · {file.uploaded_by} · {new Date(file.created_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDeleteFile(file.id)}
                            className="btn-motion w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ color: '#EF4444', background: '#FEF2F2' }}
                            title="Delete file"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Workflow */}
              <FormField label="Workflow" error={errors.workflow?.message} required>
                <select
                  {...register('workflow')}
                  style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--blue-500)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--slate-200)'; }}
                >
                  {WORKFLOW_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FormField>

              {/* Enabled */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  {...register('enabled')}
                  type="checkbox"
                  className="w-4 h-4 rounded cursor-pointer accent-blue-600"
                />
                <span className="text-sm font-medium" style={{ color: 'var(--slate-700)' }}>
                  Account Enabled
                </span>
                <span className="text-xs" style={{ color: 'var(--slate-400)' }}>
                  (Disabled accounts are excluded from workflows)
                </span>
              </label>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end gap-3 px-5 py-4"
              style={{ borderTop: '1px solid var(--slate-100)', background: 'var(--slate-50)' }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="btn-motion px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{ color: 'var(--slate-600)', background: 'white', border: '1.5px solid var(--slate-200)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--slate-100)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="btn-motion flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-70"
                style={{ background: 'var(--blue-600)' }}
                onMouseEnter={e => { if (!isPending) e.currentTarget.style.background = 'var(--blue-700)'; }}
                onMouseLeave={e => { if (!isPending) e.currentTarget.style.background = 'var(--blue-600)'; }}
              >
                {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
