'use client'

import { useState } from 'react'
import {
  Mail, Server, Lock, Eye, EyeOff, Save, TestTube2,
  CheckCircle, XCircle, Info, Shield,
} from 'lucide-react'
import { saveSmtpConfig, testSmtpConnection } from '@/app/dashboard/settings/actions'
import type { SmtpConfig } from '@/app/dashboard/settings/actions'

interface Props {
  initialSmtp: SmtpConfig | null
}

function Field({
  label, hint, children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>
      )}
    </div>
  )
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' | 'info' }) {
  const colors = {
    success: '#10B981',
    error: '#EF4444',
    info: '#3B82F6',
  }
  const icons = {
    success: <CheckCircle size={15} />,
    error: <XCircle size={15} />,
    info: <Info size={15} />,
  }
  return (
    <div
      className="fixed top-4 right-4 z-50 flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up max-w-sm"
      style={{ background: colors[type], color: 'white' }}
    >
      {icons[type]}
      <span>{message}</span>
    </div>
  )
}

export function SettingsPage({ initialSmtp }: Props) {
  const empty: Omit<SmtpConfig, 'id' | 'updated_at'> = {
    host: '',
    port: 587,
    username: '',
    password: '',
    from_name: '',
    from_email: '',
    encryption: 'tls',
    enabled: true,
  }

  const [cfg, setCfg] = useState<Omit<SmtpConfig, 'id' | 'updated_at'>>(
    initialSmtp
      ? {
          host: initialSmtp.host,
          port: initialSmtp.port,
          username: initialSmtp.username,
          password: initialSmtp.password,
          from_name: initialSmtp.from_name,
          from_email: initialSmtp.from_email,
          encryption: initialSmtp.encryption,
          enabled: initialSmtp.enabled,
        }
      : empty
  )

  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  function set<K extends keyof typeof cfg>(key: K, value: (typeof cfg)[K]) {
    setCfg(prev => ({ ...prev, [key]: value }))
  }

  function showToast(message: string, type: 'success' | 'error' | 'info') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 5000)
  }

  async function handleSave() {
    if (!cfg.host || !cfg.username || !cfg.from_email) {
      showToast('Host, username, and From email are required.', 'error')
      return
    }
    setSaving(true)
    const res = await saveSmtpConfig(cfg)
    setSaving(false)
    if (res.success) showToast('SMTP settings saved successfully.', 'success')
    else showToast(res.error ?? 'Failed to save settings.', 'error')
  }

  async function handleTest() {
    setTesting(true)
    const res = await testSmtpConnection(cfg)
    setTesting(false)
    showToast(res.message, res.success ? 'info' : 'error')
  }

  const inputClass = 'h-10 w-full px-3 rounded-lg text-sm outline-none'
  const inputStyle = { border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }
  const focusStyle = '1.5px solid #3B82F6'

  return (
    <div className="animate-fade-in max-w-3xl">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="page-title">Integrations & Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          Configure external services and integrations
        </p>
      </div>

      {/* ── SMTP Card ─────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        {/* Card header */}
        <div
          className="flex items-center gap-3 px-6 py-4"
          style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(14,165,233,0.1)' }}
          >
            <Mail size={17} style={{ color: '#0EA5E9' }} />
          </div>
          <div>
            <h2 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
              SMTP Email Integration
            </h2>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Configure outgoing email delivery for notifications and alerts
            </p>
          </div>

          {/* Enabled toggle */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {cfg.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              type="button"
              onClick={() => set('enabled', !cfg.enabled)}
              className="w-11 h-6 rounded-full relative transition-all duration-200"
              style={{ background: cfg.enabled ? '#0EA5E9' : 'var(--slate-200)' }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                style={{ transform: cfg.enabled ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </div>

        {/* Form body */}
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Host */}
          <div className="sm:col-span-2 sm:grid sm:grid-cols-3 sm:gap-4">
            <div className="sm:col-span-2">
              <Field label="SMTP Host" hint="e.g. smtp.gmail.com, smtp.sendgrid.net">
                <div className="relative">
                  <Server
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                  <input
                    type="text"
                    value={cfg.host}
                    onChange={e => set('host', e.target.value)}
                    placeholder="smtp.gmail.com"
                    className={inputClass + ' pl-9'}
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = '#3B82F6' }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                  />
                </div>
              </Field>
            </div>
            <Field label="Port" hint="25, 465, 587, or 2525">
              <input
                type="number"
                value={cfg.port}
                onChange={e => set('port', Number(e.target.value))}
                min={1}
                max={65535}
                className={inputClass}
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = '#3B82F6' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              />
            </Field>
          </div>

          {/* Encryption */}
          <Field label="Encryption" hint="TLS (STARTTLS) is recommended">
            <div className="flex gap-2">
              {(['none', 'ssl', 'tls'] as const).map(enc => (
                <button
                  key={enc}
                  type="button"
                  onClick={() => set('encryption', enc)}
                  className="flex-1 h-10 rounded-lg text-sm font-semibold transition-all uppercase"
                  style={{
                    background: cfg.encryption === enc ? '#0EA5E9' : 'var(--color-surface)',
                    color: cfg.encryption === enc ? 'white' : 'var(--color-text-muted)',
                    border: '1.5px solid ' + (cfg.encryption === enc ? '#0EA5E9' : 'var(--color-border)'),
                  }}
                >
                  {enc === 'none' ? 'None' : enc.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>

          {/* Username */}
          <Field label="SMTP Username" hint="Usually your email address">
            <input
              type="text"
              value={cfg.username}
              onChange={e => set('username', e.target.value)}
              placeholder="you@company.com"
              autoComplete="off"
              className={inputClass}
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = '#3B82F6' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
            />
          </Field>

          {/* Password */}
          <Field label="SMTP Password / App Password">
            <div className="relative">
              <Lock
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-muted)' }}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={cfg.password}
                onChange={e => set('password', e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
                className={inputClass + ' pl-9 pr-10'}
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = '#3B82F6' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded"
                style={{ color: 'var(--color-text-muted)' }}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          {/* From Name */}
          <Field label="From Name" hint='Sender display name, e.g. "CMS Portal"'>
            <input
              type="text"
              value={cfg.from_name}
              onChange={e => set('from_name', e.target.value)}
              placeholder="CMS Portal"
              className={inputClass}
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = '#3B82F6' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
            />
          </Field>

          {/* From Email */}
          <Field label="From Email" hint="Address shown in recipient's inbox">
            <input
              type="email"
              value={cfg.from_email}
              onChange={e => set('from_email', e.target.value)}
              placeholder="noreply@company.com"
              className={inputClass}
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = '#3B82F6' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
            />
          </Field>
        </div>

        {/* Quick-setup note */}
        <div
          className="mx-6 mb-5 rounded-xl flex items-start gap-3 px-4 py-3"
          style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}
        >
          <Shield size={15} className="mt-0.5 shrink-0" style={{ color: '#3B82F6' }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: '#3B82F6' }}>
              Required Supabase table
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Create the <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">smtp_settings</code> table in
              your Supabase SQL Editor with columns:{' '}
              <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">
                id uuid default gen_random_uuid() primary key, host text, port int, username text, password text,
                from_name text, from_email text, encryption text default &apos;tls&apos;, enabled boolean default true,
                updated_at timestamptz, updated_by text
              </code>
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between gap-3 px-6 py-4 flex-wrap"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {initialSmtp?.updated_at && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Last updated:{' '}
              {new Date(initialSmtp.updated_at).toLocaleString('en', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving}
              className="flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
              style={{
                background: 'var(--color-surface)',
                border: '1.5px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              <TestTube2 size={14} />
              {testing ? 'Testing...' : 'Test Config'}
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || testing}
              className="flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: '#0EA5E9', boxShadow: '0 2px 8px rgba(14,165,233,0.3)' }}
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
