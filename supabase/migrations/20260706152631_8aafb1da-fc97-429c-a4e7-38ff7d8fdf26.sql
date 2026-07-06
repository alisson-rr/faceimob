-- Fix: BEFORE INSERT trigger on leads was inserting into lead_history using NEW.id
-- which caused FK violation because the leads row didn't exist yet.
-- Split into: BEFORE trigger for field mutations, AFTER trigger for history logging.

CREATE OR REPLACE FUNCTION public.leads_on_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.last_activity_at := now();
  IF TG_OP = 'UPDATE' AND OLD.funnel_stage IS DISTINCT FROM NEW.funnel_stage THEN
    IF NEW.funnel_stage = 'first_contact' AND NEW.first_contact_at IS NULL THEN
      NEW.first_contact_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.leads_history_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_history(lead_id, event_type, description)
    VALUES (NEW.id, 'created', 'Lead recebido da origem: ' || COALESCE(NEW.source,'—'));
  ELSIF TG_OP = 'UPDATE' AND OLD.funnel_stage IS DISTINCT FROM NEW.funnel_stage THEN
    INSERT INTO public.lead_history(lead_id, event_type, description)
    VALUES (NEW.id, 'stage_change', 'Movido para ' || NEW.funnel_stage::text);
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_leads_history ON public.leads;
CREATE TRIGGER trg_leads_history
AFTER INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_history_after_change();
