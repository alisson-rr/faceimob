
-- 1. Extensions for scheduled automation
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Link brokers to auth users so we can notify them
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS director_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- 3. Track last interaction on deals
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS notified_24h boolean NOT NULL DEFAULT false;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS notified_48h boolean NOT NULL DEFAULT false;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS notified_72h boolean NOT NULL DEFAULT false;

-- 4. Tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text DEFAULT '',
  due_date timestamptz,
  done boolean NOT NULL DEFAULT false,
  auto_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select_own_or_admin" ON public.tasks FOR SELECT TO authenticated
  USING (assigned_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "tasks_insert_auth" ON public.tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tasks_update_own_or_admin" ON public.tasks FOR UPDATE TO authenticated
  USING (assigned_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (assigned_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "tasks_delete_admin" ON public.tasks FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Update last_interaction_at + reset inactivity flags on any change
CREATE OR REPLACE FUNCTION public.deals_touch_interaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.last_interaction_at := now();
  NEW.notified_24h := false;
  NEW.notified_48h := false;
  NEW.notified_72h := false;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS deals_touch_interaction_trg ON public.deals;
CREATE TRIGGER deals_touch_interaction_trg
  BEFORE UPDATE ON public.deals
  FOR EACH ROW
  WHEN (OLD.stage IS DISTINCT FROM NEW.stage OR OLD.notes IS DISTINCT FROM NEW.notes OR OLD.history IS DISTINCT FROM NEW.history)
  EXECUTE FUNCTION public.deals_touch_interaction();

-- 6. Notify + auto-task on stage change
CREATE OR REPLACE FUNCTION public.deals_on_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_broker_user uuid;
  v_broker_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  SELECT user_id, name INTO v_broker_user, v_broker_name FROM public.brokers WHERE id = NEW.broker1_id;

  IF v_broker_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (v_broker_user, 'Etapa atualizada: ' || NEW.client,
      'O negócio "' || NEW.client || '" mudou para a etapa "' || NEW.stage::text || '".');
  END IF;

  -- Auto tasks
  IF NEW.stage = 'approved'::deal_stage THEN
    INSERT INTO public.tasks (deal_id, broker_id, assigned_user_id, title, description, due_date, auto_generated)
    VALUES (NEW.id, NEW.broker1_id, v_broker_user, 'Solicitar contrato',
      'Cliente "' || NEW.client || '" foi aprovado. Solicitar contrato à construtora ' || COALESCE(NEW.developer,'') || '.',
      now() + interval '2 days', true);
  ELSIF NEW.stage = 'closed'::deal_stage THEN
    INSERT INTO public.tasks (deal_id, broker_id, assigned_user_id, title, description, due_date, auto_generated)
    VALUES (NEW.id, NEW.broker1_id, v_broker_user, 'Registrar comissão e pós-venda',
      'Venda fechada para "' || NEW.client || '". Registrar comissão e iniciar pós-venda.',
      now() + interval '5 days', true);
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS deals_on_stage_change_trg ON public.deals;
CREATE TRIGGER deals_on_stage_change_trg
  AFTER INSERT OR UPDATE OF stage ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_on_stage_change();

-- 7. Round-robin lead assignment
CREATE OR REPLACE FUNCTION public.leads_round_robin_assign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_broker record;
BEGIN
  IF NEW.broker_id IS NOT NULL AND NEW.broker_id <> '' THEN
    RETURN NEW;
  END IF;

  -- pick active broker with fewest recent leads
  SELECT b.id, b.name INTO v_broker
  FROM public.brokers b
  WHERE b.active = true
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
END; $$;

DROP TRIGGER IF EXISTS leads_round_robin_trg ON public.leads;
CREATE TRIGGER leads_round_robin_trg
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_round_robin_assign();

-- 8. Inactivity checker (cron)
CREATE OR REPLACE FUNCTION public.check_deal_inactivity()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
  v_user uuid;
BEGIN
  -- 24h → broker
  FOR d IN
    SELECT dl.*, b.user_id AS broker_user, b.name AS broker_name
    FROM public.deals dl
    LEFT JOIN public.brokers b ON b.id = dl.broker1_id
    WHERE dl.active = true
      AND dl.stage NOT IN ('closed'::deal_stage)
      AND dl.notified_24h = false
      AND dl.last_interaction_at < now() - interval '24 hours'
      AND dl.last_interaction_at >= now() - interval '48 hours'
  LOOP
    IF d.broker_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message)
      VALUES (d.broker_user, '⚠️ Sem interação há 24h', 'O cliente "' || d.client || '" está há mais de 24h sem interação.');
    END IF;
    UPDATE public.deals SET notified_24h = true WHERE id = d.id;
  END LOOP;

  -- 48h → manager
  FOR d IN
    SELECT dl.*, b.manager_id AS manager_id
    FROM public.deals dl
    LEFT JOIN public.brokers b ON b.id = dl.broker1_id
    WHERE dl.active = true
      AND dl.stage NOT IN ('closed'::deal_stage)
      AND dl.notified_48h = false
      AND dl.last_interaction_at < now() - interval '48 hours'
      AND dl.last_interaction_at >= now() - interval '72 hours'
  LOOP
    SELECT user_id INTO v_user FROM public.brokers WHERE id = COALESCE(d.manager1_id, d.manager_id);
    IF v_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message)
      VALUES (v_user, '⚠️ Sem interação há 48h', 'O cliente "' || d.client || '" está há mais de 48h sem interação. Verifique com o corretor.');
    END IF;
    UPDATE public.deals SET notified_48h = true WHERE id = d.id;
  END LOOP;

  -- 72h → director
  FOR d IN
    SELECT dl.*, b.director_id AS director_id
    FROM public.deals dl
    LEFT JOIN public.brokers b ON b.id = dl.broker1_id
    WHERE dl.active = true
      AND dl.stage NOT IN ('closed'::deal_stage)
      AND dl.notified_72h = false
      AND dl.last_interaction_at < now() - interval '72 hours'
  LOOP
    SELECT user_id INTO v_user FROM public.brokers WHERE id = COALESCE(d.director1_id, d.director_id);
    IF v_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message)
      VALUES (v_user, '🚨 Sem interação há 72h', 'O cliente "' || d.client || '" está há mais de 72h sem interação. Ação da direção necessária.');
    END IF;
    UPDATE public.deals SET notified_72h = true WHERE id = d.id;
  END LOOP;
END; $$;

-- 9. Schedule hourly
DO $$
BEGIN
  PERFORM cron.unschedule('check-deal-inactivity');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'check-deal-inactivity',
  '0 * * * *',
  $$ SELECT public.check_deal_inactivity(); $$
);
