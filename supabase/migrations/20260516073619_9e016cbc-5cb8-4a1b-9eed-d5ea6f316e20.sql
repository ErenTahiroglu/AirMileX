
-- Fix: Prevent credit inflation via crafted INSERT
CREATE OR REPLACE FUNCTION public.enforce_credits_default_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Force credits to default on insert unless the caller is service_role
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    NEW.credits := 50;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_credits_default_on_insert ON public.user_settings;
CREATE TRIGGER enforce_credits_default_on_insert
BEFORE INSERT ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_credits_default_on_insert();

-- Fix: Lock down deduct_credits RPC to service_role only
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) TO service_role;
