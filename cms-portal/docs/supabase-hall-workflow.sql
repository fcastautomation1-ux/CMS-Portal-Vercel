-- ============================================================
-- Hall-Based Task Workflow Extension
-- Run in Supabase SQL Editor after supabase-clusters.sql
-- ============================================================

-- 1. Cluster-level settings (one row per cluster)
--    allow_dept_users_see_queue:
--      false (default) → only managers/supervisors/owners see dept queue
--      true            → regular dept members can also see dept queue tasks
--    allow_normal_users_see_queue:
--      true  (default) → dept users see queue (when allow_dept_users_see_queue = true)
--      false           → only Managers/Supervisors/Admins see queue even if above is true
create table if not exists public.cluster_settings (
  id                            uuid        primary key default gen_random_uuid(),
  cluster_id                    uuid        not null references public.clusters(id) on delete cascade,
  allow_dept_users_see_queue    boolean     not null default false,
  allow_normal_users_see_queue  boolean     not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (cluster_id)
);

-- Migration: add allow_normal_users_see_queue column to existing tables
alter table public.cluster_settings
  add column if not exists allow_normal_users_see_queue boolean not null default true;

-- 2. RLS
alter table public.cluster_settings enable row level security;
create policy "cluster_settings_all" on public.cluster_settings for all using (true);

-- 3. Index
create index if not exists cluster_settings_cluster_idx
  on public.cluster_settings (cluster_id);

-- 4. Extend todos workflow_state to include 'queued_cluster'
--    (workflow_state is a plain text column — no enum constraint — so no ALTER needed.
--     This comment documents the new accepted value for reference.)
-- workflow_state = 'queued_cluster' means the task is sitting in a Hall (cluster) inbox queue,
-- waiting for a cluster manager/supervisor/owner to claim or route it to a department.

-- 5. Ensure cluster_inbox / cluster_origin_id / cluster_routed_by columns exist
--    (safe no-op if supabase-clusters.sql has already been run)
alter table public.todos
  add column if not exists cluster_id         uuid    null references public.clusters(id) on delete set null,
  add column if not exists cluster_inbox      boolean not null default false,
  add column if not exists cluster_origin_id  uuid    null references public.clusters(id) on delete set null,
  add column if not exists cluster_routed_by  text    null references public.users(username) on delete set null;

-- 6. Additional index for dept-queue / cluster visibility join
create index if not exists todos_cluster_queue_idx
  on public.todos (cluster_id, cluster_inbox, queue_status)
  where cluster_id is not null;
