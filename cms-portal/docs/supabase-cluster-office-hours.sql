-- ============================================================
-- Cluster Office Hours Migration
-- Adds per-hall office timing support:
--   - Mon-Thu: office_start / office_end / break_start / break_end
--   - Friday:  friday_break_start / friday_break_end (Jumu'ah / longer break)
-- All times stored as 'HH:MM' text in Pakistan Standard Time (PKT)
-- Run this in Supabase SQL Editor
-- ============================================================

alter table public.clusters
  add column if not exists office_start          text not null default '09:00',
  add column if not exists office_end            text not null default '18:00',
  add column if not exists break_start           text not null default '13:00',
  add column if not exists break_end             text not null default '14:00',
  add column if not exists friday_break_start    text not null default '12:30',
  add column if not exists friday_break_end      text not null default '14:30';

-- Verify
select id, name, office_start, office_end, break_start, break_end, friday_break_start, friday_break_end
from public.clusters
order by name;
