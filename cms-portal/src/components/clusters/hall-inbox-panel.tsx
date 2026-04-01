'use client'

import { useState, useCallback } from 'react'
import { Inbox, RefreshCw, ArrowRight, Clock, User, Package } from 'lucide-react'
import type { Todo, ClusterSettings } from '@/types'
import { formatPakistanDateTime } from '@/lib/pakistan-time'
import { AssignHallTaskModal } from './assign-hall-task-modal'
import { claimClusterInboxTaskAction } from '@/app/dashboard/tasks/actions'

interface UserOption {
  username: string
  role: string
  department: string | null
  avatar_data: string | null
}

interface HallInboxPanelProps {
  /** Initial inbox tasks — can be refreshed */
  initialTasks: Todo[]
  hallSettings: ClusterSettings
  hallUsers: UserOption[]
  clusterId: string
  clusterName: string
  currentUserClusterRole: 'owner' | 'manager' | 'supervisor'
  /** Scoped departments for supervisor callers */
  supervisorScopedDepts?: string[] | null
  /** Reload callback */
  onRefresh: () => void
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

export function HallInboxPanel({
  initialTasks,
  hallSettings,
  hallUsers,
  clusterId: _clusterId,
  clusterName,
  currentUserClusterRole,
  supervisorScopedDepts,
  onRefresh,
}: HallInboxPanelProps) {
  const [tasks, setTasks]     = useState<Todo[]>(initialTasks)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [assignModal, setAssignModal]   = useState<Todo | null>(null)

  const refresh = useCallback(() => {
    onRefresh()
  }, [onRefresh])

  async function handleClaim(task: Todo) {
    setActivatingId(task.id)
    const res = await claimClusterInboxTaskAction(task.id)
    setActivatingId(null)
    if (res.success) {
      setTasks((prev) => prev.filter((t) => t.id !== task.id))
    } else {
      alert(res.error ?? 'Failed to claim task.')
    }
  }

  function handleAssignSuccess() {
    setAssignModal(null)
    setTasks((prev) => assignModal ? prev.filter((t) => t.id !== assignModal.id) : prev)
    refresh()
  }

  // Only manager/owner can use full assign-with-scheduler; supervisor can only assign to scoped depts
  const canAssignWithScheduler = ['owner', 'manager', 'supervisor'].includes(currentUserClusterRole)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-blue-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {clusterName} Inbox
          </h3>
          {tasks.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-medium">
              {tasks.length}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center px-6">
          <Inbox className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Inbox is empty</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Tasks sent to {clusterName} will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {tasks.map((task) => {
            const requestedDue = task.requested_due_at ?? task.due_date
            return (
              <li key={task.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium}`}>
                        {task.priority}
                      </span>
                      {task.package_name && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Package className="h-3 w-3" />
                          {task.package_name.split(',')[0].trim()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2">
                      {task.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        From: {task.cluster_routed_by ?? task.username}
                      </span>
                      {requestedDue && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Due: {formatPakistanDateTime(requestedDue)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {canAssignWithScheduler ? (
                      <button
                        onClick={() => setAssignModal(task)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Assign
                      </button>
                    ) : (
                      <button
                        onClick={() => handleClaim(task)}
                        disabled={activatingId === task.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-900 dark:bg-gray-200 dark:hover:bg-white text-white dark:text-gray-900 text-xs font-medium transition-colors disabled:opacity-60"
                      >
                        {activatingId === task.id ? 'Claiming…' : 'Claim'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Assign modal */}
      {assignModal && (
        <AssignHallTaskModal
          task={assignModal}
          users={hallUsers}
          hallSettings={hallSettings}
          supervisorScopedDepts={supervisorScopedDepts}
          onClose={() => setAssignModal(null)}
          onSuccess={handleAssignSuccess}
        />
      )}
    </div>
  )
}
