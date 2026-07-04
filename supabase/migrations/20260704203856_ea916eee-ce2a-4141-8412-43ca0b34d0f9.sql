
-- 1) brokers: drop plaintext password + tighten SELECT
ALTER TABLE public.brokers DROP COLUMN IF EXISTS login_password_plain;

DROP POLICY IF EXISTS brokers_select_auth ON public.brokers;
CREATE POLICY brokers_select_self_or_admin ON public.brokers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Public directory function (safe columns only) for lists / dropdowns
CREATE OR REPLACE FUNCTION public.list_brokers_directory()
RETURNS TABLE (
  id uuid, name text, full_name text, avatar_url text,
  manager_id uuid, director_id uuid, active boolean,
  user_id uuid, role text, division text, entry_date date, creci text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, full_name, avatar_url, manager_id, director_id,
         active, user_id, role, division, entry_date, creci
  FROM public.brokers
  ORDER BY name;
$$;
GRANT EXECUTE ON FUNCTION public.list_brokers_directory() TO authenticated;

-- 2) allowed_ips: admin-only SELECT
DROP POLICY IF EXISTS ips_read_authenticated ON public.allowed_ips;

-- 3) distribution_windows: authenticated only
DROP POLICY IF EXISTS windows_read_all ON public.distribution_windows;
CREATE POLICY windows_read_authenticated ON public.distribution_windows
  FOR SELECT TO authenticated
  USING (true);

-- 4) storage.avatars: ownership by broker folder
DROP POLICY IF EXISTS avatars_read_auth ON storage.objects;
DROP POLICY IF EXISTS avatars_insert_auth ON storage.objects;
DROP POLICY IF EXISTS avatars_update_auth ON storage.objects;
DROP POLICY IF EXISTS avatars_delete_auth ON storage.objects;

CREATE POLICY avatars_read_auth ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY avatars_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars' AND (
      public.has_role(auth.uid(), 'admin') OR
      EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND b.id::text = (storage.foldername(name))[1]
      )
    )
  );

CREATE POLICY avatars_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      public.has_role(auth.uid(), 'admin') OR
      EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND b.id::text = (storage.foldername(name))[1]
      )
    )
  );

CREATE POLICY avatars_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      public.has_role(auth.uid(), 'admin') OR
      EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND b.id::text = (storage.foldername(name))[1]
      )
    )
  );
