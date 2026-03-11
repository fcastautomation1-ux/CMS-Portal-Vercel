'use client'

import { useState, useRef, useCallback } from 'react'
import {
  User, Mail, Building2, Lock, Bell, Shield, Camera, Trash2,
  Eye, EyeOff, CheckCircle, ArrowLeft, Save,
} from 'lucide-react'
import Link from 'next/link'
import type { SessionUser } from '@/types'
import type { Department } from '@/types'
import { updateProfile, changePassword } from '@/app/dashboard/profile/actions'

const ROLE_GRADIENTS: Record<string, string> = {
  Admin:           'linear-gradient(135deg, #8B5CF6, #7C3AED)',
  'Super Manager': 'linear-gradient(135deg, #2B7FFF, #1A6AE4)',
  Manager:         'linear-gradient(135deg, #14B8A6, #0D9488)',
  Supervisor:      'linear-gradient(135deg, #F59E0B, #D97706)',
  User:            'linear-gradient(135deg, #64748B, #475569)',
}

interface ProfileData {
  email: string
  department: string | null
  full_name: string | null
  avatar_data: string | null
  email_notifications_enabled: boolean
}

interface Props {
  user: SessionUser
  profile: ProfileData
  departments: Department[]
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>{title}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
      </div>
      <div
        className="rounded-2xl p-5 sm:p-6 flex flex-col gap-5"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
      >
        {children}
      </div>
    </div>
  )
}

function InputField({
  label, type = 'text', value, onChange, placeholder, readOnly = false, suffix,
}: {
  label: string
  type?: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  readOnly?: boolean
  suffix?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className="w-full h-10 px-3 rounded-xl text-sm outline-none transition-all"
          style={{
            border: '1.5px solid var(--color-border)',
            background: readOnly ? 'var(--slate-50)' : 'var(--color-surface)',
            color: readOnly ? 'var(--color-text-muted)' : 'var(--color-text)',
            paddingRight: suffix ? '40px' : undefined,
          }}
          onFocus={e => { if (!readOnly) e.currentTarget.style.borderColor = '#2B7FFF' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {suffix}
          </div>
        )}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, description, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string; icon: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: checked ? 'rgba(43,127,255,0.1)' : 'var(--slate-100)', color: checked ? '#2B7FFF' : 'var(--color-text-muted)' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="w-11 h-6 rounded-full relative shrink-0 transition-all duration-200"
        style={{ background: checked ? '#2B7FFF' : 'var(--slate-200)' }}
        aria-checked={checked}
        role="switch"
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up"
      style={{
        background: type === 'success' ? '#10B981' : '#EF4444',
        color: 'white',
        maxWidth: 320,
      }}
    >
      {type === 'success' ? <CheckCircle size={15} /> : null}
      {message}
    </div>
  )
}

