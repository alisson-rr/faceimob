
-- Helper: is the current auth user the broker assigned to the given lead?
CREATE OR REPLACE FUNCTION private.is_lead_owner(_lead_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.brokers b ON b.id::text = l.broker_id
    WHERE l.id = _lead_id AND b.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION private.is_lead_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_lead_owner(uuid) TO authenticated, service_role;

-- Helper: is the current auth user staff (admin/manager/director)?
CREATE OR REPLACE FUNCTION private.is_lead_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
  SELECT private.has_role(auth.uid(), 'admin'::app_role)
      OR private.has_role(auth.uid(), 'manager'::app_role)
      OR private.has_role(auth.uid(), 'director'::app_role);
$$;
REVOKE ALL ON FUNCTION private.is_lead_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_lead_staff() TO authenticated, service_role;

-- lead_attachments: tighten INSERT/UPDATE to owner or staff
DROP POLICY IF EXISTS "auth insert lead_attachments" ON public.lead_attachments;
DROP POLICY IF EXISTS "auth update lead_attachments" ON public.lead_attachments;

CREATE POLICY "insert lead_attachments (owner or staff)"
  ON public.lead_attachments
  FOR INSERT TO authenticated
  WITH CHECK (private.is_lead_staff() OR private.is_lead_owner(lead_id));

CREATE POLICY "update lead_attachments (owner or staff)"
  ON public.lead_attachments
  FOR UPDATE TO authenticated
  USING (private.is_lead_staff() OR private.is_lead_owner(lead_id))
  WITH CHECK (private.is_lead_staff() OR private.is_lead_owner(lead_id));

-- lead_history: tighten INSERT
DROP POLICY IF EXISTS "auth insert lead_history" ON public.lead_history;
CREATE POLICY "insert lead_history (owner or staff)"
  ON public.lead_history
  FOR INSERT TO authenticated
  WITH CHECK (private.is_lead_staff() OR private.is_lead_owner(lead_id));

-- lead_comments: tighten INSERT
DROP POLICY IF EXISTS "auth insert lead_comments" ON public.lead_comments;
CREATE POLICY "insert lead_comments (owner or staff)"
  ON public.lead_comments
  FOR INSERT TO authenticated
  WITH CHECK (private.is_lead_staff() OR private.is_lead_owner(lead_id));
