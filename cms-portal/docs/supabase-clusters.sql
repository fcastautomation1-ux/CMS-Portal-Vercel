-- ============================================================
-- Cluster System Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Clusters table (one cluster = one hall/realm)
create table if not exists public.clusters (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  description text        null,
  color       text        not null default '#2B7FFF',
  created_by  text        null references public.users(username) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Cluster <-> Department mapping (many-to-many)
create table if not exists public.cluster_departments (
  id            uuid        primary key default gen_random_uuid(),
  cluster_id    uuid        not null references public.clusters(id) on delete cascade,
  department_id uuid        not null references public.departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique(cluster_id, department_id)
);

-- 3. Cluster members — who belongs to a cluster and what role they have inside it
--    cluster_role: 'owner' | 'manager' | 'supervisor' | 'member'
--    scoped_departments: JSON array of department names (for supervisors — the depts they manage)
create table if not exists public.cluster_members (
  id                   uuid        primary key default gen_random_uuid(),
  cluster_id           uuid        not null references public.clusters(id) on delete cascade,
  username             text        not null references public.users(username) on delete cascade,
  cluster_role         text        not null default 'member' check (cluster_role in ('owner','manager','supervisor','member')),
  scoped_departments   jsonb       null,   -- e.g. ["Development","QA","UI"] for a supervisor
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique(cluster_id, username)
);

-- 4. Add cluster columns to todos
--    cluster_id         : which cluster owns this task (null = non-clustered, standard flow)
--    cluster_inbox      : true when task arrived via cross-cluster routing (sits in inbox)
--    cluster_origin_id  : source cluster id when cross-cluster (so it can return home)
--    cluster_routed_by  : username of person who sent it cross-cluster
alter table public.todos
  add column if not exists cluster_id         uuid    null references public.clusters(id) on delete set null,
  add column if not exists cluster_inbox      boolean not null default false,
  add column if not exists cluster_origin_id  uuid    null references public.clusters(id) on delete set null,
  add column if not exists cluster_routed_by  text    null references public.users(username) on delete set null;

-- 5. Indexes for performance
create index if not exists clusters_name_idx
  on public.clusters (name);

create index if not exists cluster_departments_cluster_idx
  on public.cluster_departments (cluster_id);

create index if not exists cluster_departments_dept_idx
  on public.cluster_departments (department_id);

create index if not exists cluster_members_cluster_idx
  on public.cluster_members (cluster_id);

create index if not exists cluster_members_username_idx
  on public.cluster_members (username);

create index if not exists todos_cluster_id_idx
  on public.todos (cluster_id) where cluster_id is not null;

create index if not exists todos_cluster_inbox_idx
  on public.todos (cluster_id, cluster_inbox) where cluster_inbox = true;

-- 6. RLS Policies (if RLS is enabled on your project)
-- Clusters visible to all authenticated users
alter table public.clusters enable row level security;
create policy "clusters_select" on public.clusters for select using (true);
create policy "clusters_insert" on public.clusters for insert with check (true);
create policy "clusters_update" on public.clusters for update using (true);
create policy "clusters_delete" on public.clusters for delete using (true);

alter table public.cluster_departments enable row level security;
create policy "cluster_departments_all" on public.cluster_departments for all using (true);

alter table public.cluster_members enable row level security;
create policy "cluster_members_all" on public.cluster_members for all using (true);
