'use client'

import { cn } from '@/lib/cn'

export function TaskSkeleton({ count = 5, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={cn('space-y-4', compact ? 'flex gap-3 overflow-x-auto p-1' : '')}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'relative overflow-hidden rounded-[22px] border border-[#eef2f8] bg-white p-5 shadow-sm',
            compact ? 'w-72 flex-none shrink-0' : 'w-full'
          )}
        >
          {/* Shimmer effect overlay */}
          <div className="absolute inset-0 z-0 animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-32 rounded-lg bg-slate-100" />
                <div className="h-5 w-16 rounded-full bg-slate-50" />
              </div>
              <div className="h-4 w-3/4 rounded-lg bg-slate-50" />
              <div className="flex items-center gap-4 pt-1">
                <div className="h-6 w-24 rounded-full bg-slate-50" />
                <div className="h-6 w-24 rounded-full bg-slate-50" />
              </div>
            </div>
            {!compact && (
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="h-8 w-8 rounded-full bg-slate-100" />
                <div className="h-4 w-20 rounded-lg bg-slate-50" />
              </div>
            )}
          </div>
          
          <div className="relative z-10 mt-4 flex items-center justify-between border-t border-slate-50 pt-4">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-slate-100" />
              <div className="h-4 w-24 rounded-lg bg-slate-50" />
            </div>
            <div className="h-6 w-20 rounded-lg bg-slate-100/50" />
          </div>
        </div>
      ))}
      
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

export function KanbanSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="w-72 flex-none">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="h-5 w-24 rounded-lg bg-slate-100" />
            <div className="h-5 w-8 rounded-full bg-slate-50" />
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-2">
            <TaskSkeleton count={3} compact />
          </div>
        </div>
      ))}
    </div>
  )
}
