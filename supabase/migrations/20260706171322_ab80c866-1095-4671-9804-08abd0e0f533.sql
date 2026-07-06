
-- Reassign expired lead to next broker in the current distribution window queue.
-- Marks the previous broker as "lost" for that lead in lead_history.
CREATE OR REPLACE FUNCTION public.reassign_expired_lead(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- fallback: any active broker other than previous
    SELECT b.id, b.name INTO v_next FROM public.brokers b
    WHERE b.active = true AND (v_prev_broker IS NULL OR b.id <> v_prev_broker)
    ORDER BY random() LIMIT 1;
  END IF;

  IF v_next.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_broker');
  END IF;

  -- log loss on previous broker (if any)
  IF v_prev_broker IS NOT NULL THEN
    INSERT INTO public.lead_history(lead_id, event_type, description, actor_name)
    VALUES (_lead_id, 'lost', 'Lead expirou na roleta e foi repassado', COALESCE(v_lead.broker_name, v_prev_broker::text));
  END IF;

  UPDATE public.leads
    SET broker_id = v_next.id::text,
        broker_name = v_next.name,
        created_at = now(),          -- reinicia contagem da roleta
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
END $$;

GRANT EXECUTE ON FUNCTION public.reassign_expired_lead(uuid) TO authenticated, service_role;

-- Count how many leads each broker lost today
CREATE OR REPLACE FUNCTION public.leads_lost_today()
RETURNS TABLE(broker_name text, lost_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT actor_name AS broker_name, count(*)::bigint
  FROM public.lead_history
  WHERE event_type = 'lost'
    AND created_at >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
  GROUP BY actor_name
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.leads_lost_today() TO authenticated, service_role;
