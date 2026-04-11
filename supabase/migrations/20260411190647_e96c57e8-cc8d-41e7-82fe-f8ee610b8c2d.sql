
-- 1. Prevent credits tampering via trigger
CREATE OR REPLACE FUNCTION public.prevent_credits_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits THEN
    IF current_setting('role') != 'service_role' THEN
      NEW.credits := OLD.credits;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_credits_tampering
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.prevent_credits_tampering();

-- 2. Add service_role-only policy on processed_polar_events
CREATE POLICY "Service role full access"
ON public.processed_polar_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. Create RPC to return safe settings (no raw keys)
CREATE OR REPLACE FUNCTION public.get_settings_flags(p_user_id uuid)
RETURNS TABLE(
  id uuid,
  maps_provider text,
  credits integer,
  has_pat boolean,
  has_maps_key boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    us.id,
    us.maps_provider,
    us.credits,
    (us.airtable_pat IS NOT NULL AND us.airtable_pat != '') AS has_pat,
    (us.maps_api_key IS NOT NULL AND us.maps_api_key != '') AS has_maps_key
  FROM public.user_settings us
  WHERE us.id = p_user_id;
$$;
