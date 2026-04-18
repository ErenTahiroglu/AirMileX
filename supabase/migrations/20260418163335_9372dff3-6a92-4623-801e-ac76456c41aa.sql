-- Fix 1: Add ownership assertion to get_settings_flags
CREATE OR REPLACE FUNCTION public.get_settings_flags(p_user_id uuid)
 RETURNS TABLE(id uuid, maps_provider text, credits integer, has_pat boolean, has_maps_key boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    us.id,
    us.maps_provider,
    us.credits,
    (us.airtable_pat IS NOT NULL AND us.airtable_pat != '') AS has_pat,
    (us.maps_api_key IS NOT NULL AND us.maps_api_key != '') AS has_maps_key
  FROM public.user_settings us
  WHERE us.id = p_user_id
    AND us.id = auth.uid();
$function$;

-- Fix 2: Attach the existing prevent_credits_tampering function as a trigger
DROP TRIGGER IF EXISTS prevent_credits_tampering_trigger ON public.user_settings;
CREATE TRIGGER prevent_credits_tampering_trigger
BEFORE UPDATE ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_credits_tampering();