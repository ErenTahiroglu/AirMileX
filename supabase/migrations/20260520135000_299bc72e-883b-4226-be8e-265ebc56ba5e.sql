
-- 1. Column-level lockdown on user_settings: revoke wildcard, grant only safe columns
REVOKE SELECT ON public.user_settings FROM anon, authenticated;
GRANT SELECT (id, maps_provider, credits, created_at, updated_at) ON public.user_settings TO authenticated;
-- Preserve insert/update ability so existing RLS policies still let users save settings
GRANT INSERT, UPDATE ON public.user_settings TO authenticated;

-- 2. Atomic credit reservation to close TOCTOU race in airtable-proxy
CREATE OR REPLACE FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE user_settings
  SET credits = credits - p_amount
  WHERE id = p_user_id AND credits >= p_amount
  RETURNING credits INTO new_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;
  RETURN new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_balance integer;
BEGIN
  IF p_amount <= 0 THEN
    SELECT credits INTO new_balance FROM user_settings WHERE id = p_user_id;
    RETURN new_balance;
  END IF;
  UPDATE user_settings
  SET credits = credits + p_amount
  WHERE id = p_user_id
  RETURNING credits INTO new_balance;
  RETURN new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer) TO service_role;
