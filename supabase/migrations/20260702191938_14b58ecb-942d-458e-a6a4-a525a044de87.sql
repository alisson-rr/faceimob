CREATE OR REPLACE FUNCTION public.deals_on_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_broker_user uuid;
  v_broker_name text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN RETURN NEW; END IF;

  SELECT user_id, name INTO v_broker_user, v_broker_name
  FROM public.brokers WHERE id = NEW.broker1_id;

  IF v_broker_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (v_broker_user, 'Etapa atualizada: ' || NEW.client,
      'O negócio "' || NEW.client || '" mudou para a etapa "' || NEW.stage::text || '".');
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.deals_on_stage_change() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_deal_inactivity()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
  v_user uuid;
BEGIN
  FOR d IN
    SELECT dl.*, b.user_id AS broker_user
    FROM public.deals dl LEFT JOIN public.brokers b ON b.id = dl.broker1_id
    WHERE dl.active = true AND dl.stage <> 'closed'::deal_stage
      AND dl.notified_24h = false
      AND dl.last_interaction_at < now() - interval '24 hours'
  LOOP
    IF d.broker_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message)
      VALUES (d.broker_user, '⚠️ Sem interação há 24h',
        'O cliente "' || d.client || '" está há mais de 24h sem interação.');
    END IF;
    UPDATE public.deals SET notified_24h = true WHERE id = d.id;
  END LOOP;

  FOR d IN
    SELECT dl.*, b.manager_id AS b_manager_id
    FROM public.deals dl LEFT JOIN public.brokers b ON b.id = dl.broker1_id
    WHERE dl.active = true AND dl.stage <> 'closed'::deal_stage
      AND dl.notified_48h = false
      AND dl.last_interaction_at < now() - interval '48 hours'
  LOOP
    SELECT user_id INTO v_user FROM public.brokers
      WHERE id = COALESCE(d.manager1_id, d.b_manager_id);
    IF v_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message)
      VALUES (v_user, '⚠️ Sem interação há 48h',
        'O cliente "' || d.client || '" está há mais de 48h sem interação. Verifique com o corretor.');
    END IF;
    UPDATE public.deals SET notified_48h = true WHERE id = d.id;
  END LOOP;

  FOR d IN
    SELECT dl.*, b.director_id AS b_director_id
    FROM public.deals dl LEFT JOIN public.brokers b ON b.id = dl.broker1_id
    WHERE dl.active = true AND dl.stage <> 'closed'::deal_stage
      AND dl.notified_72h = false
      AND dl.last_interaction_at < now() - interval '72 hours'
  LOOP
    SELECT user_id INTO v_user FROM public.brokers
      WHERE id = COALESCE(d.director1_id, d.b_director_id);
    IF v_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message)
      VALUES (v_user, '🚨 Sem interação há 72h',
        'O cliente "' || d.client || '" está há mais de 72h sem interação. Ação da direção necessária.');
    END IF;
    UPDATE public.deals SET notified_72h = true WHERE id = d.id;
  END LOOP;
END; $$;

REVOKE EXECUTE ON FUNCTION public.check_deal_inactivity() FROM anon, authenticated;