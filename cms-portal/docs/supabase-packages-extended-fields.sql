-- Align the `packages` table with the fields used by the Package Management UI.
-- Run this in the Supabase SQL editor for the project that backs this app.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS app_name TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS playconsole_account TEXT,
  ADD COLUMN IF NOT EXISTS marketer TEXT,
  ADD COLUMN IF NOT EXISTS product_owner TEXT,
  ADD COLUMN IF NOT EXISTS monetization TEXT,
  ADD COLUMN IF NOT EXISTS admob TEXT;

-- Optional but recommended if you want package records to reflect edits.
ALTER TABLE public.packages
  ALTER COLUMN updated_at SET DEFAULT now();

