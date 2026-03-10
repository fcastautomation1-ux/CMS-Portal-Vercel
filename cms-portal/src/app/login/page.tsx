'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { loginAction } from './actions'
import { Eye, EyeOff } from 'lucide-react'

const initialState = null

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full h-12 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed"
      style={{ background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', boxShadow: '0 4px 15px rgba(124,58,237,0.4)' }}
    >
      {pending ? (
        <>
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 11-6.219-8.56"/>
          </svg>
          Signing in...
        </>
      ) : 'Sign In'}
    </button>
  )
}

function CmsIllustration() {
  return (
    <svg viewBox="0 0 420 500" width="380" height="440" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Phone body */}
      <rect x="110" y="40" width="200" height="360" rx="28" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
      <rect x="118" y="72" width="184" height="292" rx="6" fill="rgba(255,255,255,0.08)"/>
      {/* Phone notch */}
      <rect x="170" y="52" width="60" height="10" rx="5" fill="rgba(255,255,255,0.25)"/>
      {/* Screen content: mini dashboard */}
      <rect x="126" y="80" width="168" height="24" rx="4" fill="rgba(255,255,255,0.15)"/>
      <rect x="132" y="87" width="60" height="10" rx="3" fill="rgba(255,255,255,0.5)"/>
      <circle cx="279" cy="92" r="7" fill="rgba(167,139,250,0.6)"/>
      {/* Stat cards row */}
      <rect x="126" y="112" width="76" height="50" rx="6" fill="rgba(255,255,255,0.15)"/>
      <rect x="134" y="120" width="40" height="6" rx="2" fill="rgba(255,255,255,0.5)"/>
      <rect x="134" y="130" width="28" height="10" rx="2" fill="white"/>
      <rect x="134" y="145" width="50" height="4" rx="1" fill="rgba(167,139,250,0.5)"/>
      <rect x="210" y="112" width="76" height="50" rx="6" fill="rgba(255,255,255,0.15)"/>
      <rect x="218" y="120" width="40" height="6" rx="2" fill="rgba(255,255,255,0.5)"/>
      <rect x="218" y="130" width="28" height="10" rx="2" fill="white"/>
      <rect x="218" y="145" width="50" height="4" rx="1" fill="rgba(196,181,253,0.5)"/>
      {/* Table rows */}
      <rect x="126" y="170" width="168" height="6" rx="2" fill="rgba(255,255,255,0.2)"/>
      <rect x="126" y="182" width="140" height="5" rx="2" fill="rgba(255,255,255,0.12)"/>
      <rect x="126" y="193" width="155" height="5" rx="2" fill="rgba(255,255,255,0.12)"/>
      <rect x="126" y="204" width="130" height="5" rx="2" fill="rgba(255,255,255,0.12)"/>
      <rect x="126" y="215" width="148" height="5" rx="2" fill="rgba(255,255,255,0.12)"/>
      <rect x="126" y="226" width="138" height="5" rx="2" fill="rgba(255,255,255,0.12)"/>
      {/* Progress bar */}
      <rect x="126" y="240" width="168" height="8" rx="4" fill="rgba(255,255,255,0.12)"/>
      <rect x="126" y="240" width="110" height="8" rx="4" fill="rgba(167,139,250,0.7)"/>
      {/* Bottom area */}
      <rect x="126" y="258" width="168" height="90" rx="6" fill="rgba(255,255,255,0.08)"/>
      <rect x="134" y="266" width="60" height="6" rx="2" fill="rgba(255,255,255,0.4)"/>
      <rect x="134" y="278" width="100" height="4" rx="1" fill="rgba(255,255,255,0.2)"/>
      <rect x="134" y="288" width="85" height="4" rx="1" fill="rgba(255,255,255,0.2)"/>
      <rect x="134" y="298" width="95" height="4" rx="1" fill="rgba(255,255,255,0.2)"/>
      <rect x="134" y="316" width="80" height="22" rx="6" fill="rgba(124,58,237,0.8)"/>
      <rect x="142" y="323" width="64" height="8" rx="2" fill="white"/>

      {/* Floating shield badge — top right */}
      <g transform="translate(298, 60)">
        <rect width="72" height="72" rx="16" fill="white" opacity="0.95"/>
        <path d="M36 18L56 26V38C56 50 47 58 36 62C25 58 16 50 16 38V26L36 18Z" fill="#7C3AED" opacity="0.85"/>
        <path d="M28 38L33 43L44 32" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </g>

      {/* Floating check bubble — left */}
      <g transform="translate(32, 140)">
        <rect width="64" height="40" rx="12" fill="white" opacity="0.95"/>
        <circle cx="20" cy="20" r="9" fill="#7C3AED" opacity="0.9"/>
        <path d="M15 20L18.5 23.5L25 16.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="36" y="13" width="20" height="5" rx="2" fill="#E2E8F0"/>
        <rect x="36" y="22" width="14" height="4" rx="2" fill="#E2E8F0"/>
      </g>

      {/* Floating lock card — bottom left */}
      <g transform="translate(20, 310)">
        <rect width="76" height="76" rx="18" fill="white" opacity="0.95"/>
        <rect x="26" y="38" width="24" height="20" rx="4" fill="#7C3AED" opacity="0.8"/>
        <path d="M30 38V32C30 28.7 32.7 26 36 26V26C39.3 26 42 28.7 42 32V38" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" opacity="0.8"/>
        <circle cx="38" cy="47" r="2.5" fill="white"/>
      </g>

      {/* Floating analytics chart — top left outer */}
      <g transform="translate(340, 200)">
        <rect width="68" height="60" rx="14" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"/>
        <rect x="12" y="40" width="8" height="12" rx="2" fill="rgba(255,255,255,0.6)"/>
        <rect x="24" y="30" width="8" height="22" rx="2" fill="white"/>
        <rect x="36" y="22" width="8" height="30" rx="2" fill="rgba(255,255,255,0.6)"/>
        <rect x="48" y="32" width="8" height="20" rx="2" fill="rgba(255,255,255,0.4)"/>
      </g>

      {/* Cloud shapes */}
      <ellipse cx="60" cy="80" rx="28" ry="16" fill="white" opacity="0.15"/>
      <ellipse cx="78" cy="72" rx="22" ry="14" fill="white" opacity="0.1"/>
      <ellipse cx="355" cy="440" rx="32" ry="18" fill="white" opacity="0.12"/>
      <ellipse cx="378" cy="432" rx="24" ry="14" fill="white" opacity="0.08"/>
      <ellipse cx="48" cy="460" rx="26" ry="15" fill="white" opacity="0.1"/>
    </svg>
  )
}

