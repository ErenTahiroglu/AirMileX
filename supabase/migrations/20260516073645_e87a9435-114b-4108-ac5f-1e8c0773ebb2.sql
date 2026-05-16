
REVOKE EXECUTE ON FUNCTION public.prevent_credits_tampering() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_credits_default_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_settings_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settings_flags(uuid) TO authenticated;
