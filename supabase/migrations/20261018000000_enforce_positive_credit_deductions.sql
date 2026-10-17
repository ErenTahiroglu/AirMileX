-- Migration: 20261018000000_enforce_positive_credit_deductions.sql
-- Purpose: Hardens legacy deduct_credits and reserve_credits to strictly reject non-positive amounts (<= 0),
--          preventing negative values from inflating user credit balances.
--          Documents deprecation contract for deduct_credits (retained for backward-compatibility; active code uses reserve_credits).

-- 1. Harden public.deduct_credits (Legacy / Deprecated)
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Deduction amount must be strictly positive';
  END IF;

  UPDATE user_settings
  SET credits = credits - p_amount
  WHERE id = p_user_id AND credits >= p_amount
  RETURNING credits INTO new_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;
  RETURN new_balance;
END;
$body$;

-- Maintain permissions: service_role only
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.deduct_credits(uuid, integer) IS 'DEPRECATED: Legacy deduction RPC retained for backwards-compatibility. Active calculations use reserve_credits and refund_credits.';

-- 2. Harden public.reserve_credits to strictly reject non-positive amounts
CREATE OR REPLACE FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid reservation amount: must be a positive integer';
  END IF;

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

-- Maintain permissions: service_role only
REVOKE EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) TO service_role;
