'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { getOverviewStats, getManagerOverview, getUserPersonalStats } from '@/app/dashboard/overview/actions'
import { getAnalytics } from '@/app/dashboard/analytics/actions'
import { getUsers, getDepartmentsList, getUserFormOptions } from '@/app/dashboard/users/actions'
import { getDepartments, getDepartmentMembersWithNames } from '@/app/dashboard/departments/actions'
import { getPackages, getPackageAssignmentUsers, getUserPackageAssignments } from '@/app/dashboard/packages/actions'
import { getLookerReports } from '@/app/dashboard/looker/actions'
import { getAccounts } from '@/app/dashboard/accounts/actions'
import { getCampaigns, getAccountsForCampaigns, getConditionDefinitions } from '@/app/dashboard/campaigns/actions'
import {
  getTodos,
  getSidebarTaskCounts,
  getPackagesForTaskForm,
  getUsersForAssignment,
  getDepartmentsForTaskForm,
} from '@/app/dashboard/tasks/actions'
import { getTeamStats } from '@/app/dashboard/team/actions'
import { queryKeys } from '@/lib/query-keys'
import type { SessionUser } from '@/types'

interface PortalWarmupProps {
  user: SessionUser
}

type WarmTask = {
  key: readonly unknown[]
  fn: () => Promise<unknown>
  staleTime?: number
}

function scheduleIdleTask(callback: () => void, delay: number) {
  let idleId: number | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  const timer = window.setTimeout(() => {
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => callback(), { timeout: 2_000 })
      return
    }

    fallbackTimer = globalThis.setTimeout(callback, 0)
  }, delay)

  return () => {
    window.clearTimeout(timer)
    if (idleId !== null) window.cancelIdleCallback(idleId)
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
  }
}

function shouldReduceWarmupWork() {
  if (typeof navigator === 'undefined') return false

  const connection = (navigator as Navigator & {
    connection?: {
      saveData?: boolean
      effectiveType?: string
    }
  }).connection as {
    saveData?: boolean
    effectiveType?: string
  } | undefined

  if (connection?.saveData) return true
  return connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g'
}

function getAccessibleRoutes(user: SessionUser) {
  const routes = new Set<string>([
    '/dashboard',
    '/dashboard/tasks',
    '/dashboard/tasks?scope=my_all&status=all',
    '/dashboard/tasks?scope=my_all&status=completed',
    '/dashboard/tasks?scope=my_all&status=pending',
    '/dashboard/tasks?scope=my_all&status=overdue',
  ])

  const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
  const isManager = user.role === 'Manager'

  if (user.teamMembers.length > 0 || isAdminOrSM) {
    routes.add('/dashboard/team?scope=users')
    routes.add('/dashboard/team?scope=tasks_all')
    routes.add('/dashboard/team?scope=tasks_completed')
    routes.add('/dashboard/team?scope=tasks_pending')
    routes.add('/dashboard/team?scope=tasks_overdue')
  }

  if (isAdminOrSM || isManager) {
    routes.add('/dashboard/users')
    routes.add('/dashboard/departments')
    routes.add('/dashboard/packages')
  }

  if (
    isAdminOrSM ||
    isManager ||
    user.allowedLookerReports.length > 0
  ) {
    routes.add('/dashboard/looker')
  }

  if (isAdminOrSM) {
    routes.add('/dashboard/analytics')
    routes.add('/dashboard/settings')
  }

  if (
    isAdminOrSM ||
    (isManager && user.moduleAccess?.googleAccount?.enabled) ||
    user.allowedAccounts.length > 0
  ) {
    routes.add('/dashboard/accounts')
    routes.add('/dashboard/campaigns')
  }

  if (isAdminOrSM || (isManager && user.moduleAccess?.googleAccount?.accessLevel === 'all')) {
    routes.add('/dashboard/workflows')
    routes.add('/dashboard/rules')
  }

  return Array.from(routes)
}

