import type { RealtimeChannel } from '@supabase/supabase-js'
import { createBrowserClient } from '@/lib/supabase/client'

type PostgresConfig = {
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  schema?: string
  table: string
  filter?: string
}

export function subscribeToPostgresChanges(
  channelName: string,
  configs: PostgresConfig[],
  onChange: () => void
) {
  const client = createBrowserClient()
  let channel: RealtimeChannel = client.channel(channelName)

  for (const config of configs) {
    channel = channel.on(
      'postgres_changes',
      {
        event: config.event ?? '*',
        schema: config.schema ?? 'public',
        table: config.table,
        filter: config.filter,
      },
      onChange
    )
  }

  channel.subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}
