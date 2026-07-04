
DO $$
DECLARE
  m RECORD;
  v_team_id uuid;
  v_pin text;
  v_hash text;
BEGIN
  FOR m IN
    SELECT DISTINCT b_mgr.id, b_mgr.name
    FROM public.brokers b_mgr
    JOIN public.brokers sub ON sub.manager_id = b_mgr.id
    WHERE b_mgr.active = true
      AND b_mgr.role IN ('manager','director')
      AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.manager_id = b_mgr.id)
  LOOP
    INSERT INTO public.teams (name, manager_id)
    VALUES ('Equipe ' || m.name, m.id)
    RETURNING id INTO v_team_id;

    v_pin := lpad((abs(hashtextextended(v_team_id::text, 42)) % 1000000)::text, 6, '0');
    v_hash := encode(extensions.digest(v_pin::bytea, 'sha256'), 'hex');

    INSERT INTO public.team_pins (team_id, pin_hash, active)
    VALUES (v_team_id, v_hash, true)
    ON CONFLICT (team_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, active = true, updated_at = now();
  END LOOP;
END $$;
