-- ============================================================
-- Hall Scheduler: Schema Extension
-- Run this AFTER supabase-hall-workflow.sql.
-- Extends todos, cluster_settings, and creates hall_task_work_logs.
-- All additions are safe (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ── 1. Extend todos with scheduler columns ───────────────────────────────────

ALTER TABLE public.todos
  -- Sender's explicitly requested deadline when routing cross-hall.
  -- Distinguished from effective_due_at which is calculated from work estimate.
  ADD COLUMN IF NOT EXISTS requested_due_at        timestamptz,

  -- System-calculated finish datetime based on estimated_work_minutes
  -- and valid office hours. Recalculated whenever active_started_at is set.
  ADD COLUMN IF NOT EXISTS effective_due_at         timestamptz,

  -- Estimated work minutes entered by hall manager/supervisor during assignment.
  -- This is the total estimated effort; NOT the same as the sender due date.
  ADD COLUMN IF NOT EXISTS estimated_work_minutes   integer,

  -- Remaining work minutes (as of the last pause/block event).
  -- Real-time remaining = remaining_work_minutes - work_minutes_since(active_started_at).
  -- Decrements only deducted at pause / block / complete transitions.
  ADD COLUMN IF NOT EXISTS remaining_work_minutes   integer,

  -- Running total of minutes actually worked (audit).
  ADD COLUMN IF NOT EXISTS total_active_minutes     integer  DEFAULT 0,

  -- Timestamp when the task most recently became 'active'.
  -- Cleared (set to NULL) when paused / blocked / completed.
  ADD COLUMN IF NOT EXISTS active_started_at        timestamptz,

  -- Optional reason when task is paused.
  ADD COLUMN IF NOT EXISTS pause_reason             text,

  -- Required reason when task is in 'blocked' state.
  ADD COLUMN IF NOT EXISTS blocked_reason           text,

  -- Position of this task within the user's personal queue in this hall.
  -- Lower number = higher priority.  Active task is typically rank 1.
  ADD COLUMN IF NOT EXISTS queue_rank               integer,

  -- Fine-grained scheduler state for hall-managed tasks:
  --   hall_inbox   | hall_queue | user_queue | active
  --   paused       | blocked    | waiting_review | completed
  ADD COLUMN IF NOT EXISTS scheduler_state          text;

-- ── 2. Work-log table — immutable audit trail of all state transitions ───────

CREATE TABLE IF NOT EXISTS public.hall_task_work_logs (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  todo_id          uuid        NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  username         text        NOT NULL,
  -- started | paused | resumed | blocked | unblocked | completed | assigned
  -- reassigned | reordered | setting_enforced
  event            text        NOT NULL,
  -- Work minutes deducted from remaining_work_minutes at this event.
  minutes_deducted integer     DEFAULT 0,
  notes            text,
  -- Arbitrary JSON for extra context (e.g. { from_rank, to_rank }).
  metadata         jsonb,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hall_work_logs_todo_id   ON public.hall_task_work_logs (todo_id);
CREATE INDEX IF NOT EXISTS idx_hall_work_logs_username  ON public.hall_task_work_logs (username);
CREATE INDEX IF NOT EXISTS idx_hall_work_logs_created   ON public.hall_task_work_logs (created_at DESC);

-- RLS: same permissive pattern as other cluster tables
ALTER TABLE public.hall_task_work_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hall_task_work_logs' AND policyname = 'hall_work_logs_all'
  ) THEN
    CREATE POLICY "hall_work_logs_all" ON public.hall_task_work_logs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 3. Extend cluster_settings with scheduler behaviour flags ────────────────

ALTER TABLE public.cluster_settings
  -- When ON: a user may only have ONE active task at a time in this hall.
  -- All other assigned tasks are queued and auto-start when the active one finishes.
  ADD COLUMN IF NOT EXISTS single_active_task_per_user  boolean DEFAULT false,

  -- When ON (requires single_active_task_per_user): the next highest-queued task
  -- is automatically activated when the current active task completes.
  ADD COLUMN IF NOT EXISTS auto_start_next_task          boolean DEFAULT true,

  -- When ON: users must supply a text reason when pausing a task.
  ADD COLUMN IF NOT EXISTS require_pause_reason          boolean DEFAULT false;

-- ── 4. Performance indexes for scheduler access patterns ────────────────────

CREATE INDEX IF NOT EXISTS idx_todos_scheduler_state
  ON public.todos (scheduler_state)
  WHERE scheduler_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_todos_active_user
  ON public.todos (assigned_to, scheduler_state, queue_rank)
  WHERE scheduler_state IN ('active', 'user_queue', 'paused', 'blocked');

CREATE INDEX IF NOT EXISTS idx_todos_hall_scheduler
  ON public.todos (cluster_id, scheduler_state)
  WHERE cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_todos_queue_rank
  ON public.todos (assigned_to, queue_rank)
  WHERE queue_rank IS NOT NULL;

-- ── 5. Back-fill requested_due_at from existing cross-hall tasks ─────────────
-- For tasks already in a cluster inbox, copy due_date → requested_due_at
-- so older tasks gain the new semantics without breaking anything.

UPDATE public.todos
SET    requested_due_at = due_date
WHERE  cluster_inbox  = true
  AND  requested_due_at IS NULL
  AND  due_date         IS NOT NULL;

-- ── 6. Back-fill scheduler_state for existing cluster inbox tasks ────────────

UPDATE public.todos
SET    scheduler_state = 'hall_inbox'
WHERE  cluster_inbox  = true
  AND  scheduler_state IS NULL;

-- ── Done ─────────────────────────────────────────────────────────────────────
-- This migration is idempotent. Running it twice is safe.
