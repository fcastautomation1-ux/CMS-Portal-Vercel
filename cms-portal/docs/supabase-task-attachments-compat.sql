-- Task attachment storage migration for Supabase Storage
-- Use this if attachments are now stored in a Supabase Storage bucket
-- instead of the old Drive-style column usage.

-- 1) Primary bucket path column for new portal uploads.
ALTER TABLE public.todo_attachments
ADD COLUMN IF NOT EXISTS storage_path text;

-- 2) Legacy compatibility column for older code paths only.
ALTER TABLE public.todo_attachments
ADD COLUMN IF NOT EXISTS drive_file_id text;

-- 2.1) Optional mime type metadata used by current portal uploads.
ALTER TABLE public.todo_attachments
ADD COLUMN IF NOT EXISTS mime_type text;

-- 3) Backfill storage_path only for bucket-style paths.
-- Priority:
--   a) existing storage_path
--   b) old drive_file_id when it already looks like a bucket path
--   c) file_url when it contains a bucket path instead of an http URL
UPDATE public.todo_attachments
SET storage_path = COALESCE(
  NULLIF(storage_path, ''),
  CASE
    WHEN drive_file_id IS NOT NULL AND drive_file_id LIKE '%/%' THEN drive_file_id
    ELSE NULL
  END,
  CASE
    WHEN file_url IS NOT NULL AND file_url !~* '^https?://' AND file_url LIKE '%/%' THEN file_url
    ELSE NULL
  END
)
WHERE storage_path IS NULL OR storage_path = '';

-- 4) Preserve old Drive-based attachments.
-- If an old row only has a Drive file id and no usable http URL,
-- create a direct Drive download/view URL so the new portal can still open it.
UPDATE public.todo_attachments
SET file_url = 'https://drive.google.com/uc?id=' || drive_file_id
WHERE (file_url IS NULL OR file_url = '')
  AND drive_file_id IS NOT NULL
  AND drive_file_id <> ''
  AND drive_file_id NOT LIKE '%/%';

-- 5) Keep drive_file_id in sync for older deployments that still read it,
-- but only for bucket-backed files.
UPDATE public.todo_attachments
SET drive_file_id = storage_path
WHERE (drive_file_id IS NULL OR drive_file_id = '')
  AND storage_path IS NOT NULL
  AND storage_path <> '';

-- 6) Optional index for faster task attachment lookups.
CREATE INDEX IF NOT EXISTS idx_todo_attachments_todo_id
ON public.todo_attachments (todo_id);

-- 7) Verify final structure and sample data.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'todo_attachments'
ORDER BY ordinal_position;

SELECT
  COUNT(*) AS total_attachments,
  COUNT(*) FILTER (WHERE storage_path IS NOT NULL AND storage_path <> '') AS bucket_backed_attachments,
  COUNT(*) FILTER (
    WHERE drive_file_id IS NOT NULL
      AND drive_file_id <> ''
      AND drive_file_id NOT LIKE '%/%'
  ) AS legacy_drive_attachments,
  COUNT(*) FILTER (WHERE file_url ILIKE 'https://drive.google.com/%') AS drive_url_attachments
FROM public.todo_attachments;

SELECT id, todo_id, file_name, file_url, storage_path, drive_file_id
FROM public.todo_attachments
ORDER BY created_at DESC
LIMIT 20;
