'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('No reset token found. Please request a new password reset link.')
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.')
      setStatus('error')
      return
    }
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.')
      setStatus('error')
      return
    }

    setStatus('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const data = await res.json() as { success: boolean; error?: string }
      if (data.success) {
        setStatus('success')
        setTimeout(() => router.push('/login?reset=1'), 3000)
      } else {
        setStatus('error')
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setStatus('error')
      setErrorMsg('Network error. Please check your connection and try again.')
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#EAEAEA' }}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl p-10"
        style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.12)' }}
      >
        {/* Logo / brand */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#7C3AED' }}>
            <svg width="16" height="16" fill="white" viewBox="0 0 16 16">
              <rect x="2" y="2" width="5" height="5" rx="1.2" />
              <rect x="9" y="2" width="5" height="5" rx="1.2" />
              <rect x="2" y="9" width="5" height="5" rx="1.2" />
              <rect x="9" y="9" width="5" height="5" rx="1.2" />
            </svg>
          </div>
          <span className="font-bold text-lg tracking-tight" style={{ color: '#0F172A' }}>CMS Portal</span>
        </div>

        <h1 className="font-extrabold text-2xl mb-2" style={{ color: '#0F172A', letterSpacing: '-0.02em' }}>
          Choose a new password
        </h1>
        <p className="text-sm mb-8" style={{ color: '#94A3B8' }}>
          Enter a new password for your account. It must be at least 8 characters.
        </p>

        {/* Success state */}
        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={48} color="#22c55e" />
            <p className="font-semibold text-lg" style={{ color: '#0F172A' }}>Password updated!</p>
            <p className="text-sm" style={{ color: '#64748B' }}>Redirecting you to the login page…</p>
          </div>
        )}

        {/* Error — no token or already used / expired */}
        {status === 'error' && !token && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <XCircle size={48} color="#ef4444" />
            <p className="font-semibold text-lg" style={{ color: '#0F172A' }}>Invalid link</p>
            <p className="text-sm mb-4" style={{ color: '#64748B' }}>{errorMsg}</p>
            <button
              onClick={() => router.push('/login')}
              className="text-sm font-medium"
              style={{ color: '#7C3AED' }}
            >
              Back to login
            </button>
          </div>
        )}

        {/* Form */}
        {status !== 'success' && token && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Error banner */}
            {status === 'error' && errorMsg && (
              <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* New password */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#64748B' }}>New password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="Min. 8 characters"
                  className="w-full h-12 px-4 pr-12 rounded-xl text-sm outline-none"
                  style={{ border: '1.5px solid #E2E8F0', background: '#FAFAFA', color: '#0F172A' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.1)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#64748B' }}>Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="Repeat your password"
                  className="w-full h-12 px-4 pr-12 rounded-xl text-sm outline-none"
                  style={{ border: '1.5px solid #E2E8F0', background: '#FAFAFA', color: '#0F172A' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.1)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }}>
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full h-12 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 mt-2 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', boxShadow: '0 4px 15px rgba(124,58,237,0.4)' }}
            >
              {status === 'loading' ? (
                <><Loader2 size={16} className="animate-spin" /> Updating password…</>
              ) : 'Set new password'}
            </button>

            <button type="button" onClick={() => router.push('/login')} className="text-sm text-center mt-1" style={{ color: '#94A3B8' }}>
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#EAEAEA' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: '#7C3AED' }} />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
