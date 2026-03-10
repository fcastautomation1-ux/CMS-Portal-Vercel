import { createClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client using service_role key.
 * Bypasses RLS — only use in Server Actions / API Routes.
 */
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
