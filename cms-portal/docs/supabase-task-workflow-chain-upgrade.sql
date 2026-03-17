-- Task workflow + staged approval chain upgrade
-- Run in Supabase SQL editor.

alter table public.todos
  add column if not exists workflow_state text,
  add column if not exists pending_approver text,
  add column if not exists approval_chain jsonb not null default '[]'::jsonb,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_sla_due_at timestamptz,
  add column if not exists last_handoff_at timestamptz;

-- Backfill workflow_state for existing rows.
update public.todos
set workflow_state = case
  when completed = true then 'final_approved'
  when approval_status = 'pending_approval' then 'submitted_for_approval'
  when queue_status = 'queued' then 'queued_department'
  when task_status = 'in_progress' then 'in_progress'
  when assigned_to is not null then 'claimed_by_department'
  else 'claimed_by_department'
end
where workflow_state is null;

-- Backfill pending approver for existing pending approval tasks.
update public.todos
set pending_approver = coalesce(pending_approver, username),
    approval_requested_at = coalesce(approval_requested_at, updated_at)
where approval_status = 'pending_approval';

create index if not exists idx_todos_pending_approver
  on public.todos (pending_approver)
  where approval_status = 'pending_approval';

create index if not exists idx_todos_workflow_state
  on public.todos (workflow_state);

create index if not exists idx_todos_approval_sla_due_at
  on public.todos (approval_sla_due_at)
  where approval_status = 'pending_approval';
