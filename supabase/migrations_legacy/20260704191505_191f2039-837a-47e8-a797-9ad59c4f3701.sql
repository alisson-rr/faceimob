
REVOKE ALL ON FUNCTION public.auto_checkout_slot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_checkout_slot(text) TO service_role, postgres;
