-- Rebind lingering admin policies from public.has_role to private.has_role
-- (public.has_role EXECUTE was revoked from authenticated in a previous migration,
--  causing "permission denied for function has_role" during RLS evaluation.)

-- allowed_ips
DROP POLICY IF EXISTS "ips_admin_all" ON public.allowed_ips;
CREATE POLICY "ips_admin_all" ON public.allowed_ips
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- broker_checkins
DROP POLICY IF EXISTS "checkins_admin_write" ON public.broker_checkins;
CREATE POLICY "checkins_admin_write" ON public.broker_checkins
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- checkpoint_targets
DROP POLICY IF EXISTS "checkpoint_targets admin write" ON public.checkpoint_targets;
CREATE POLICY "checkpoint_targets admin write" ON public.checkpoint_targets
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- distribution_windows
DROP POLICY IF EXISTS "windows_admin_write" ON public.distribution_windows;
CREATE POLICY "windows_admin_write" ON public.distribution_windows
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));