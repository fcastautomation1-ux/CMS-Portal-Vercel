-- Task and notification performance indexes for CMS Portal
-- Run in Supabase SQL Editor.

create index if not exists idx_todos_archived_created_at
  on public.todos (archived, created_at desc);

create index if not exists idx_todos_username_archived
  on public.todos (username, archived);

create index if not exists idx_todos_assigned_to_archived
  on public.todos (assigned_to, archived);

create index if not exists idx_todos_completed_by_archived
  on public.todos (completed_by, archived);

create index if not exists idx_todos_queue_status_department
  on public.todos (queue_status, queue_department);

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