export function PortalWarmup({ user }: PortalWarmupProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    const warmupKey = `cms-portal-warmup:${user.username}:${new Date().toISOString().slice(0, 10)}`
    if (sessionStorage.getItem(warmupKey) === 'done') return

    const reduceWarmupWork = shouldReduceWarmupWork()
    const routes = getAccessibleRoutes(user)
    routes.forEach((href) => router.prefetch(href))

    const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
    const isManagerOrSupervisor = user.role === 'Manager' || user.role === 'Supervisor'
    const canManageUsers = isAdminOrSM || user.role === 'Manager'
    const canManagePackages = isAdminOrSM || user.role === 'Manager'
    const canAccessLooker = isAdminOrSM || user.role === 'Manager' || user.allowedLookerReports.length > 0
    const canAccessAccounts =
      isAdminOrSM ||
      (user.role === 'Manager' && user.moduleAccess?.googleAccount?.enabled) ||
      user.allowedAccounts.length > 0
    const canAccessCampaigns = canAccessAccounts || user.allowedCampaigns.length > 0
    const canAccessTeam = isAdminOrSM || user.teamMembers.length > 0

    const warmTasks: WarmTask[] = [
      {
        key: queryKeys.taskSidebarCounts(user.username),
        fn: () => getSidebarTaskCounts(),
        staleTime: 60_000,
      },
      {
        key: queryKeys.tasks(user.username),
        fn: () => getTodos(),
        staleTime: 60_000,
      },
      {
        key: queryKeys.taskFormPackages(),
        fn: () => getPackagesForTaskForm(),
        staleTime: 60_000,
      },
      {
        key: queryKeys.taskAssignmentUsers(user.username),
        fn: () => getUsersForAssignment(),
        staleTime: 60_000,
      },
      {
        key: queryKeys.taskFormDepartments(),
        fn: () => getDepartmentsForTaskForm(),
        staleTime: 60_000,
      },
    ]

    if (isAdminOrSM) {
      warmTasks.push({
        key: queryKeys.overviewAdmin(user.username),
        fn: () => getOverviewStats(),
        staleTime: 30_000,
      })
      warmTasks.push({
        key: queryKeys.analytics(user.username),
        fn: () => getAnalytics(),
        staleTime: 30_000,
      })
    } else if (isManagerOrSupervisor) {
      warmTasks.push({
        key: queryKeys.overviewManager(user.username),
        fn: () => getManagerOverview(),
        staleTime: 30_000,
      })
    } else {
      warmTasks.push({
        key: queryKeys.overviewPersonal(user.username),
        fn: () => getUserPersonalStats(),
        staleTime: 30_000,
      })
    }

    if (canAccessTeam) {
      warmTasks.push({
        key: queryKeys.teamStats(user.username),
        fn: () => getTeamStats(),
        staleTime: 60_000,
      })
    }

    if (canManageUsers) {
      warmTasks.push(
        {
          key: queryKeys.users(user.username),
          fn: () => getUsers(),
          staleTime: 30_000,
        },
        {
          key: queryKeys.userDepartments(),
          fn: () => getDepartmentsList(),
          staleTime: 60_000,
        },
        {
          key: queryKeys.userFormOptions(),
          fn: () => getUserFormOptions(),
          staleTime: 60_000,
        }
      )
    }

    if (isAdminOrSM || user.role === 'Manager') {
      warmTasks.push(
        {
          key: queryKeys.departments(),
          fn: () => getDepartments(),
          staleTime: 60_000,
        },
        {
          key: queryKeys.departmentMembers(),
          fn: () => getDepartmentMembersWithNames(),
          staleTime: 60_000,
        }
      )
    }

    if (canManagePackages) {
      warmTasks.push(
        {
          key: queryKeys.packages(),
          fn: () => getPackages(),
          staleTime: 60_000,
        },
        {
          key: queryKeys.packageAssignmentUsers(),
          fn: () => getPackageAssignmentUsers(),
          staleTime: 60_000,
        },
        {
          key: queryKeys.packageAssignments(),
          fn: () => getUserPackageAssignments(),
          staleTime: 60_000,
        }
      )
    }

    if (canAccessLooker) {
      warmTasks.push({
        key: queryKeys.lookerReports(user.username),
        fn: () => getLookerReports(),
        staleTime: 60_000,
      })
    }

    if (canAccessAccounts) {
      warmTasks.push({
        key: queryKeys.accounts(user.username),
        fn: () => getAccounts(),
        staleTime: 60_000,
      })
    }

    if (canAccessCampaigns) {
      warmTasks.push(
        {
          key: queryKeys.campaigns(user.username),
          fn: () => getCampaigns(),
          staleTime: 60_000,
        },
        {
          key: queryKeys.campaignAccounts(user.username),
          fn: () => getAccountsForCampaigns(),
          staleTime: 60_000,
        },
        {
          key: queryKeys.campaignDefinitions(),
          fn: () => getConditionDefinitions(),
          staleTime: 300_000,
        }
      )
    }

    const taskBatch = reduceWarmupWork ? warmTasks.slice(0, 6) : warmTasks
    const cleanups = taskBatch.map((task, index) =>
      scheduleIdleTask(() => {
        void queryClient.prefetchQuery({
          queryKey: task.key,
          queryFn: task.fn,
          staleTime: task.staleTime,
        }).catch(() => undefined)
      }, 250 + index * (reduceWarmupWork ? 300 : 180))
    )

    const doneCleanup = scheduleIdleTask(() => {
      sessionStorage.setItem(warmupKey, 'done')
    }, 250 + taskBatch.length * (reduceWarmupWork ? 300 : 180) + 250)

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      doneCleanup()
    }
  }, [queryClient, router, user])

  return null
}
