
-- Create private schema for internal SECURITY DEFINER helpers (not exposed by PostgREST)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Recreate has_role in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

-- Rewrite every policy that referenced public.has_role to use private.has_role
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE (qual ILIKE '%public.has_role%' OR with_check ILIKE '%public.has_role%'
        OR qual ILIKE '%has_role(%' OR with_check ILIKE '%has_role(%')
      AND schemaname = 'public'
  LOOP
    -- rebuild via CREATE OR REPLACE POLICY? Not supported. Use DROP + CREATE per-policy manually below.
    NULL;
  END LOOP;
END $$;

-- Recreate the policies. Grouped by table.
-- profiles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));

-- user_roles
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS user_roles_write_admin ON public.user_roles;
CREATE POLICY user_roles_write_admin ON public.user_roles FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- tasks
DROP POLICY IF EXISTS tasks_select_own_or_admin ON public.tasks;
CREATE POLICY tasks_select_own_or_admin ON public.tasks FOR SELECT TO authenticated
  USING (assigned_user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS tasks_update_own_or_admin ON public.tasks;
CREATE POLICY tasks_update_own_or_admin ON public.tasks FOR UPDATE TO authenticated
  USING (assigned_user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (assigned_user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS tasks_delete_admin ON public.tasks;
CREATE POLICY tasks_delete_admin ON public.tasks FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- team_pins
DROP POLICY IF EXISTS "admin manage pins" ON public.team_pins;
CREATE POLICY "admin manage pins" ON public.team_pins FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- daily_team_reports
DROP POLICY IF EXISTS "admin manage reports" ON public.daily_team_reports;
CREATE POLICY "admin manage reports" ON public.daily_team_reports FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- daily_broker_entries
DROP POLICY IF EXISTS "admin manage entries" ON public.daily_broker_entries;
CREATE POLICY "admin manage entries" ON public.daily_broker_entries FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- brokers
DROP POLICY IF EXISTS brokers_write_admin ON public.brokers;
CREATE POLICY brokers_write_admin ON public.brokers FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- deals
DROP POLICY IF EXISTS deals_delete_admin ON public.deals;
CREATE POLICY deals_delete_admin ON public.deals FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- leads
DROP POLICY IF EXISTS leads_delete_admin ON public.leads;
CREATE POLICY leads_delete_admin ON public.leads FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- cca_deals
DROP POLICY IF EXISTS cca_deals_delete_admin ON public.cca_deals;
CREATE POLICY cca_deals_delete_admin ON public.cca_deals FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- cca_developers
DROP POLICY IF EXISTS cca_developers_write_admin ON public.cca_developers;
CREATE POLICY cca_developers_write_admin ON public.cca_developers FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- cca_stages
DROP POLICY IF EXISTS cca_stages_write_admin ON public.cca_stages;
CREATE POLICY cca_stages_write_admin ON public.cca_stages FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- team_assignments
DROP POLICY IF EXISTS team_assignments_write_admin ON public.team_assignments;
CREATE POLICY team_assignments_write_admin ON public.team_assignments FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- notifications
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));

-- teams
DROP POLICY IF EXISTS teams_write_admin ON public.teams;
CREATE POLICY teams_write_admin ON public.teams FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- role_permissions
DROP POLICY IF EXISTS role_permissions_write_admin ON public.role_permissions;
CREATE POLICY role_permissions_write_admin ON public.role_permissions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- stage_permissions
DROP POLICY IF EXISTS stage_permissions_write_admin ON public.stage_permissions;
CREATE POLICY stage_permissions_write_admin ON public.stage_permissions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- closed_months
DROP POLICY IF EXISTS "Only admins can insert closed months" ON public.closed_months;
CREATE POLICY "Only admins can insert closed months" ON public.closed_months FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Only admins can delete closed months" ON public.closed_months;
CREATE POLICY "Only admins can delete closed months" ON public.closed_months FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- Now revoke the public has_role so nothing calls it
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
