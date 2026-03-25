export const queryKeys = {
  notifications: (username: string) => ['notifications', username] as const,
  notificationCount: (username: string) => ['notifications', username, 'count'] as const,
  tasks: (username: string) => ['tasks', username] as const,
  taskStats: (username: string) => ['tasks', username, 'stats'] as const,
  taskSidebarCounts: (username: string) => ['tasks', username, 'sidebar-counts'] as const,
  taskDetail: (taskId: string) => ['tasks', taskId, 'detail'] as const,
  teamStats: (username: string) => ['team', username, 'stats'] as const,
}
