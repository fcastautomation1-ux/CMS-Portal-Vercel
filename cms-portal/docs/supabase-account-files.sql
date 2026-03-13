create table if not exists public.account_files (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts(customer_id) on delete cascade,
  file_name text not null,
  file_size bigint null,
  mime_type text null,
  storage_path text not null,
  uploaded_by text not null references public.users(username) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists account_files_account_id_idx
  on public.account_files (account_id, created_at desc);
