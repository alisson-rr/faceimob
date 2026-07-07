
-- 1) Remove plaintext password column
ALTER TABLE public.brokers DROP COLUMN IF EXISTS login_password_plain;

-- Rebuild get_broker_private without the plaintext password
DROP FUNCTION IF EXISTS public.get_broker_private(uuid);
CREATE OR REPLACE FUNCTION public.get_broker_private(_id uuid)
 RETURNS TABLE(id uuid, cpf text, birth_date date, address text, phone text, celular text, email text, login_email text, login_provisioned_at timestamp with time zone, login_email_confirmed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR EXISTS (SELECT 1 FROM public.brokers b WHERE b.id = _id AND b.user_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT b.id, b.cpf, b.birth_date, b.address, b.phone, b.celular,
           b.email, b.login_email, b.login_provisioned_at, b.login_email_confirmed
    FROM public.brokers b WHERE b.id = _id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_broker_private(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_broker_private(uuid) TO authenticated;

-- 2) Tighten always-true RLS policies (INSERT/UPDATE)
DROP POLICY IF EXISTS "auth insert lead_history" ON public.lead_history;
CREATE POLICY "auth insert lead_history" ON public.lead_history
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id));

DROP POLICY IF EXISTS "auth insert lead_comments" ON public.lead_comments;
CREATE POLICY "auth insert lead_comments" ON public.lead_comments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id));

DROP POLICY IF EXISTS "auth insert lead_attachments" ON public.lead_attachments;
CREATE POLICY "auth insert lead_attachments" ON public.lead_attachments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id));

DROP POLICY IF EXISTS "auth update lead_attachments" ON public.lead_attachments;
CREATE POLICY "auth update lead_attachments" ON public.lead_attachments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id));

-- 3) Storage: require file to be registered in lead_attachments
DROP POLICY IF EXISTS "auth read lead-attachments" ON storage.objects;
CREATE POLICY "auth read lead-attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lead-attachments'
    AND EXISTS (SELECT 1 FROM public.lead_attachments la WHERE la.file_path = name)
  );

DROP POLICY IF EXISTS "auth upload lead-attachments" ON storage.objects;
CREATE POLICY "auth upload lead-attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lead-attachments'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "auth update lead-attachments" ON storage.objects;
CREATE POLICY "auth update lead-attachments" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lead-attachments'
    AND owner = auth.uid()
    AND EXISTS (SELECT 1 FROM public.lead_attachments la WHERE la.file_path = name)
  );

DROP POLICY IF EXISTS "auth delete lead-attachments" ON storage.objects;
CREATE POLICY "auth delete lead-attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lead-attachments'
    AND owner = auth.uid()
    AND EXISTS (SELECT 1 FROM public.lead_attachments la WHERE la.file_path = name)
  );

-- 4) Revoke EXECUTE on SECURITY DEFINER functions that don't need public access
-- Trigger functions never need direct EXECUTE
REVOKE EXECUTE ON FUNCTION public.leads_history_after_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.leads_on_stage_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.leads_stage_changed_at() FROM anon, authenticated, public;

-- Called only by edge functions using service_role
REVOKE EXECUTE ON FUNCTION public.get_team_public_info(uuid) FROM anon, authenticated, public;

-- Called by authenticated clients only (drop anon)
REVOKE EXECUTE ON FUNCTION public.get_team_roster(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_daily_team_month_summary(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_daily_team_report(uuid, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.leads_lost_today() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reassign_expired_lead(uuid) FROM anon, public;
