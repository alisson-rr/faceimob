
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS login_password_plain text;
REVOKE SELECT (login_password_plain) ON public.brokers FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.get_broker_private(uuid);

CREATE FUNCTION public.get_broker_private(_id uuid)
RETURNS TABLE (
  id uuid, cpf text, birth_date date, address text, phone text, celular text,
  email text, login_email text, login_provisioned_at timestamptz,
  login_email_confirmed boolean, login_password_plain text
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
           b.email, b.login_email, b.login_provisioned_at, b.login_email_confirmed,
           b.login_password_plain
    FROM public.brokers b WHERE b.id = _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_broker_private(uuid) TO authenticated;
