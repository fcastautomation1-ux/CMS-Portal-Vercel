-- ============================================================
-- Migration: Password Reset Tokens
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    text NOT NULL REFERENCES public.users(username) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Index for fast token lookup (used on every password reset click)
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
  ON public.password_reset_tokens (token);

-- 3. Index for rate-limit check (count recent tokens by username)
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_username_created
  ON public.password_reset_tokens (username, created_at);

-- 4. Row Level Security — only service_role can read/write (no public access)
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Drop policies if re-running migration
DROP POLICY IF EXISTS "No public access" ON public.password_reset_tokens;

CREATE POLICY "No public access"
  ON public.password_reset_tokens
  FOR ALL
  TO authenticated, anon
  USING (false);

-- 5. Auto-cleanup: delete used or expired tokens older than 24h (optional scheduled job)
-- You can run this manually or schedule it via pg_cron:
-- DELETE FROM public.password_reset_tokens WHERE used = true OR expires_at < now() - interval '24 hours';
