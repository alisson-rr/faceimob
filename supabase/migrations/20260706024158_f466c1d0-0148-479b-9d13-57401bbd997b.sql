
-- Metas nos brokers (gerente/diretor/corretor)
ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS monthly_goal numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yearly_goal numeric DEFAULT 0;

-- Links úteis (CRUD real)
CREATE TABLE IF NOT EXISTS public.useful_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  category text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.useful_links TO authenticated;
GRANT ALL ON public.useful_links TO service_role;
ALTER TABLE public.useful_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "useful_links_select" ON public.useful_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "useful_links_admin_write" ON public.useful_links FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_useful_links_updated_at BEFORE UPDATE ON public.useful_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Aportes de marketing por construtora
CREATE TABLE IF NOT EXISTS public.marketing_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invested_at date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount >= 0),
  developer text,
  channel text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_investments TO authenticated;
GRANT ALL ON public.marketing_investments TO service_role;
ALTER TABLE public.marketing_investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mi_select" ON public.marketing_investments FOR SELECT TO authenticated USING (true);
CREATE POLICY "mi_write" ON public.marketing_investments FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'director'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'director'::app_role));
CREATE TRIGGER trg_mi_updated_at BEFORE UPDATE ON public.marketing_investments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_mi_invested_at ON public.marketing_investments(invested_at);

-- Resultados anuais VGV
CREATE TABLE IF NOT EXISTS public.annual_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  sales_count int NOT NULL DEFAULT 0,
  vgv numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annual_results TO authenticated;
GRANT ALL ON public.annual_results TO service_role;
ALTER TABLE public.annual_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ar_select" ON public.annual_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "ar_admin_write" ON public.annual_results FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_ar_updated_at BEFORE UPDATE ON public.annual_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Dicas de ouro (uma ativa por vez)
CREATE TABLE IF NOT EXISTS public.gold_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_tips TO authenticated;
GRANT ALL ON public.gold_tips TO service_role;
ALTER TABLE public.gold_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gt_select" ON public.gold_tips FOR SELECT TO authenticated USING (true);
CREATE POLICY "gt_admin_write" ON public.gold_tips FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_gt_updated_at BEFORE UPDATE ON public.gold_tips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recados importantes
CREATE TABLE IF NOT EXISTS public.important_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.important_notices TO authenticated;
GRANT ALL ON public.important_notices TO service_role;
ALTER TABLE public.important_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "in_select" ON public.important_notices FOR SELECT TO authenticated USING (true);
CREATE POLICY "in_admin_write" ON public.important_notices FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_in_updated_at BEFORE UPDATE ON public.important_notices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
