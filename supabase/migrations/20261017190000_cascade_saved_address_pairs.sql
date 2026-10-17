-- Forward migration: enforce foreign key cascade on public.saved_address_pairs to auth.users(id)
-- Uses NOT VALID for safe non-blocking introduction without failing on potential historical orphaned rows in remote production.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_address_pairs_user_id_fkey'
  ) THEN
    ALTER TABLE public.saved_address_pairs
      ADD CONSTRAINT saved_address_pairs_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;
