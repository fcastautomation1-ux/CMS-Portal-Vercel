import { cn } from '@/lib/cn'

type Status = 'Pending' | 'Running' | 'Success' | 'Error' | string

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  Pending:  { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8', label: 'Pending' },
  Running:  { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B', label: 'Running' },
  Success:  { bg: '#ECFDF5', text: '#065F46', dot: '#10B981', label: 'Success' },
  Error:    { bg: '#FEF2F2', text: '#991B1B', dot: '#EF4444', label: 'Error' },
}

const WORKFLOW_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  'workflow-0': { bg: '#F1F5F9', text: '#475569', label: 'W0 · Default' },
  'workflow-1': { bg: '#EFF6FF', text: '#1D4ED8', label: 'W1' },
  'workflow-2': { bg: '#F5F3FF', text: '#6D28D9', label: 'W2' },
  'workflow-3': { bg: '#FFF7ED', text: '#C2410C', label: 'W3' },
}

interface StatusBadgeProps {
  status: Status
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.Pending
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full', className)}
      style={{ background: config.bg, color: config.text }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: config.dot }}
      />
      {config.label}
    </span>
  )
}

interface WorkflowBadgeProps {
  workflow: string
  className?: string
}

export function WorkflowBadge({ workflow, className }: WorkflowBadgeProps) {
  const config = WORKFLOW_CONFIG[workflow] ?? WORKFLOW_CONFIG['workflow-0']
  return (
    <span
      className={cn('inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full', className)}
      style={{ background: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  )
}
