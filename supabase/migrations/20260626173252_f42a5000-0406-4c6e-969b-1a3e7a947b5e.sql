
-- =========================================================
-- 1) DROP permissive / anon policies
-- =========================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('brokers','deals','leads','cca_deals','cca_developers','cca_stages',
                        'profiles','notifications','teams','user_roles','role_permissions',
                        'stage_permissions','team_assignments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- =========================================================
-- 2) Revoke anon access on all CRM tables
-- =========================================================
REVOKE ALL ON public.brokers, public.deals, public.leads, public.cca_deals,
              public.cca_developers, public.cca_stages, public.profiles,
              public.notifications, public.teams, public.user_roles,
              public.role_permissions, public.stage_permissions, public.team_assignments
FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brokers, public.deals, public.leads,
       public.cca_deals, public.cca_developers, public.cca_stages,
       public.notifications, public.teams, public.team_assignments
TO authenticated;
GRANT SELECT ON public.profiles, public.user_roles, public.role_permissions, public.stage_permissions TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;

-- =========================================================
-- 3) Re-create policies — authenticated-only, scoped where possible
-- =========================================================

-- BROKERS (CRM internal directory)
CREATE POLICY "brokers_select_auth"  ON public.brokers FOR SELECT TO authenticated USING (true);
CREATE POLICY "brokers_write_admin"  ON public.brokers FOR ALL    TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- DEALS / LEADS (CRM working set — all authenticated members can collaborate)
CREATE POLICY "deals_select_auth" ON public.deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "deals_insert_auth" ON public.deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "deals_update_auth" ON public.deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "deals_delete_admin" ON public.deals FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "leads_select_auth" ON public.leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "leads_insert_auth" ON public.leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "leads_update_auth" ON public.leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "leads_delete_admin" ON public.leads FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- CCA tables
CREATE POLICY "cca_deals_select_auth" ON public.cca_deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "cca_deals_write_auth" ON public.cca_deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cca_deals_update_auth" ON public.cca_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cca_deals_delete_admin" ON public.cca_deals FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "cca_developers_select_auth" ON public.cca_developers FOR SELECT TO authenticated USING (true);
CREATE POLICY "cca_developers_write_admin" ON public.cca_developers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "cca_stages_select_auth" ON public.cca_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "cca_stages_write_admin" ON public.cca_stages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- PROFILES — user owns row; admins see all
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- USER_ROLES — user reads own; admin manages
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "user_roles_write_admin" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- NOTIFICATIONS — user reads/updates own
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Inserts only via service_role (edge functions); no policy for anon/authenticated

-- TEAMS / ASSIGNMENTS / PERMS — read for authenticated, write for admin
CREATE POLICY "teams_select_auth" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_write_admin" ON public.teams FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "team_assignments_select_auth" ON public.team_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_assignments_write_admin" ON public.team_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "role_permissions_select_auth" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_permissions_write_admin" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "stage_permissions_select_auth" ON public.stage_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "stage_permissions_write_admin" ON public.stage_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- =========================================================
-- 4) Harden functions (search_path)
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.sync_deal_to_cca()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.developer IN ('MRV','Tenda','Direcional') THEN
    INSERT INTO public.cca_deals (deal_id, status, notes)
    VALUES (NEW.id, 'Análise de Crédito', NEW.notes)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
