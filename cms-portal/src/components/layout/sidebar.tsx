'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logoutAction } from '@/app/login/actions'
import type { SessionUser } from '@/types'
import { cn } from '@/lib/cn'
import {
  LayoutGrid,
  TrendingUp,
  Users,
  GitBranch,
  Settings,
  FolderOpen,
  BarChart2,
  CheckSquare,
  Building2,
  UsersRound,
  PieChart,
  Package,
  ShieldCheck,
  LogOut,
  ChevronRight,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  allowedRoles?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Accounts', href: '/dashboard/accounts', icon: <LayoutGrid size={18} /> },
  { label: 'Campaigns', href: '/dashboard/campaigns', icon: <TrendingUp size={18} /> },
  { label: 'Users', href: '/dashboard/users', icon: <Users size={18} /> },
  { label: 'Workflows', href: '/dashboard/workflows', icon: <GitBranch size={18} /> },
  { label: 'Rules', href: '/dashboard/rules', icon: <Settings size={18} /> },
  { label: 'Drive Manager', href: '/dashboard/drive', icon: <FolderOpen size={18} /> },
  { label: 'Looker Reports', href: '/dashboard/looker', icon: <BarChart2 size={18} /> },
  { label: 'Tasks', href: '/dashboard/tasks', icon: <CheckSquare size={18} /> },
  { label: 'Departments', href: '/dashboard/departments', icon: <Building2 size={18} />, allowedRoles: ['Admin', 'Super Manager', 'Manager'] },
  { label: 'Team', href: '/dashboard/team', icon: <UsersRound size={18} /> },
  { label: 'Analytics', href: '/dashboard/analytics', icon: <PieChart size={18} /> },
  { label: 'Packages', href: '/dashboard/packages', icon: <Package size={18} /> },
]

const ROLE_BADGE_COLORS: Record<string, string> = {
  Admin: 'bg-purple-100 text-purple-700',
  'Super Manager': 'bg-blue-100 text-blue-700',
  Manager: 'bg-sky-100 text-sky-700',
  Supervisor: 'bg-teal-100 text-teal-700',
  User: 'bg-slate-100 text-slate-600',
}

interface SidebarProps {
  user: SessionUser
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className="glass-sidebar fixed left-0 top-0 h-screen flex flex-col z-30"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {/* ── Logo ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 h-16 shrink-0"
        style={{ borderBottom: '1px solid rgba(226,232,240,0.5)' }}
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
          style={{ background: 'linear-gradient(135deg, var(--blue-600), var(--blue-700))' }}
        >
          <ShieldCheck size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <div
            className="font-bold text-base leading-tight truncate"
            style={{ color: 'var(--slate-800)', letterSpacing: '-0.02em' }}
          >
            CMS Portal
          </div>
          <div className="text-xs font-medium" style={{ color: 'var(--slate-400)' }}>Operations Hub</div>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <div className="mb-2 px-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--slate-400)' }}>
            Menu
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            if (item.allowedRoles && !item.allowedRoles.includes(user.role)) return null

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                    isActive
                      ? 'text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                  style={
                    isActive
                      ? {
                          background: 'linear-gradient(135deg, var(--blue-600), var(--blue-700))',
                          boxShadow: 'var(--nav-active-shadow)',
                        }
                      : {}
                  }
                  onMouseEnter={e => {
                    if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.65)'
                  }}
                  onMouseLeave={e => {
                    if (!isActive) e.currentTarget.style.background = ''
                  }}
                >
                  <span className={cn('shrink-0', isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600')}>
                    {item.icon}
                  </span>
                  <span className="truncate flex-1">{item.label}</span>
                  {isActive && <ChevronRight size={14} className="shrink-0 opacity-70" />}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ── User Profile ─────────────────────────────────────── */}
      <div
        className="px-3 py-4 shrink-0"
        style={{ borderTop: '1px solid rgba(226,232,240,0.5)' }}
      >
        <div
          className="flex items-center gap-3 p-2.5 rounded-xl mb-2"
          style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.7)' }}
        >
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 text-white"
            style={{ background: 'linear-gradient(135deg, var(--blue-600), var(--blue-700))' }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--slate-900)' }}
            >
              {user.username}
            </div>
            <span
              className={cn(
                'text-xs font-medium px-1.5 py-0.5 rounded-full inline-block',
                ROLE_BADGE_COLORS[user.role] ?? 'bg-slate-100 text-slate-600'
              )}
            >
              {user.role}
            </span>
          </div>
        </div>

        {/* Logout */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ color: 'var(--slate-500)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(254,242,242,0.8)'; e.currentTarget.style.color = '#EF4444'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--slate-500)'; }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
