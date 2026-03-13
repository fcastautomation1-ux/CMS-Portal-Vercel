'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

export function DeploymentWatcher() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const initialVersionRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        const data = (await res.json()) as { version?: string }
        if (!data.version) return

        if (!initialVersionRef.current) {
          initialVersionRef.current = data.version
          return
        }

        if (data.version !== initialVersionRef.current && !cancelled) {
          setUpdateAvailable(true)
        }
      } catch {}
    }

    void checkVersion()
    const id = window.setInterval(checkVersion, 60000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-4 right-4 z-[70] max-w-sm rounded-2xl border border-blue-200 bg-white px-4 py-3 shadow-[0_18px_40px_rgba(37,99,235,0.16)]">
      <p className="text-sm font-semibold text-slate-800">New portal update is available.</p>
      <p className="mt-1 text-xs text-slate-500">Refresh once to get the latest deployment.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn-motion mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        <RefreshCw size={14} />
        Refresh now
      </button>
    </div>
  )
}
