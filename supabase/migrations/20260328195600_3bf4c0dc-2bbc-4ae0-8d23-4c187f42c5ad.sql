
-- Create update_updated_at function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Table 1: user_settings
CREATE TABLE public.user_settings (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  airtable_pat TEXT,
  maps_api_key TEXT,
  maps_provider TEXT CHECK (maps_provider IN ('google', 'openrouteservice')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = id);

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table 2: calculation_logs
CREATE TABLE public.calculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  records_processed INTEGER NOT NULL,
  provider_used TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.calculation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own logs" ON public.calculation_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own logs" ON public.calculation_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Table 3: saved_mappings
CREATE TABLE public.saved_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL,
  start_col_id TEXT NOT NULL,
  end_col_id TEXT NOT NULL,
  distance_col_id TEXT NOT NULL,
  UNIQUE(user_id, table_id)
);

ALTER TABLE public.saved_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mappings" ON public.saved_mappings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own mappings" ON public.saved_mappings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own mappings" ON public.saved_mappings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own mappings" ON public.saved_mappings FOR DELETE USING (auth.uid() = user_id);
