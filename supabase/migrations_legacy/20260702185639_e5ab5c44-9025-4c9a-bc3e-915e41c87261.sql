
-- 1. Brokers: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "brokers_select_all" ON public.brokers;
CREATE POLICY "brokers_select_auth" ON public.brokers
  FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.brokers FROM anon;

-- 2. Deals: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "deals_select_all" ON public.deals;
CREATE POLICY "deals_select_auth" ON public.deals
  FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.deals FROM anon;

-- 3. Replace permissive USING(true)/CHECK(true) on write policies
--    Require an authenticated session (auth.uid() IS NOT NULL) instead of blanket true.

-- deals
DROP POLICY IF EXISTS "deals_insert_auth" ON public.deals;
CREATE POLICY "deals_insert_auth" ON public.deals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "deals_update_auth" ON public.deals;
CREATE POLICY "deals_update_auth" ON public.deals
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- leads
DROP POLICY IF EXISTS "leads_insert_auth" ON public.leads;
CREATE POLICY "leads_insert_auth" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "leads_update_auth" ON public.leads;
CREATE POLICY "leads_update_auth" ON public.leads
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- tasks
DROP POLICY IF EXISTS "tasks_insert_auth" ON public.tasks;
CREATE POLICY "tasks_insert_auth" ON public.tasks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- 4. Revoke EXECUTE on SECURITY DEFINER helpers that should never be called via the API.
--    Keep public.has_role executable because RLS policies invoke it.
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_deal_to_cca() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deals_touch_interaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deals_on_stage_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leads_round_robin_assign() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_deal_inactivity() FROM PUBLIC, anon, authenticated;
