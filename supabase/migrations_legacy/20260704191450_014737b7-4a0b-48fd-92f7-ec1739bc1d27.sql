
-- ============ Distribution Windows ============
CREATE TABLE public.distribution_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL UNIQUE, -- 'morning' | 'afternoon' | 'evening'
  label text NOT NULL,
  checkin_start time NOT NULL,
  distribution_start time NOT NULL,
  checkout_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.distribution_windows TO authenticated, anon;
GRANT ALL ON public.distribution_windows TO service_role;
ALTER TABLE public.distribution_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "windows_read_all" ON public.distribution_windows FOR SELECT USING (true);
CREATE POLICY "windows_admin_write" ON public.distribution_windows FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.distribution_windows (slot,label,checkin_start,distribution_start,checkout_time) VALUES
  ('morning','Manhã','09:00','09:30','11:59'),
  ('afternoon','Tarde','12:00','13:30','15:59'),
  ('evening','Noite','16:00','16:30','22:00');

-- ============ Allowed IPs ============
CREATE TABLE public.allowed_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip inet NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ip)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_ips TO authenticated;
GRANT ALL ON public.allowed_ips TO service_role;
ALTER TABLE public.allowed_ips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ips_admin_all" ON public.allowed_ips FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ips_read_authenticated" ON public.allowed_ips FOR SELECT TO authenticated USING (true);

-- ============ Broker Checkins ============
CREATE TABLE public.broker_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  user_id uuid,
  slot text NOT NULL,
  work_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  ip inet,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  auto_checkout boolean NOT NULL DEFAULT false,
  leads_received int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(broker_id, work_date, slot)
);
CREATE INDEX broker_checkins_active_idx ON public.broker_checkins(slot, work_date) WHERE checked_out_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.broker_checkins TO authenticated;
GRANT ALL ON public.broker_checkins TO service_role;
ALTER TABLE public.broker_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkins_read_all_auth" ON public.broker_checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "checkins_admin_write" ON public.broker_checkins FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ Roleta FIFO por check-in (para Meta Ads e afins) ============
CREATE OR REPLACE FUNCTION public.leads_round_robin_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_broker record;
  v_now timestamptz := now();
  v_date date := (v_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_time time := (v_now AT TIME ZONE 'America/Sao_Paulo')::time;
  v_slot text;
  v_is_meta boolean;
BEGIN
  IF NEW.broker_id IS NOT NULL AND NEW.broker_id <> '' THEN
    RETURN NEW;
  END IF;

  v_is_meta := COALESCE(NEW.source,'') ILIKE 'meta%';

  IF v_is_meta THEN
    -- current active window with distribution already started
    SELECT slot INTO v_slot FROM public.distribution_windows
    WHERE active = true
      AND v_time >= distribution_start
      AND v_time <  checkout_time
    ORDER BY distribution_start DESC LIMIT 1;

    IF v_slot IS NOT NULL THEN
      -- FIFO: quem recebeu menos leads na janela, desempate pela ordem de check-in
      SELECT b.id, b.name INTO v_broker
      FROM public.broker_checkins c
      JOIN public.brokers b ON b.id = c.broker_id AND b.active = true
      WHERE c.slot = v_slot
        AND c.work_date = v_date
        AND c.checked_out_at IS NULL
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

    -- nenhum corretor logado: deixa sem broker e notifica gestores/admins
    INSERT INTO public.notifications (user_id, title, message)
    SELECT ur.user_id,
           '⚠️ Lead Meta sem corretor',
           'Lead "' || COALESCE(NEW.name,'sem nome') || '" chegou fora da janela ou sem corretor logado. Atribua manualmente.'
    FROM public.user_roles ur
    WHERE ur.role IN ('admin','manager','director');
    RETURN NEW;
  END IF;

  -- fallback (leads não-Meta): comportamento anterior
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
END;
$function$;

-- garante o trigger
DROP TRIGGER IF EXISTS trg_leads_round_robin ON public.leads;
CREATE TRIGGER trg_leads_round_robin
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_round_robin_assign();

-- ============ Auto checkout function + cron ============
CREATE OR REPLACE FUNCTION public.auto_checkout_slot(_slot text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.broker_checkins
     SET checked_out_at = now(), auto_checkout = true
   WHERE slot = _slot
     AND work_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
     AND checked_out_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_windows_updated BEFORE UPDATE ON public.distribution_windows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ips_updated BEFORE UPDATE ON public.allowed_ips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- schedule auto checkouts (America/Sao_Paulo = UTC-3 → 11:59 BRT = 14:59 UTC, 15:59 = 18:59 UTC, 22:00 = 01:00 UTC next day)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('auto-checkout-morning',   '59 14 * * *', $$SELECT public.auto_checkout_slot('morning');$$);
SELECT cron.schedule('auto-checkout-afternoon', '59 18 * * *', $$SELECT public.auto_checkout_slot('afternoon');$$);
SELECT cron.schedule('auto-checkout-evening',   '0 1 * * *',   $$SELECT public.auto_checkout_slot('evening');$$);
