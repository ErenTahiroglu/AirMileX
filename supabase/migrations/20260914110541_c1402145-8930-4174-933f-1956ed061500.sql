ALTER TABLE public.saved_mappings
  ADD COLUMN IF NOT EXISTS status_col_id text;