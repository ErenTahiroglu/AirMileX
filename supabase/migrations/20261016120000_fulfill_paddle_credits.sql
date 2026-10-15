-- Phase 1B: Atomic credit fulfillment RPC and transaction deduplication
-- 1. Extend processed_paddle_events with transaction_id, user_id, credits_added
ALTER TABLE public.processed_paddle_events
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS credits_added integer DEFAULT 500;

-- Unique index to prevent duplicate fulfillment across different event IDs for the same transaction
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_paddle_events_tx_id
  ON public.processed_paddle_events (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- 2. Idempotent atomic credit fulfillment RPC
CREATE OR REPLACE FUNCTION public.fulfill_paddle_credits(
  p_event_id text,
  p_transaction_id text,
  p_user_id uuid,
  p_credits integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  -- Restrict execution to service_role
  IF current_setting('role', true) != 'service_role' AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: service_role required';
  END IF;

  -- Validate inputs
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'Missing event_id';
  END IF;
  IF p_transaction_id IS NULL OR btrim(p_transaction_id) = '' THEN
    RAISE EXCEPTION 'Missing transaction_id';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credits amount: %', p_credits;
  END IF;

  -- Check if already processed (fast path)
  IF EXISTS (
    SELECT 1 FROM public.processed_paddle_events
    WHERE id = p_event_id OR transaction_id = p_transaction_id
  ) THEN
    SELECT credits INTO v_new_balance
    FROM public.user_settings
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'credits_added', 0,
      'balance', COALESCE(v_new_balance, 0)
    );
  END IF;

  -- Atomically record fulfillment and update user balance.
  -- Inserting into processed_paddle_events first locks the event_id and transaction_id.
  BEGIN
    INSERT INTO public.processed_paddle_events (id, transaction_id, user_id, credits_added, created_at)
    VALUES (p_event_id, p_transaction_id, p_user_id, p_credits, now());

    UPDATE public.user_settings
    SET credits = credits + p_credits
    WHERE id = p_user_id
    RETURNING credits INTO v_new_balance;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User settings not found for user: %', p_user_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', false,
      'credits_added', p_credits,
      'balance', v_new_balance
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- A concurrent transaction claimed this event_id or transaction_id.
      -- The subtransaction is rolled back, preventing any double-crediting.
      SELECT credits INTO v_new_balance
      FROM public.user_settings
      WHERE id = p_user_id;

      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'credits_added', 0,
        'balance', COALESCE(v_new_balance, 0)
      );
  END;
END;
$$;

-- Restrict RPC permissions: service_role only
REVOKE ALL ON FUNCTION public.fulfill_paddle_credits(text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_paddle_credits(text, text, uuid, integer) TO service_role;
