-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Hold User Tasks + Restrict Task Creation
-- Run this in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add "users_cannot_create_tasks" setting to cluster_settings
ALTER TABLE cluster_settings
  ADD COLUMN IF NOT EXISTS users_cannot_create_tasks BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Add hold fields to cluster_members
ALTER TABLE cluster_members
  ADD COLUMN IF NOT EXISTS is_on_hold  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS held_by     TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS held_at     TIMESTAMPTZ  DEFAULT NULL;

-- 3. Index for quickly finding held users per cluster
CREATE INDEX IF NOT EXISTS idx_cluster_members_is_on_hold
  ON cluster_members (cluster_id, is_on_hold)
  WHERE is_on_hold = TRUE;

-- 4. Ensure cluster_settings has the column in its unique constraint
--    (no change needed if cluster_id is already unique there)

-- ─────────────────────────────────────────────────────────────────────────────
-- That's it. No data migration needed — all new fields default to false/null.
-- ─────────────────────────────────────────────────────────────────────────────
