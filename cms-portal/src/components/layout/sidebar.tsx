'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'
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
  { label: 'Departments', href: '/dashboard/departments', icon: <Building2 size={18} /> },
  { label: 'Team', href: '/dashboard/team', icon: <UsersRound size={18} /> },
  { label: 'Analytics', href: '/dashboard/analytics', icon: <PieChart size={18} /> },
  { label: 'Packages', href: '/dashboard/packages', icon: <Package size={18} /> },
]

/**
 * Mirrors the frontend.html updateNavigationVisibility() logic.
 * Determines which nav items each role can see.
 */
function isNavItemVisible(href: string, user: SessionUser): boolean {
  const { role, moduleAccess: ma, allowedAccounts, allowedCampaigns, allowedDriveFolders, allowedLookerReports, teamMembers } = user
  const isAdminOrSM = role === 'Admin' || role === 'Super Manager'
  const isManager = role === 'Manager'

  switch (href) {
    case '/dashboard/accounts':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.enabled === true
      return allowedAccounts.length > 0

    case '/dashboard/campaigns':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.enabled === true
      return allowedCampaigns.length > 0

    case '/dashboard/users':
      if (isAdminOrSM) return true
      if (isManager) return ma?.users?.enabled === true
      return false // Supervisor/User: never

    case '/dashboard/workflows':
    case '/dashboard/rules':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.accessLevel === 'all'
      return false // Supervisor/User: never

    case '/dashboard/drive':
      if (isAdminOrSM || isManager) return true
      return allowedDriveFolders.length > 0

    case '/dashboard/looker':
      if (isAdminOrSM) return true
      if (isManager) return ma?.looker?.enabled === true
      return allowedLookerReports.length > 0

    case '/dashboard/tasks':
      return true // always visible

    case '/dashboard/departments':
    case '/dashboard/packages':
      return isAdminOrSM || isManager // Supervisor/User: never

    case '/dashboard/team':
      if (isAdminOrSM) return true
      return teamMembers.length > 0

    case '/dashboard/analytics':
      return isAdminOrSM // Admin and Super Manager only

    default:
      return true
  }
}

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
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    // Prefetch visible module routes so the next click is instant.
    NAV_ITEMS.filter(item => isNavItemVisible(item.href, user)).forEach(item => {
      router.prefetch(item.href)
    })
  }, [router, user])

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction()
      router.push('/login')
      router.refresh()
    })
  }

  return (
    <aside
      className="glass-sidebar fixed left-0 top-0 h-screen flex flex-col z-30"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {/* ── Logo ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 h-16 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-600)' }}
        >
          <ShieldCheck size={15} className="text-white" />
        </div>
        <div className="min-w-0">
          <div
            className="font-bold text-sm leading-tight truncate"
            style={{ color: 'var(--slate-800)', letterSpacing: '-0.01em' }}
          >
            CMS Portal
          </div>
          <div className="text-[11px] font-medium" style={{ color: 'var(--slate-400)' }}>Operations Hub</div>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        <div className="mb-1.5 px-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.10em]" style={{ color: 'var(--slate-400)' }}>
            Main
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            if (!isNavItemVisible(item.href, user)) return null

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group',
                    isActive
                      ? 'text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  )}
                  style={
                    isActive
                      ? {
                          background: 'var(--blue-600)',
                          boxShadow: 'var(--nav-active-shadow)',
                        }
                      : {}
                  }
                >
                  <span className={cn('shrink-0', isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-500')}>
                    {item.icon}
                  </span>
                  <span className="truncate flex-1">{item.label}</span>
                  {isActive && <ChevronRight size={13} className="shrink-0 opacity-60" />}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ── User Profile ─────────────────────────────────────── */}
      <div
        className="px-3 py-4 shrink-0"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <div
          className="flex items-center gap-3 p-2.5 rounded-lg mb-2"
          style={{ background: 'var(--slate-50)', border: '1px solid var(--color-border)' }}
        >
          {/* Avatar */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 text-white"
            style={{ background: 'var(--blue-600)' }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--slate-800)' }}
            >
              {user.username}
            </div>
            <span
              className={cn(
                'text-xs font-medium px-1.5 py-0.5 rounded inline-block',
                ROLE_BADGE_COLORS[user.role] ?? 'bg-slate-100 text-slate-600'
              )}
            >
              {user.role}
            </span>
          </div>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isPending}
          className="btn-motion w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 hover:bg-red-50 hover:text-red-600"
          style={{ color: 'var(--slate-500)' }}
        >
          <LogOut size={15} />
          {isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
