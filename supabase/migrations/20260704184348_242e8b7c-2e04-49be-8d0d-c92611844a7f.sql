-- 1. teams.display_name
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 2. daily_broker_entries new fields
ALTER TABLE public.daily_broker_entries
  ADD COLUMN IF NOT EXISTS ligacoes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coleta_docs INT NOT NULL DEFAULT 0;

-- 3. checkpoint_targets
CREATE TABLE IF NOT EXISTS public.checkpoint_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  analise_enviada_pct NUMERIC NOT NULL DEFAULT 10,
  aprovada_pct NUMERIC NOT NULL DEFAULT 40,
  venda_pct NUMERIC NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkpoint_targets TO authenticated;
GRANT ALL ON public.checkpoint_targets TO service_role;

ALTER TABLE public.checkpoint_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkpoint_targets read auth"
  ON public.checkpoint_targets FOR SELECT TO authenticated USING (true);

CREATE POLICY "checkpoint_targets admin write"
  ON public.checkpoint_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_checkpoint_targets_updated_at
  BEFORE UPDATE ON public.checkpoint_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- seed global default
INSERT INTO public.checkpoint_targets (team_id) VALUES (NULL)
  ON CONFLICT (team_id) DO NOTHING;