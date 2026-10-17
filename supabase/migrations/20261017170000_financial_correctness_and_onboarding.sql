-- Phase 5B-R2: Financial Correctness & Onboarding Safeguards

-- 1. Automate 50-credit starting balance on user creation (auth.users -> public.user_settings)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (id, credits)
  VALUES (NEW.id, 50)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any existing auth.users without a user_settings row
INSERT INTO public.user_settings (id, credits)
SELECT au.id, 50
FROM auth.users au
LEFT JOIN public.user_settings us ON us.id = au.id
WHERE us.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 2. Idempotent get_settings_flags RPC that guarantees a row exists and returns safe settings
CREATE OR REPLACE FUNCTION public.get_settings_flags(p_user_id uuid)
RETURNS TABLE(id uuid, maps_provider text, credits integer, has_pat boolean, has_maps_key boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strict ownership check: caller can only inspect and initialize their own settings
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  -- Idempotently ensure the user settings row exists with default 50 credits
  INSERT INTO public.user_settings (id, credits)
  VALUES (p_user_id, 50)
  ON CONFLICT (id) DO NOTHING;

  RETURN QUERY
  SELECT us.id, us.maps_provider, us.credits, us.has_pat, us.has_maps_key
  FROM public.user_settings us
  WHERE us.id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_settings_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settings_flags(uuid) TO authenticated, service_role;

-- 3. Strict validation on reserve_credits: reject non-positive and null amounts
CREATE OR REPLACE FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
BEGIN
  -- Rejection of null, zero, and negative amounts
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid reservation amount: must be a positive integer';
  END IF;

  UPDATE public.user_settings
  SET credits = credits - p_amount
  WHERE id = p_user_id AND credits >= p_amount
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  RETURN new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) TO service_role;

-- 4. Safe refund_credits with integer non-negative handling
CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
BEGIN
  -- Non-positive refunds are treated idempotently as queries of current balance
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT credits INTO new_balance FROM public.user_settings WHERE id = p_user_id;
    RETURN new_balance;
  END IF;

  UPDATE public.user_settings
  SET credits = credits + p_amount
  WHERE id = p_user_id
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer) TO service_role;

-- 5. Add database-level non-negativity constraint (NOT VALID for remote database migration safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_credits_nonnegative'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_credits_nonnegative
      CHECK (credits >= 0) NOT VALID;
  END IF;
END;
$$;
