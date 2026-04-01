-- Task and notification performance indexes for CMS Portal
-- Run in Supabase SQL Editor.

create extension if not exists pg_trgm;

create index if not exists idx_todos_archived_created_at
  on public.todos (archived, created_at desc);

create index if not exists idx_todos_username_archived
  on public.todos (username, archived);

create index if not exists idx_todos_assigned_to_archived
  on public.todos (assigned_to, archived);

create index if not exists idx_todos_completed_by_archived
  on public.todos (completed_by, archived);

create index if not exists idx_todos_pending_approver_archived
  on public.todos (pending_approver, archived);

create index if not exists idx_todos_queue_status_assigned_archived
  on public.todos (queue_status, assigned_to, archived);

create index if not exists idx_todos_archived_due_date
  on public.todos (archived, due_date);

create index if not exists idx_todos_queue_status_department
  on public.todos (queue_status, queue_department);

create index if not exists idx_todos_manager_id_trgm
  on public.todos using gin (manager_id gin_trgm_ops);

create index if not exists idx_todo_shares_shared_with_todo_id
  on public.todo_shares (shared_with, todo_id);

create index if not exists idx_todo_attachments_todo_id_created_at
  on public.todo_attachments (todo_id, created_at desc);

create index if not exists idx_notifications_user_id_created_at
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_id_read
  on public.notifications (user_id, read);

create index if not exists idx_users_username
  on public.users (username);

create index if not exists idx_users_manager_id
  on public.users (manager_id);

-- ── JSONB GIN indexes — required for .contains() queries ─────────────────────
-- Without these, every .contains('multi_assignment', ...) or
-- .contains('assignment_chain', ...) does a full sequential table scan.
-- These are the most critical missing indexes for production under concurrent load.

create index if not exists idx_todos_multi_assignment_gin
  on public.todos using gin (multi_assignment);

create index if not exists idx_todos_assignment_chain_gin
  on public.todos using gin (assignment_chain);

create index if not exists idx_todos_approval_chain_gin
  on public.todos using gin (approval_chain);

-- ── Partial indexes — fast lookups for hot query patterns ────────────────────

-- Cluster inbox: used in getTodos cluster inbox query
create index if not exists idx_todos_cluster_inbox_cluster_id
  on public.todos (cluster_inbox, cluster_id)
  where cluster_inbox = true;

-- Queued tasks with no assignee: used in dept queue lookups
create index if not exists idx_todos_queued_no_assignee
  on public.todos (queue_status, queue_department, archived)
  where queue_status = 'queued' and (assigned_to is null or assigned_to = '');

-- Active (non-archived) tasks by updated_at: helps getTeamTodos MA date-range filter
create index if not exists idx_todos_archived_updated_at
  on public.todos (archived, updated_at desc)
  where archived = false;

-- ── Cluster members lookup ────────────────────────────────────────────────────
-- Used in getTodos cluster inbox section — cluster_role filter was missing an index

create index if not exists idx_cluster_members_username_role
  on public.cluster_members (username, cluster_role);

-- ── Composite index for manager_id + archived (complements the trigram index) ──
-- The existing trigram idx_todos_manager_id_trgm handles ILIKE.
-- This btree index helps the eq('archived', false) predicate narrow results faster.
create index if not exists idx_todos_manager_id_archived
  on public.todos (manager_id, archived)
  where archived = false;
