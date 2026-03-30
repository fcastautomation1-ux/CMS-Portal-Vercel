'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000,      // Increase staleTime to 5 minutes to reduce refetching
            gcTime: 30 * 60_000,        // keep in memory for 30 minutes
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,   // Reconnect is good for catching up after sleep
            refetchOnMount: false,
            retry: 1,
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
