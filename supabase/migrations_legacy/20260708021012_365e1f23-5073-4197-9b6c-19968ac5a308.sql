
CREATE OR REPLACE FUNCTION public.daily_roster_list(_team_id uuid, _pin_hash text)
 RETURNS TABLE(broker_id uuid, broker_name text, active boolean, is_custom boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_pins tp
     WHERE tp.team_id = _team_id AND tp.active AND tp.pin_hash = _pin_hash
  ) THEN
    RAISE EXCEPTION 'invalid pin';
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT b.id AS broker_id,
           b.name AS broker_name,
           COALESCE(r.active, true) AS active,
           false AS is_custom
      FROM public.teams t
      JOIN public.brokers b
        ON b.active = true
       AND (b.manager_id = t.manager_id OR b.id = t.manager_id)
      LEFT JOIN public.daily_team_roster r
        ON r.team_id = t.id AND r.broker_id = b.id AND r.is_custom = false
     WHERE t.id = _team_id
    UNION ALL
    SELECT r.broker_id, r.broker_name, r.active, true
      FROM public.daily_team_roster r
     WHERE r.team_id = _team_id AND r.is_custom = true
  ) x
  ORDER BY x.active DESC, x.broker_name ASC;
END $function$;

CREATE OR REPLACE FUNCTION public.daily_roster_add(_team_id uuid, _pin_hash text, _broker_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_pins tp
     WHERE tp.team_id = _team_id AND tp.active AND tp.pin_hash = _pin_hash
  ) THEN
    RAISE EXCEPTION 'invalid pin';
  END IF;

  IF _broker_name IS NULL OR length(btrim(_broker_name)) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;

  INSERT INTO public.daily_team_roster (id, team_id, broker_id, broker_name, is_custom, active)
  VALUES (v_id, _team_id, v_id, btrim(_broker_name), true, true);

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.daily_roster_remove(_team_id uuid, _pin_hash text, _broker_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_pins tp
     WHERE tp.team_id = _team_id AND tp.active AND tp.pin_hash = _pin_hash
  ) THEN
    RAISE EXCEPTION 'invalid pin';
  END IF;

  INSERT INTO public.daily_team_roster (team_id, broker_id, broker_name, is_custom, active, inactivated_at)
  SELECT _team_id, b.id, b.name, false, false, now()
    FROM public.brokers b
   WHERE b.id = _broker_id
  ON CONFLICT (team_id, broker_id)
  DO UPDATE SET active = false, inactivated_at = now(), updated_at = now();

  UPDATE public.daily_team_roster
     SET active = false, inactivated_at = now(), updated_at = now()
   WHERE team_id = _team_id AND broker_id = _broker_id AND is_custom = true;
END $function$;
