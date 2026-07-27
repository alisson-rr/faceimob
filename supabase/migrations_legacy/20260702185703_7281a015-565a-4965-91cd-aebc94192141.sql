
DROP POLICY IF EXISTS "cca_deals_write_auth" ON public.cca_deals;
CREATE POLICY "cca_deals_write_auth" ON public.cca_deals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "cca_deals_update_auth" ON public.cca_deals;
CREATE POLICY "cca_deals_update_auth" ON public.cca_deals
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
