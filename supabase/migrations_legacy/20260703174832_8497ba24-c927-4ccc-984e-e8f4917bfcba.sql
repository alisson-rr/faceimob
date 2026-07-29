
-- ============ TABLES ============
CREATE TABLE public.team_pins (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_pins TO authenticated;
GRANT ALL ON public.team_pins TO service_role;
ALTER TABLE public.team_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manage pins" ON public.team_pins FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.daily_team_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  filled_by_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, report_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_team_reports TO authenticated;
GRANT ALL ON public.daily_team_reports TO service_role;
ALTER TABLE public.daily_team_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read reports" ON public.daily_team_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage reports" ON public.daily_team_reports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.daily_broker_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.daily_team_reports(id) ON DELETE CASCADE,
  broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL,
  broker_name text NOT NULL,
  leads int NOT NULL DEFAULT 0,
  atendimentos int NOT NULL DEFAULT 0,
  propostas int NOT NULL DEFAULT 0,
  visitas_agendadas int NOT NULL DEFAULT 0,
  visitas_realizadas int NOT NULL DEFAULT 0,
  analises int NOT NULL DEFAULT 0,
  aprovados int NOT NULL DEFAULT 0,
  vendas int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_broker_entries TO authenticated;
GRANT ALL ON public.daily_broker_entries TO service_role;
ALTER TABLE public.daily_broker_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read entries" ON public.daily_broker_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage entries" ON public.daily_broker_entries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_daily_reports_updated BEFORE UPDATE ON public.daily_team_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_team_pins_updated BEFORE UPDATE ON public.team_pins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ PUBLIC READ FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.get_team_roster(_team_id uuid)
RETURNS TABLE(broker_id uuid, broker_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name
  FROM public.brokers b
  JOIN public.team_assignments ta ON ta.user_id = b.user_id
  WHERE ta.team_id = _team_id AND b.active = true
  ORDER BY b.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_team_roster(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_team_public_info(_team_id uuid)
RETURNS TABLE(team_id uuid, team_name text, has_pin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, EXISTS(SELECT 1 FROM public.team_pins p WHERE p.team_id = t.id AND p.active)
  FROM public.teams t WHERE t.id = _team_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_team_public_info(uuid) TO anon, authenticated;
