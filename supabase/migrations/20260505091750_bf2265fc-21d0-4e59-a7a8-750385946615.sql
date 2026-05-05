CREATE TABLE public.account_deletion_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL,
  error_message text,
  attempted_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_deletion_attempts_user_time
  ON public.account_deletion_attempts (user_id, attempted_at DESC);

ALTER TABLE public.account_deletion_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deletion attempts"
ON public.account_deletion_attempts
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Service role full access deletion attempts"
ON public.account_deletion_attempts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);