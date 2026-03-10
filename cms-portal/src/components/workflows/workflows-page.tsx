'use client'

import { useState } from 'react'
import { GitBranch, ToggleLeft, ToggleRight, Clock, Activity } from 'lucide-react'
import { toggleWorkflow } from '@/app/dashboard/workflows/actions'
import type { Workflow, SessionUser } from '@/types'

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

interface Props { workflows: Workflow[]; user: SessionUser }

export function WorkflowsPage({ workflows: initial, user }: Props) {
  const canEdit = ['Admin', 'Super Manager', 'Manager'].includes(user.role)
  const [workflows, setWorkflows] = useState(initial)
  const [toggling, setToggling] = useState<string | null>(null)

  async function handleToggle(wf: Workflow) {
    setToggling(wf.workflow_name)
    const res = await toggleWorkflow(wf.workflow_name, !wf.enabled)
    if (res.success) setWorkflows(prev => prev.map(w => w.workflow_name === wf.workflow_name ? { ...w, enabled: !w.enabled } : w))
    setToggling(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--slate-900)' }}>Workflows</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--slate-500)' }}>{workflows.length} workflows configured</p>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="card p-12 text-center">
          <GitBranch size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium" style={{ color: 'var(--slate-500)' }}>No workflows found</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--slate-100)' }}>
                {['Workflow', 'Description', 'Schedule', 'Last Run', 'Enabled'].map(h => (
                  <th key={h} className="text-left px-5 py-3 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--slate-400)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workflows.map(wf => (
                <tr key={wf.workflow_name} className="hover:bg-blue-50/30 transition-colors" style={{ borderBottom: '1px solid var(--slate-50)' }}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: wf.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(148,163,184,0.1)' }}>
                        <Activity size={16} style={{ color: wf.enabled ? '#22C55E' : '#94A3B8' }} />
                      </div>
                      <span className="font-medium" style={{ color: 'var(--slate-900)' }}>{wf.workflow_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--slate-600)' }}>{wf.description || '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--slate-500)' }}>
                      <Clock size={12} /> {wf.schedule || '—'}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: 'var(--slate-500)' }}>{formatRelativeTime(wf.last_run)}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => canEdit && handleToggle(wf)} disabled={toggling === wf.workflow_name || !canEdit} className="inline-flex">
                      {wf.enabled ? <ToggleRight size={28} className="text-blue-600" /> : <ToggleLeft size={28} className="text-slate-300" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
