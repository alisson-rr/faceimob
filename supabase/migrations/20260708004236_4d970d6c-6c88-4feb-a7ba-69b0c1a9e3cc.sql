
CREATE TABLE public.daily_team_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  broker_id uuid NOT NULL,
  broker_name text NOT NULL,
  is_custom boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  inactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, broker_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_team_roster TO authenticated;
GRANT ALL ON public.daily_team_roster TO service_role;

ALTER TABLE public.daily_team_roster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage daily roster" ON public.daily_team_roster
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER daily_team_roster_updated_at
  BEFORE UPDATE ON public.daily_team_roster
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Merged roster list (base team roster + custom entries + inactive overrides)
CREATE OR REPLACE FUNCTION public.daily_roster_list(_team_id uuid, _pin_hash text)
RETURNS TABLE(broker_id uuid, broker_name text, active boolean, is_custom boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_pins
     WHERE team_id = _team_id AND active AND pin_hash = _pin_hash
  ) THEN
    RAISE EXCEPTION 'invalid pin';
  END IF;

  RETURN QUERY
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
   ORDER BY 3 DESC, 2 ASC;
END $$;

CREATE OR REPLACE FUNCTION public.daily_roster_add(_team_id uuid, _pin_hash text, _broker_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_pins
     WHERE team_id = _team_id AND active AND pin_hash = _pin_hash
  ) THEN
    RAISE EXCEPTION 'invalid pin';
  END IF;

  IF _broker_name IS NULL OR length(btrim(_broker_name)) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;

  INSERT INTO public.daily_team_roster (id, team_id, broker_id, broker_name, is_custom, active)
  VALUES (v_id, _team_id, v_id, btrim(_broker_name), true, true);

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.daily_roster_remove(_team_id uuid, _pin_hash text, _broker_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_pins
     WHERE team_id = _team_id AND active AND pin_hash = _pin_hash
  ) THEN
    RAISE EXCEPTION 'invalid pin';
  END IF;

  -- Upsert override: if broker belongs to base roster, insert override; otherwise flip existing custom row.
  INSERT INTO public.daily_team_roster (team_id, broker_id, broker_name, is_custom, active, inactivated_at)
  SELECT _team_id, b.id, b.name, false, false, now()
    FROM public.brokers b
   WHERE b.id = _broker_id
  ON CONFLICT (team_id, broker_id)
  DO UPDATE SET active = false, inactivated_at = now(), updated_at = now();

  -- If it was a custom row without a matching broker record, ensure it flips too.
  UPDATE public.daily_team_roster
     SET active = false, inactivated_at = now(), updated_at = now()
   WHERE team_id = _team_id AND broker_id = _broker_id AND is_custom = true;
END $$;

GRANT EXECUTE ON FUNCTION public.daily_roster_list(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_roster_add(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_roster_remove(uuid, text, uuid) TO anon, authenticated;
