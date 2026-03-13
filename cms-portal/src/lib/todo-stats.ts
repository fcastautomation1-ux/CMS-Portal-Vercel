import type { Todo, TodoStats } from '@/types'

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false
  return new Date(dateStr).getTime() < Date.now()
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function computeTodoStatsFromTodos(todos: Todo[]): TodoStats {
  return {
    total: todos.length,
    completed: todos.filter((t) => t.completed).length,
    pending: todos.filter((t) => !t.completed).length,
    overdue: todos.filter((t) => !t.completed && isOverdue(t.due_date)).length,
    highPriority: todos.filter((t) => !t.completed && (t.priority === 'high' || t.priority === 'urgent')).length,
    dueToday: todos.filter((t) => !t.completed && isToday(t.due_date)).length,
    shared: todos.filter((t) => t.is_shared).length,
  }
}
