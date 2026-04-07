'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import type { ComponentProps, ComponentType } from 'react'

function ChartFallback() {
  return (
    <div className="flex items-center justify-center h-[200px] w-full">
      <Loader2 className="animate-spin text-slate-400" size={20} />
    </div>
  )
}

// Lazy-load entire recharts module only when chart components are rendered.
// This keeps the ~300KB recharts bundle out of the initial page load.

export const LazyBarChart = dynamic(
  () => import('recharts').then((mod) => mod.BarChart as unknown as ComponentType<any>),
  { ssr: false, loading: ChartFallback }
) as ComponentType<ComponentProps<typeof import('recharts').BarChart>>

export const LazyPieChart = dynamic(
  () => import('recharts').then((mod) => mod.PieChart as unknown as ComponentType<any>),
  { ssr: false, loading: ChartFallback }
) as ComponentType<ComponentProps<typeof import('recharts').PieChart>>

export const LazyResponsiveContainer = dynamic(
  () => import('recharts').then((mod) => mod.ResponsiveContainer as unknown as ComponentType<any>),
  { ssr: false, loading: ChartFallback }
) as ComponentType<ComponentProps<typeof import('recharts').ResponsiveContainer>>

// Re-export non-component recharts pieces that are lightweight (just JSX elements within charts)
// These are fine to import directly since they're only used as children of the lazy-loaded chart components
export {
  Bar, XAxis, YAxis, Tooltip, Pie, Cell, CartesianGrid,
} from 'recharts'
export type { PieLabelRenderProps } from 'recharts'
