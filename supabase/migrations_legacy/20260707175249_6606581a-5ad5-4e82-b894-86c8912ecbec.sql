CREATE OR REPLACE FUNCTION public.reassign_expired_lead(_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead record;
  v_prev_broker uuid;
  v_next record;
  v_now timestamptz := now();
  v_date date := (v_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_time time := (v_now AT TIME ZONE 'America/Sao_Paulo')::time;
  v_slot text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_lead.funnel_stage IS DISTINCT FROM 'new' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_new');
  END IF;

  -- Cooldown: reassignment resets created_at. If the lead was just (re)assigned less
  -- than 30 seconds ago, refuse — prevents concurrent tabs from bouncing the same
  -- lead through several brokers before realtime UPDATE propagation.
  IF v_lead.created_at > v_now - interval '30 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown');
  END IF;

  BEGIN v_prev_broker := v_lead.broker_id::uuid; EXCEPTION WHEN OTHERS THEN v_prev_broker := NULL; END;

  SELECT slot INTO v_slot FROM public.distribution_windows
    WHERE active = true AND v_time >= distribution_start AND v_time < checkout_time
    ORDER BY distribution_start DESC LIMIT 1;

  IF v_slot IS NOT NULL THEN
    SELECT b.id, b.name INTO v_next
    FROM public.broker_checkins c
    JOIN public.brokers b ON b.id = c.broker_id AND b.active = true
    WHERE c.slot = v_slot AND c.work_date = v_date AND c.checked_out_at IS NULL
      AND (v_prev_broker IS NULL OR b.id <> v_prev_broker)
    ORDER BY c.leads_received ASC, c.checked_in_at ASC
    LIMIT 1;
  END IF;

  IF v_next.id IS NULL THEN
    SELECT b.id, b.name INTO v_next FROM public.brokers b
    WHERE b.active = true AND (v_prev_broker IS NULL OR b.id <> v_prev_broker)
    ORDER BY random() LIMIT 1;
  END IF;

  IF v_next.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_broker');
  END IF;

  IF v_prev_broker IS NOT NULL THEN
    INSERT INTO public.lead_history(lead_id, event_type, description, actor_name)
    VALUES (_lead_id, 'lost', 'Lead expirou na roleta e foi repassado', COALESCE(v_lead.broker_name, v_prev_broker::text));
  END IF;

  UPDATE public.leads
    SET broker_id = v_next.id::text,
        broker_name = v_next.name,
        created_at = now(),
        stage_changed_at = now(),
        last_activity_at = now()
    WHERE id = _lead_id;

  IF v_slot IS NOT NULL THEN
    UPDATE public.broker_checkins
      SET leads_received = leads_received + 1
      WHERE broker_id = v_next.id AND work_date = v_date AND slot = v_slot;
  END IF;

  INSERT INTO public.lead_history(lead_id, event_type, description, actor_name)
  VALUES (_lead_id, 'reassigned', 'Lead repassado para ' || v_next.name, v_next.name);

  RETURN jsonb_build_object('ok', true, 'new_broker_id', v_next.id, 'new_broker_name', v_next.name);
END $function$;