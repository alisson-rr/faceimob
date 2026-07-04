
-- 1) dashboard_bi_cache: restrict SELECT to authenticated users only
DROP POLICY IF EXISTS "Dashboard BI cache is readable" ON public.dashboard_bi_cache;
CREATE POLICY "Dashboard BI cache is readable by authenticated"
  ON public.dashboard_bi_cache FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.dashboard_bi_cache FROM anon;

-- 2) Revoke direct execution of public SECURITY DEFINER helpers from client roles.
-- These are now called only from the daily-team-info edge function (service role).
REVOKE EXECUTE ON FUNCTION public.get_team_public_info(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_team_roster(uuid) FROM PUBLIC, anon, authenticated;
