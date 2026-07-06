
DO $$ BEGIN
  CREATE TYPE public.lead_funnel_stage AS ENUM ('new','first_contact','no_response','warm','hot','gathering_docs','converted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS funnel_stage public.lead_funnel_stage NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS form_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS first_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.lead_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text NOT NULL,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.lead_history TO authenticated;
GRANT ALL ON public.lead_history TO service_role;
ALTER TABLE public.lead_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read lead_history" ON public.lead_history;
DROP POLICY IF EXISTS "auth insert lead_history" ON public.lead_history;
CREATE POLICY "auth read lead_history" ON public.lead_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert lead_history" ON public.lead_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_lead_history_lead ON public.lead_history(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_comments TO authenticated;
GRANT ALL ON public.lead_comments TO service_role;
ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read lead_comments" ON public.lead_comments;
DROP POLICY IF EXISTS "auth insert lead_comments" ON public.lead_comments;
CREATE POLICY "auth read lead_comments" ON public.lead_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert lead_comments" ON public.lead_comments FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_lead_comments_lead ON public.lead_comments(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  deal_id uuid,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime text,
  size integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_attachments TO authenticated;
GRANT ALL ON public.lead_attachments TO service_role;
ALTER TABLE public.lead_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read lead_attachments" ON public.lead_attachments;
DROP POLICY IF EXISTS "auth insert lead_attachments" ON public.lead_attachments;
DROP POLICY IF EXISTS "auth update lead_attachments" ON public.lead_attachments;
CREATE POLICY "auth read lead_attachments" ON public.lead_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert lead_attachments" ON public.lead_attachments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update lead_attachments" ON public.lead_attachments FOR UPDATE TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead ON public.lead_attachments(lead_id);

CREATE OR REPLACE FUNCTION public.leads_on_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.last_activity_at := now();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_history(lead_id,event_type,description)
    VALUES (NEW.id,'created', 'Lead recebido da origem: ' || COALESCE(NEW.source,'—'));
  ELSIF TG_OP = 'UPDATE' AND OLD.funnel_stage IS DISTINCT FROM NEW.funnel_stage THEN
    INSERT INTO public.lead_history(lead_id,event_type,description)
    VALUES (NEW.id,'stage_change', 'Movido para ' || NEW.funnel_stage::text);
    IF NEW.funnel_stage = 'first_contact' AND NEW.first_contact_at IS NULL THEN
      NEW.first_contact_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_stage ON public.leads;
CREATE TRIGGER trg_leads_stage
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_on_stage_change();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_history;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_attachments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
