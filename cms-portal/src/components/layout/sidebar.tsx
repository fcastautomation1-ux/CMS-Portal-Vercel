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
  ChevronLeft,
  ChevronRight,
  Home,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  color: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: <Home size={17} />, color: '#2B7FFF' },
  { label: 'Accounts', href: '/dashboard/accounts', icon: <LayoutGrid size={17} />, color: '#14B8A6' },
  { label: 'Campaigns', href: '/dashboard/campaigns', icon: <TrendingUp size={17} />, color: '#F97316' },
  { label: 'Users', href: '/dashboard/users', icon: <Users size={17} />, color: '#8B5CF6' },
  { label: 'Workflows', href: '/dashboard/workflows', icon: <GitBranch size={17} />, color: '#10B981' },
  { label: 'Rules', href: '/dashboard/rules', icon: <Settings size={17} />, color: '#F59E0B' },
  { label: 'Drive Manager', href: '/dashboard/drive', icon: <FolderOpen size={17} />, color: '#3B82F6' },
  { label: 'Looker Reports', href: '/dashboard/looker', icon: <BarChart2 size={17} />, color: '#6366F1' },
  { label: 'Tasks', href: '/dashboard/tasks', icon: <CheckSquare size={17} />, color: '#10B981' },
  { label: 'Departments', href: '/dashboard/departments', icon: <Building2 size={17} />, color: '#0D9488' },
  { label: 'Team', href: '/dashboard/team', icon: <UsersRound size={17} />, color: '#EC4899' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: <PieChart size={17} />, color: '#8B5CF6' },
  { label: 'Packages', href: '/dashboard/packages', icon: <Package size={17} />, color: '#F59E0B' },
]

function isNavItemVisible(href: string, user: SessionUser): boolean {
  const { role, moduleAccess: ma, allowedAccounts, allowedCampaigns, allowedDriveFolders, allowedLookerReports, teamMembers } = user
  const isAdminOrSM = role === 'Admin' || role === 'Super Manager'
  const isManager = role === 'Manager'

  switch (href) {
    case '/dashboard':
      return true // always visible

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
      return false

    case '/dashboard/workflows':
    case '/dashboard/rules':
      if (isAdminOrSM) return true
      if (isManager) return ma?.googleAccount?.accessLevel === 'all'
      return false

    case '/dashboard/drive':
      if (isAdminOrSM || isManager) return true
      return allowedDriveFolders.length > 0

    case '/dashboard/looker':
      if (isAdminOrSM) return true
      if (isManager) return ma?.looker?.enabled === true
      return allowedLookerReports.length > 0

    case '/dashboard/tasks':
      return true

    case '/dashboard/departments':
    case '/dashboard/packages':
      return isAdminOrSM || isManager

    case '/dashboard/team':
      if (isAdminOrSM) return true
      return teamMembers.length > 0

    case '/dashboard/analytics':
      return isAdminOrSM

    default:
      return true
  }
}

const ROLE_BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  Admin: { bg: 'var(--violet-100)', color: 'var(--violet-600)' },
  'Super Manager': { bg: 'var(--blue-100)', color: 'var(--blue-700)' },
  Manager: { bg: 'var(--teal-100)', color: 'var(--teal-600)' },
  Supervisor: { bg: 'var(--amber-100)', color: 'var(--amber-600)' },
  User: { bg: 'var(--slate-100)', color: 'var(--slate-600)' },
}

interface SidebarProps {
  user: SessionUser
  mobileOpen?: boolean
  onClose?: () => void
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
}

