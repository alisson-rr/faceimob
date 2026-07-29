
-- Distribution groups: allow admins to bucket brokers + Meta form IDs
CREATE TABLE public.distribution_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_groups TO authenticated;
GRANT ALL ON public.distribution_groups TO service_role;
ALTER TABLE public.distribution_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read groups" ON public.distribution_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage groups" ON public.distribution_groups FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.distribution_group_brokers (
  group_id UUID NOT NULL REFERENCES public.distribution_groups(id) ON DELETE CASCADE,
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, broker_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_group_brokers TO authenticated;
GRANT ALL ON public.distribution_group_brokers TO service_role;
ALTER TABLE public.distribution_group_brokers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read gb" ON public.distribution_group_brokers FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage gb" ON public.distribution_group_brokers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.distribution_group_forms (
  group_id UUID NOT NULL REFERENCES public.distribution_groups(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  form_name TEXT,
  PRIMARY KEY (group_id, form_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_group_forms TO authenticated;
GRANT ALL ON public.distribution_group_forms TO service_role;
ALTER TABLE public.distribution_group_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read gf" ON public.distribution_group_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage gf" ON public.distribution_group_forms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER upd_distribution_groups BEFORE UPDATE ON public.distribution_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add form_id column on leads for group matching (nullable)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS form_id TEXT;

-- Update round-robin to prefer group brokers when lead.form_id matches a group
CREATE OR REPLACE FUNCTION public.leads_round_robin_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_broker record;
  v_now timestamptz := now();
  v_date date := (v_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_time time := (v_now AT TIME ZONE 'America/Sao_Paulo')::time;
  v_slot text;
  v_is_meta boolean;
  v_group_id uuid;
BEGIN
  IF NEW.broker_id IS NOT NULL AND NEW.broker_id <> '' THEN
    RETURN NEW;
  END IF;

  v_is_meta := COALESCE(NEW.source,'') ILIKE 'meta%';

  -- find matching distribution group by form_id (if any)
  IF NEW.form_id IS NOT NULL THEN
    SELECT g.id INTO v_group_id
      FROM public.distribution_group_forms f
      JOIN public.distribution_groups g ON g.id = f.group_id AND g.active
     WHERE f.form_id = NEW.form_id
     LIMIT 1;
  END IF;

  IF v_is_meta THEN
    SELECT slot INTO v_slot FROM public.distribution_windows
      WHERE active = true AND v_time >= distribution_start AND v_time < checkout_time
      ORDER BY distribution_start DESC LIMIT 1;

    IF v_slot IS NOT NULL THEN
      SELECT b.id, b.name INTO v_broker
      FROM public.broker_checkins c
      JOIN public.brokers b ON b.id = c.broker_id AND b.active = true
      WHERE c.slot = v_slot
        AND c.work_date = v_date
        AND c.checked_out_at IS NULL
        AND (v_group_id IS NULL OR EXISTS (
          SELECT 1 FROM public.distribution_group_brokers gb
          WHERE gb.group_id = v_group_id AND gb.broker_id = b.id
        ))
      ORDER BY c.leads_received ASC, c.checked_in_at ASC
      LIMIT 1;

      IF v_broker.id IS NOT NULL THEN
        NEW.broker_id := v_broker.id::text;
        NEW.broker_name := v_broker.name;
        UPDATE public.broker_checkins
          SET leads_received = leads_received + 1
          WHERE broker_id = v_broker.id AND work_date = v_date AND slot = v_slot;
        RETURN NEW;
      END IF;
    END IF;

    INSERT INTO public.notifications (user_id, title, message)
    SELECT ur.user_id,
           '⚠️ Lead Meta sem corretor',
           'Lead "' || COALESCE(NEW.name,'sem nome') || '" chegou fora da janela ou sem corretor logado.'
    FROM public.user_roles ur
    WHERE ur.role IN ('admin','manager','director');
    RETURN NEW;
  END IF;

  SELECT b.id, b.name INTO v_broker
  FROM public.brokers b
  WHERE b.active = true
    AND (v_group_id IS NULL OR EXISTS (
      SELECT 1 FROM public.distribution_group_brokers gb
      WHERE gb.group_id = v_group_id AND gb.broker_id = b.id
    ))
  ORDER BY (
    SELECT count(*) FROM public.leads l
    WHERE l.broker_id = b.id::text AND l.created_at > now() - interval '30 days'
  ) ASC, random()
  LIMIT 1;

  IF v_broker.id IS NOT NULL THEN
    NEW.broker_id := v_broker.id::text;
    NEW.broker_name := v_broker.name;
  END IF;
  RETURN NEW;
END;
$function$;
