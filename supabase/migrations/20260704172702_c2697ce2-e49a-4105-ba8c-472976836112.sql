
-- Enable pgcrypto for sha256 hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Remove placeholder teams
DELETE FROM public.teams WHERE name IN ('Alpha','Beta','Gamma');

-- 2) Add manager_id to teams (each team belongs to one manager broker)
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teams_manager_id_key ON public.teams(manager_id) WHERE manager_id IS NOT NULL;

-- 3) Rewrite roster to resolve brokers by manager_id (no dependency on team_assignments/user_id)
CREATE OR REPLACE FUNCTION public.get_team_roster(_team_id uuid)
RETURNS TABLE(broker_id uuid, broker_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name
  FROM public.teams t
  JOIN public.brokers b
    ON b.active = true
   AND (b.manager_id = t.manager_id OR b.id = t.manager_id)
  WHERE t.id = _team_id
  ORDER BY b.name;
$$;

-- 4) Create one team per active manager and a PIN per team
DO $$
DECLARE
  m RECORD;
  v_team_id uuid;
  v_pin text;
  v_hash text;
BEGIN
  FOR m IN SELECT id, name FROM public.brokers
           WHERE role = 'manager' AND active = true
  LOOP
    -- upsert team
    SELECT id INTO v_team_id FROM public.teams WHERE manager_id = m.id;
    IF v_team_id IS NULL THEN
      INSERT INTO public.teams (name, manager_id)
      VALUES ('Equipe ' || m.name, m.id)
      RETURNING id INTO v_team_id;
    END IF;

    -- deterministic 6-digit PIN based on team id (stable if re-run)
    v_pin := lpad((abs(hashtextextended(v_team_id::text, 42)) % 1000000)::text, 6, '0');
    v_hash := encode(extensions.digest(v_pin::bytea, 'sha256'), 'hex');

    INSERT INTO public.team_pins (team_id, pin_hash, active)
    VALUES (v_team_id, v_hash, true)
    ON CONFLICT (team_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, active = true, updated_at = now();
  END LOOP;
END $$;
