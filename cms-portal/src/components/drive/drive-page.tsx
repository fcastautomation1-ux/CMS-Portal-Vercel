'use client'

import { HardDrive, FolderOpen, Shield, Users } from 'lucide-react'
import type { SessionUser } from '@/types'

interface DriveAccess { username: string; drive_access_level: string; allowed_drive_folders: string }
interface Props { config: { folders: string[]; accessLevel: string }; driveAccess: DriveAccess[]; user: SessionUser }

const ACCESS_COLORS: Record<string, string> = {
  full: '#22C55E', upload: '#3B82F6', view: '#F59E0B', none: '#94A3B8',
}

export function DrivePage({ config, driveAccess, user }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Drive Manager</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>Manage Google Drive access and folders</p>
        </div>
      </div>

      {/* Your Access Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.1)' }}>
              <Shield size={20} style={{ color: '#3B82F6' }} />
            </div>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--slate-400)' }}>Your Access Level</p>
              <p className="text-lg font-bold capitalize" style={{ color: 'var(--slate-900)' }}>{config.accessLevel}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
              <FolderOpen size={20} style={{ color: '#22C55E' }} />
            </div>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--slate-400)' }}>Assigned Folders</p>
              <p className="text-lg font-bold" style={{ color: 'var(--slate-900)' }}>{config.folders.length}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.1)' }}>
              <Users size={20} style={{ color: '#A855F7' }} />
            </div>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--slate-400)' }}>Users with Access</p>
              <p className="text-lg font-bold" style={{ color: 'var(--slate-900)' }}>{driveAccess.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Your Folders */}
      {config.folders.length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--slate-700)' }}>Your Folders</h2>
          <div className="flex flex-wrap gap-2">
            {config.folders.map(f => (
              <span key={f} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'rgba(59,130,246,0.08)', color: '#2563EB' }}>
                <FolderOpen size={12} /> {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* User Access Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--slate-100)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--slate-700)' }}>User Access</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
              {['User', 'Access Level', 'Allowed Folders'].map(h => (
                <th key={h} className="text-left px-5 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {driveAccess.length === 0 ? (
              <tr><td colSpan={3} className="px-5 py-12 text-center">
                <HardDrive size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm" style={{ color: 'var(--slate-400)' }}>No drive access configured</p>
              </td></tr>
            ) : driveAccess.map(a => (
              <tr key={a.username} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                      {a.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium" style={{ color: 'var(--slate-900)' }}>{a.username}</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize">
                    <span className="w-2 h-2 rounded-full" style={{ background: ACCESS_COLORS[a.drive_access_level] || ACCESS_COLORS.none }} />
                    {a.drive_access_level}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {a.allowed_drive_folders
                      ? a.allowed_drive_folders.split(',').filter(Boolean).map(f => (
                          <span key={f} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--slate-100)', color: 'var(--slate-600)' }}>{f.trim()}</span>
                        ))
                      : <span className="text-xs" style={{ color: 'var(--slate-400)' }}>—</span>
                    }
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Notice */}
      <div className="mt-6 p-4 rounded-xl text-sm" style={{ background: 'rgba(245,158,11,0.08)', color: '#92400E', border: '1px solid rgba(245,158,11,0.15)' }}>
        <strong>Note:</strong> Google Drive file browsing requires OAuth integration. This page shows access configuration only. Full Drive browsing requires connecting a Google service account.
      </div>
    </div>
  )
}
