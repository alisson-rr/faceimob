
CREATE TABLE IF NOT EXISTS public.lead_automation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  roleta_seconds integer NOT NULL DEFAULT 300,
  no_response_hours integer NOT NULL DEFAULT 24,
  inactivity_alert_hours integer NOT NULL DEFAULT 24,
  auto_first_contact boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.lead_automation_settings TO authenticated;
GRANT ALL ON public.lead_automation_settings TO service_role;

ALTER TABLE public.lead_automation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_settings" ON public.lead_automation_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins_write_settings" ON public.lead_automation_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.lead_automation_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Admin write on distribution_windows (allow full CRUD by admins)
DROP POLICY IF EXISTS "admins_manage_dist_windows" ON public.distribution_windows;
CREATE POLICY "admins_manage_dist_windows" ON public.distribution_windows
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
