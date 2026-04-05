ALTER TABLE public.user_settings ADD COLUMN credits integer NOT NULL DEFAULT 50;

CREATE TABLE public.processed_polar_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_polar_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
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
$body$;