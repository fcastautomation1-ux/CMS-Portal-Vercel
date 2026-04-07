import { createClient, type SupabaseClient } from '@supabase/supabase-js'

declare global {
  // eslint-disable-next-line no-var
  var _supabaseServerClient: SupabaseClient | undefined
}

/**
 * Server-side Supabase client using service_role key.
 * Bypasses RLS — only use in Server Actions / API Routes.
 * Uses globalThis singleton to reuse connection across requests in dev & production.
 */
export function createServerClient(): SupabaseClient {
  if (globalThis._supabaseServerClient) return globalThis._supabaseServerClient
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  globalThis._supabaseServerClient = client
  return client
}