export function Sidebar({
  user,
  mobileOpen = false,
  onClose,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
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

  const roleStyle = ROLE_BADGE_STYLES[user.role] ?? ROLE_BADGE_STYLES['User']

  return (
    <aside
      className={cn(
        'glass-sidebar fixed left-0 top-0 h-screen flex flex-col z-40 transition-all duration-300',
        'md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
      style={{ width: collapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)' }}
    >
      {/* ── Logo ─────────────────────────────────────────────── */}
      <div
        className="flex items-center h-16 shrink-0 overflow-hidden"
        style={{ borderBottom: '1px solid var(--color-border)', padding: collapsed ? '0 14px' : '0 20px' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--blue-600), var(--violet-600))' }}
        >
          <ShieldCheck size={15} className="text-white" />
        </div>
        {!collapsed && (
          <div className="ml-3 min-w-0">
            <div className="font-bold text-sm leading-tight truncate" style={{ color: 'var(--color-text)', letterSpacing: '-0.01em' }}>
              CMS Portal
            </div>
            <div className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>Operations Hub</div>
          </div>
        )}
      </div>

      {/* ── Navigation ───────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3" style={{ padding: collapsed ? '12px 8px' : '12px' }}>
        {!collapsed && (
          <div className="mb-1.5 px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.10em]" style={{ color: 'var(--color-text-muted)' }}>
              Main
            </span>
          </div>
        )}
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = item.href === '/dashboard'
              ? (pathname === '/dashboard' || pathname === '/dashboard/')
              : (pathname === item.href || pathname.startsWith(item.href + '/'))
            if (!isNavItemVisible(item.href, user)) return null

            const navLink = (
              <Link
                href={item.href}
                onClick={onClose}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center rounded-lg text-sm font-medium transition-all duration-150 group relative',
                  collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-2.5 px-3 py-2',
                  isActive ? 'text-white' : ''
                )}
                style={
                  isActive
                    ? { background: item.color, boxShadow: `0 2px 8px ${item.color}40` }
                    : {}
                }
              >
                {!isActive && (
                  <span
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: `${item.color}12` }}
                  />
                )}
                <span
                  className="shrink-0 relative z-10"
                  style={{ color: isActive ? 'white' : item.color }}
                >
                  {item.icon}
                </span>
                {!collapsed && (
                  <>
                    <span className="truncate flex-1 relative z-10" style={{ color: isActive ? 'white' : 'var(--color-text)' }}>
                      {item.label}
                    </span>
                    {isActive && <ChevronRight size={12} className="shrink-0 opacity-60" />}
                  </>
                )}
              </Link>
            )

            return (
              <li key={item.href}>
                {navLink}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ── User Profile + Collapse toggle ───────────────────── */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid var(--color-border)', padding: collapsed ? '12px 8px' : '12px' }}
      >
        {!collapsed && (
          <div
            className="flex items-center gap-3 p-2.5 rounded-lg mb-2"
            style={{ background: 'var(--slate-100)', border: '1px solid var(--color-border)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{ background: `linear-gradient(135deg, ${roleStyle.color}, ${roleStyle.color}dd)` }}
            >
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                {user.username}
              </div>
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded inline-block"
                style={{ background: roleStyle.bg, color: roleStyle.color }}
              >
                {user.role}
              </span>
            </div>
          </div>
        )}

        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className="hidden md:flex btn-motion w-full items-center rounded-lg text-sm font-medium transition-all hover:bg-red-50 hover:text-red-600 mb-1"
          style={{
            color: 'var(--color-text-muted)',
            gap: collapsed ? 0 : '10px',
            padding: collapsed ? '8px 0' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : (
            <>
              <ChevronLeft size={15} />
              <span>Collapse</span>
            </>
          )}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isPending}
          className="btn-motion w-full flex items-center rounded-lg text-sm font-medium transition-all disabled:opacity-50 hover:bg-red-50 hover:text-red-600"
          style={{
            color: 'var(--color-text-muted)',
            gap: collapsed ? 0 : '10px',
            padding: collapsed ? '8px 0' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={15} />
          {!collapsed && <span>{isPending ? 'Signing out…' : 'Sign out'}</span>}
        </button>
      </div>
    </aside>
  )
}



