
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.leads_stage_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.stage_changed_at := now();
  ELSIF TG_OP = 'UPDATE' AND OLD.funnel_stage IS DISTINCT FROM NEW.funnel_stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_stage_changed_at ON public.leads;
CREATE TRIGGER trg_leads_stage_changed_at
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_stage_changed_at();

ALTER TABLE public.lead_automation_settings
  ADD COLUMN IF NOT EXISTS stage_max_minutes jsonb NOT NULL DEFAULT '{
    "new": 5,
    "first_contact": 60,
    "no_response": 1440,
    "warm": 2880,
    "hot": 1440,
    "gathering_docs": 4320
  }'::jsonb;
