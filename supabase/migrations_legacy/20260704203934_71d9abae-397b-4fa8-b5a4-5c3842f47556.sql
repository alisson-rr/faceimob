
-- Relax row policy: all authenticated can read brokers (needed for FK joins / directory)
DROP POLICY IF EXISTS brokers_select_self_or_admin ON public.brokers;
CREATE POLICY brokers_select_auth ON public.brokers
  FOR SELECT TO authenticated
  USING (true);

-- Revoke sensitive columns from broad roles
REVOKE SELECT (cpf, birth_date, address, phone, celular, email,
               login_email, login_provisioned_at, login_email_confirmed)
  ON public.brokers FROM anon, authenticated;

-- Ensure basic/safe columns remain granted to authenticated
GRANT SELECT (id, name, full_name, avatar_url, manager_id, director_id,
              active, user_id, role, division, entry_date, creci, habilitation,
              indication, badge_requested, badge_requested_at, badge_delivered_at,
              created_at, updated_at)
  ON public.brokers TO authenticated;

-- Admin/self access to sensitive fields via secure function
CREATE OR REPLACE FUNCTION public.get_broker_private(_id uuid)
RETURNS TABLE (
  id uuid, cpf text, birth_date date, address text, phone text, celular text,
  email text, login_email text, login_provisioned_at timestamptz,
  login_email_confirmed boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.get_broker_private(uuid) TO authenticated;

-- list_brokers_directory not needed anymore (columns are directly grantable)
DROP FUNCTION IF EXISTS public.list_brokers_directory();