export function ProfilePage({ user, profile, departments }: Props) {
  const gradient = ROLE_GRADIENTS[user.role] ?? ROLE_GRADIENTS.User
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Personal info state
  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [email, setEmail] = useState(profile.email)
  const [department, setDepartment] = useState(profile.department ?? '')
  const [avatarData, setAvatarData] = useState<string | null>(profile.avatar_data)
  const [savingInfo, setSavingInfo] = useState(false)

  // Security state
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  // Preferences state
  const [emailNotifs, setEmailNotifs] = useState(profile.email_notifications_enabled)
  const [savingPrefs, setSavingPrefs] = useState(false)

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Avatar upload
  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      showToast('Image must be under 2MB', 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setAvatarData(reader.result as string)
    reader.readAsDataURL(file)
  }, [])

  // Save personal info
  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) { showToast('Enter a valid email address', 'error'); return }
    setSavingInfo(true)
    const res = await updateProfile({ email, full_name: fullName, department: department || null, avatar_data: avatarData })
    setSavingInfo(false)
    if (res.success) showToast('Profile updated successfully', 'success')
    else showToast(res.error ?? 'Failed to update profile', 'error')
  }

  // Save password
  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPw) { showToast('Enter your current password', 'error'); return }
    if (newPw.length < 8) { showToast('New password must be at least 8 characters', 'error'); return }
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return }
    setSavingPw(true)
    const res = await changePassword({ currentPassword: currentPw, newPassword: newPw })
    setSavingPw(false)
    if (res.success) {
      showToast('Password changed successfully', 'success')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } else {
      showToast(res.error ?? 'Failed to change password', 'error')
    }
  }

  // Save preferences
  async function handleSavePreferences() {
    setSavingPrefs(true)
    const res = await updateProfile({ email_notifications_enabled: emailNotifs })
    setSavingPrefs(false)
    if (res.success) showToast('Preferences saved', 'success')
    else showToast(res.error ?? 'Failed to save preferences', 'error')
  }

  return (
    <div className="max-w-2xl mx-auto">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Edit Profile</h1>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Manage your account settings and preferences</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">

        {/* ── Personal Information ── */}
        <Section title="Personal Information" subtitle="Update your profile details and avatar.">
          <form onSubmit={handleSaveInfo} className="flex flex-col gap-5">
            {/* Avatar */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative">
                <div
                  className="w-16 h-16 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-xl font-bold text-white"
                  style={{ background: avatarData ? undefined : gradient }}
                >
                  {avatarData ? (
                    <img src={avatarData} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                {/* Role badge */}
                <span
                  className="absolute -bottom-1 -right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white shadow-sm"
                  style={{ background: gradient }}
                >
                  {user.role.split(' ')[0]}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 px-3 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5"
                    style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)' }}
                  >
                    <Camera size={12} /> Change Avatar
                  </button>
                  {avatarData && (
                    <button
                      type="button"
                      onClick={() => setAvatarData(null)}
                      className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5"
                      style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>JPG, GIF or PNG. Max size 2MB.</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>

            {/* Username (read-only) */}
            <InputField label="Username" value={user.username} readOnly />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField
                label="Full Name"
                value={fullName}
                onChange={setFullName}
                placeholder="Your full name"
              />
              <InputField
                label="Email Address"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
              />
            </div>

            {/* Department */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Department</label>
              <div className="relative">
                <select
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl text-sm outline-none appearance-none"
                  style={{ border: '1.5px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="">No department</option>
                  {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Building2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingInfo}
                className="h-9 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', opacity: savingInfo ? 0.7 : 1 }}
              >
                <Save size={14} />
                {savingInfo ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Section>

        {/* ── Security ── */}
        <Section title="Security" subtitle="Manage your password and account protection.">
          <form onSubmit={handleSavePassword} className="flex flex-col gap-4">
            <InputField
              label="Current Password"
              type={showCurrentPw ? 'text' : 'password'}
              value={currentPw}
              onChange={setCurrentPw}
              placeholder="••••••••"
              suffix={
                <button type="button" onClick={() => setShowCurrentPw(v => !v)} style={{ color: 'var(--color-text-muted)' }}>
                  {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField
                label="New Password"
                type={showNewPw ? 'text' : 'password'}
                value={newPw}
                onChange={setNewPw}
                placeholder="Min. 8 characters"
                suffix={
                  <button type="button" onClick={() => setShowNewPw(v => !v)} style={{ color: 'var(--color-text-muted)' }}>
                    {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
              />
              <InputField
                label="Confirm New Password"
                type="password"
                value={confirmPw}
                onChange={setConfirmPw}
                placeholder="Re-enter password"
              />
            </div>

            {/* Password strength */}
            {newPw.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Strength:</span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: newPw.length >= 12 ? '#10B981' : newPw.length >= 8 ? '#F59E0B' : '#EF4444' }}
                  >
                    {newPw.length >= 12 ? 'Strong' : newPw.length >= 8 ? 'Good' : 'Weak'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--slate-100)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (newPw.length / 16) * 100)}%`,
                      background: newPw.length >= 12 ? '#10B981' : newPw.length >= 8 ? '#F59E0B' : '#EF4444',
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPw}
                className="h-9 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', opacity: savingPw ? 0.7 : 1 }}
              >
                <Lock size={14} />
                {savingPw ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </Section>

        {/* ── Preferences ── */}
        <Section title="Preferences" subtitle="Control your notification settings and privacy.">
          <div className="flex flex-col gap-3">
            <Toggle
              checked={emailNotifs}
              onChange={setEmailNotifs}
              label="Email Notifications"
              description="Receive weekly digests and important system alerts."
              icon={<Bell size={16} />}
            />
            <Toggle
              checked={false}
              onChange={() => { showToast('2FA is managed by your administrator', 'error') }}
              label="Two-Factor Authentication"
              description="Add an extra layer of security to your admin account."
              icon={<Shield size={16} />}
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={savingPrefs}
              className="h-9 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg, #2B7FFF, #1A6AE4)', opacity: savingPrefs ? 0.7 : 1 }}
            >
              <Save size={14} />
              {savingPrefs ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </Section>

        {/* ── Account Info ── */}
        <div
          className="rounded-2xl p-4 flex flex-wrap items-center gap-3"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            <User size={14} style={{ color: 'var(--color-text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Logged in as <strong style={{ color: 'var(--color-text)' }}>{user.username}</strong>
            </span>
          </div>
          <div
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: 'rgba(43,127,255,0.1)', color: '#2B7FFF' }}
          >
            {user.role}
          </div>
          {user.department && (
            <div className="flex items-center gap-1">
              <Building2 size={12} style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{user.department}</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
