'use client'

import { useEffect } from 'react'

/**
 * Core Web Vitals monitoring — tracks LCP, CLS, and INP (replaced FID March 2024).
 * Reports to /api/vitals in production only.
 */
function sendVital(metric: string, value: number) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug(`[WebVitals] ${metric}:`, Math.round(value), 'ms')
    return
  }
  // Fire-and-forget — non-critical path
  navigator.sendBeacon(
    '/api/vitals',
    JSON.stringify({ metric, value: Math.round(value), timestamp: Date.now(), url: location.pathname }),
  )
}

export function WebVitals() {
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return

    const observers: PerformanceObserver[] = []

    // --- Largest Contentful Paint (LCP) ---
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number }
        sendVital('LCP', last.startTime)
      })
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true })
      observers.push(lcpObs)
    } catch {
      // browser may not support this entry type
    }

    // --- Cumulative Layout Shift (CLS) ---
    try {
      let clsValue = 0
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { hadRecentInput: boolean; value: number }
          if (!e.hadRecentInput) clsValue += e.value
        }
        sendVital('CLS', clsValue * 1000) // normalise to ms-scale for consistency
      })
      clsObs.observe({ type: 'layout-shift', buffered: true })
      observers.push(clsObs)
    } catch {
      // ignore
    }

    // --- Interaction to Next Paint (INP) ---
    try {
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { processingEnd: number; processingStart: number; duration: number }
          // Use duration for a full measure; fall back to processing delta
          const inp = e.duration ?? e.processingEnd - e.processingStart
          if (inp > 0) sendVital('INP', inp)
        }
      })
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
      observers.push(inpObs)
    } catch {
      // ignore
    }

    return () => observers.forEach((obs) => obs.disconnect())
  }, [])

  return null
}
