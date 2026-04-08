'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getOverviewStats, getManagerOverview, getUserPersonalStats } from '@/app/dashboard/overview/actions'
import {
  getCachedSidebarTaskCounts,
} from '@/app/dashboard/tasks/actions'
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


export function PortalWarmup({ user }: PortalWarmupProps) {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Key expires daily — warmup runs once per day per user
    const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
    const warmupKey = `cms-portal-warmup:${user.username}:d${day}`
    if (sessionStorage.getItem(warmupKey) === 'done') return

    const reduceWarmupWork = shouldReduceWarmupWork()
    const isAdminOrSM = user.role === 'Admin' || user.role === 'Super Manager'
    const isManagerOrSupervisor = user.role === 'Manager' || user.role === 'Supervisor'

    // ── Critical-path only warmup ──────────────────────────────────────────
    // We intentionally limit the warmup scope to only the most critical items
    // immediately after login.  Pre-warming every module (analytics, users,
    // packages, accounts, campaigns, rules, workflows, teamTodos…) multiplied
    // across 50 concurrent users adds 1 000+ serverless invocations in the
    // first minute and overwhelms Supabase connection pools.
    //
    // Heavy modules are loaded on demand when the user navigates to
    // them.  React Query's staleTime handles client-side caching after the
    // first visit.
    const warmTasks: WarmTask[] = [
      // 1. Sidebar badge counts — needed immediately after login
      {
        key: queryKeys.taskSidebarCounts(user.username),
        fn: () => getCachedSidebarTaskCounts(),
        staleTime: 600_000,
      },
    ]

    // 6. Role-specific dashboard overview — lightweight per-role query
    if (!reduceWarmupWork) {
      if (isAdminOrSM) {
        warmTasks.push({
          key: queryKeys.overviewAdmin(user.username),
          fn: () => getOverviewStats(),
          staleTime: 300_000,
        })
      } else if (isManagerOrSupervisor) {
        warmTasks.push({
          key: queryKeys.overviewManager(user.username),
          fn: () => getManagerOverview(),
          staleTime: 300_000,
        })
      } else {
        warmTasks.push({
          key: queryKeys.overviewPersonal(user.username),
          fn: () => getUserPersonalStats(),
          staleTime: 300_000,
        })
      }
    }

    const cleanups = warmTasks.map((task, index) =>
      scheduleIdleTask(() => {
        void queryClient.prefetchQuery({
          queryKey: task.key,
          queryFn: task.fn,
          staleTime: task.staleTime,
        }).catch(() => undefined)
      }, 250 + index * 200)
    )

    const doneCleanup = scheduleIdleTask(() => {
      sessionStorage.setItem(warmupKey, 'done')
    }, 250 + warmTasks.length * 200 + 250)

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      doneCleanup()
    }
  }, [queryClient, user])

  return null
}