export default function LoginPage() {
  const [state, formAction] = useFormState(loginAction, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#EAEAEA' }}>
      <div
        className="w-full max-w-5xl flex rounded-3xl overflow-hidden"
        style={{ minHeight: '620px', background: 'white', boxShadow: '0 24px 80px rgba(0,0,0,0.14)' }}
      >
        {/* ── Left: Form Panel ─────────────────────────────── */}
        <div className="flex-1 flex flex-col justify-center px-12 py-14 bg-white">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-10">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#7C3AED' }}>
              <svg width="16" height="16" fill="white" viewBox="0 0 16 16">
                <rect x="2" y="2" width="5" height="5" rx="1.2"/>
                <rect x="9" y="2" width="5" height="5" rx="1.2"/>
                <rect x="2" y="9" width="5" height="5" rx="1.2"/>
                <rect x="9" y="9" width="5" height="5" rx="1.2"/>
              </svg>
            </div>
            <span className="font-bold text-lg tracking-tight" style={{ color: '#0F172A' }}>CMS Portal</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1
              className="font-extrabold leading-tight mb-2"
              style={{ fontSize: '2.4rem', color: '#0F172A', letterSpacing: '-0.02em' }}
            >
              Holla,<br />Welcome Back
            </h1>
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              Hey, welcome back to your special place
            </p>
          </div>

          {/* Error */}
          {state && !state.success && (
            <div className="flex items-center gap-2 text-sm p-3 rounded-xl mb-5" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 4a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0V5zm-.75 6a.875.875 0 100-1.75.875.875 0 000 1.75z"/>
              </svg>
              {state.error}
            </div>
          )}

          {/* Form */}
          <form action={formAction} className="flex flex-col gap-4">
            {/* Username */}
            <input
              ref={usernameRef}
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              placeholder="Username"
              className="w-full h-12 px-4 rounded-xl text-sm outline-none"
              style={{ border: '1.5px solid #E2E8F0', background: '#FAFAFA', color: '#0F172A' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.1)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
            />

            {/* Password */}
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••••••"
                className="w-full h-12 px-4 pr-12 rounded-xl text-sm outline-none"
                style={{ border: '1.5px solid #E2E8F0', background: '#FAFAFA', color: '#0F172A' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.1)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2"
                style={{ color: '#94A3B8' }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Remember me + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="remember"
                  className="w-4 h-4 rounded"
                  style={{ accentColor: '#7C3AED' }}
                />
                <span className="text-sm" style={{ color: '#64748B' }}>Remember me</span>
              </label>
              <button type="button" className="text-sm font-medium" style={{ color: '#7C3AED' }}>
                Forgot Password?
              </button>
            </div>

            <SubmitButton />
          </form>

          {/* Footer */}
          <p className="text-sm text-center mt-8" style={{ color: '#94A3B8' }}>
            Don&apos;t have an account?{' '}
            <span className="font-semibold cursor-pointer" style={{ color: '#7C3AED' }}>Sign Up</span>
          </p>
        </div>

        {/* ── Right: Illustration Panel ─────────────────────── */}
        <div
          className="hidden lg:flex lg:w-[55%] items-center justify-center relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 45%, #4F46E5 100%)' }}
        >
          {/* Background glow blobs */}
          <div
            className="absolute -top-20 -right-20 w-80 h-80 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(196,181,253,0.3), transparent)' }}
          />
          <div
            className="absolute -bottom-[60px] -left-[60px] w-64 h-64 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.25), transparent)' }}
          />
          <CmsIllustration />
        </div>
      </div>
    </div>
  )
}
