CREATE TABLE public.saved_address_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  start_address text NOT NULL CHECK (char_length(start_address) BETWEEN 1 AND 300),
  end_address text NOT NULL CHECK (char_length(end_address) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_address_pairs TO authenticated;
GRANT ALL ON public.saved_address_pairs TO service_role;
ALTER TABLE public.saved_address_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their address pairs" ON public.saved_address_pairs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX saved_address_pairs_user_idx ON public.saved_address_pairs(user_id, created_at DESC);

ALTER TABLE public.saved_mappings
  ADD COLUMN notes_col_id text,
  ADD COLUMN purpose_col_id text;

CREATE TABLE public.ai_cache (
  prompt_hash text PRIMARY KEY,
  response_text text NOT NULL,
  feature_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;