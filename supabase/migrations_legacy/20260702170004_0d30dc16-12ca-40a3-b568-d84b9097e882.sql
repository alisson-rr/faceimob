DROP POLICY IF EXISTS deals_select_auth ON public.deals;
CREATE POLICY deals_select_all ON public.deals FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS brokers_select_auth ON public.brokers;
CREATE POLICY brokers_select_all ON public.brokers FOR SELECT TO anon, authenticated USING (true);