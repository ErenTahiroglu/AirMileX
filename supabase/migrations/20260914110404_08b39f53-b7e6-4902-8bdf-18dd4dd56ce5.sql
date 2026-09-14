ALTER TABLE public.saved_mappings
  ADD COLUMN IF NOT EXISTS cost_col_id text,
  ADD COLUMN IF NOT EXISTS rate_per_unit numeric NOT NULL DEFAULT 0.76,
  ADD COLUMN IF NOT EXISTS rate_unit text NOT NULL DEFAULT 'mi';

ALTER TABLE public.saved_mappings
  ADD CONSTRAINT saved_mappings_rate_unit_check CHECK (rate_unit IN ('mi','km'));

ALTER TABLE public.saved_mappings
  ADD CONSTRAINT saved_mappings_rate_per_unit_check CHECK (rate_per_unit >= 0);