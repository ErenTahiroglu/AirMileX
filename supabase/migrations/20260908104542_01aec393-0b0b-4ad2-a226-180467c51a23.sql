ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS has_pat boolean
    GENERATED ALWAYS AS (airtable_pat IS NOT NULL AND airtable_pat <> '') STORED,
  ADD COLUMN IF NOT EXISTS has_maps_key boolean
    GENERATED ALWAYS AS (maps_api_key IS NOT NULL AND maps_api_key <> '') STORED;

GRANT SELECT (id, maps_provider, credits, created_at, updated_at, has_pat, has_maps_key)
  ON public.user_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.get_settings_flags(p_user_id uuid)
RETURNS TABLE(id uuid, maps_provider text, credits integer, has_pat boolean, has_maps_key boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT us.id, us.maps_provider, us.credits, us.has_pat, us.has_maps_key
  FROM public.user_settings us
  WHERE us.id = p_user_id
    AND us.id = auth.uid();
$function$;