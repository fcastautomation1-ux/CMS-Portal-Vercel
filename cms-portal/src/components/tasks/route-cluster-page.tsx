'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Building2, CheckCircle2, AlertCircle, Send } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { RouteClusterPageData } from '@/app/dashboard/tasks/actions'
import { routeHallTaskToClusterAction } from '@/app/dashboard/tasks/actions'

interface Props {
  data: RouteClusterPageData
}

export function RouteClusterPage({ data }: Props) {
  const router = useRouter()
  const [selectedCluster, setSelectedCluster] = useState<string>('')
  const [note, setNote] = useState('')
  const [loading, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = () => {
    setError(null)
    if (!selectedCluster) { setError('Please select a destination department.'); return }

    startTransition(async () => {
      const res = await routeHallTaskToClusterAction(data.task.id, selectedCluster, note.trim() || undefined)
      if (res.success) {
        setSuccess(true)
        setTimeout(() => router.push('/dashboard/tasks'), 1200)
      } else {
        setError(res.error ?? 'Something went wrong.')
      }
    })
  }

  const selectedInfo = data.availableClusters.find((c) => c.id === selectedCluster)

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Routed Successfully</h2>
          <p className="text-sm text-slate-500">
            Task sent to <span className="font-semibold text-slate-700">{selectedInfo?.name ?? 'the department'}</span>. Redirecting…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Route to Department</p>
            <h1 className="text-base font-bold text-slate-900 truncate">{data.task.title}</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Task info chip */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-violet-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500">From hall</p>
            <p className="text-sm font-semibold text-slate-800 truncate">{data.task.cluster_name}</p>
          </div>
        </div>

        {/* Cluster selection */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Select Destination Department</p>
          </div>

          {data.availableClusters.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No other departments are available for routing.</p>
              <p className="text-xs text-slate-400 mt-1">Ask an admin to link departments to this hall.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.availableClusters.map((c) => {
                const isSelected = selectedCluster === c.id
                const initials = c.name.slice(0, 2).toUpperCase()
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCluster(c.id)}
                    className={cn(
                      'w-full flex items-center gap-4 px-4 py-3.5 text-left transition-colors',
                      isSelected ? 'bg-violet-50' : 'bg-white hover:bg-slate-50'
                    )}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold text-white shadow-sm"
                      style={{ background: isSelected ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : (c.color ? `${c.color}` : '#64748b') }}
                    >
                      {initials}
                    </div>
                    <span className={cn('text-sm font-semibold flex-1', isSelected ? 'text-violet-700' : 'text-slate-700')}>
                      {c.name}
                    </span>
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
                      isSelected ? 'border-violet-500 bg-violet-500' : 'border-slate-300'
                    )}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Note */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Handoff Note <span className="normal-case font-normal text-slate-300">(optional)</span></p>
          </div>
          <div className="px-4 py-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add any context or instructions for the receiving department…"
              rows={3}
              className="w-full text-sm text-slate-700 placeholder-slate-300 bg-transparent resize-none outline-none"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 bg-white hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !selectedCluster}
            className={cn(
              'flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all',
              selectedCluster && !loading
                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            <Send className="w-4 h-4" />
            {loading ? 'Routing…' : 'Route to Department'}
          </button>
        </div>

      </div>
    </div>
  )
}
