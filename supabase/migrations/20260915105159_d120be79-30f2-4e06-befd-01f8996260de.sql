CREATE TABLE IF NOT EXISTS public.quick_distance_usage (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

GRANT ALL ON public.quick_distance_usage TO service_role;

ALTER TABLE public.quick_distance_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_quick_distance_quota(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.quick_distance_usage (bucket_key, window_start, request_count)
  VALUES (p_bucket_key, v_window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = public.quick_distance_usage.request_count + 1
  RETURNING request_count INTO v_count;

  DELETE FROM public.quick_distance_usage
  WHERE window_start < now() - interval '2 days';

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_quick_distance_quota(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_quick_distance_quota(text, integer, integer) TO service_role;