
-- 1) Brokers SELECT tightening
DROP POLICY IF EXISTS brokers_select_auth ON public.brokers;
CREATE POLICY brokers_select_own_or_privileged ON public.brokers
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::app_role)
    OR private.has_role(auth.uid(), 'director'::app_role)
    OR private.has_role(auth.uid(), 'manager'::app_role)
  );

-- Wipe stored plaintext passwords (column stays for compatibility, already column-level revoked)
UPDATE public.brokers SET login_password_plain = NULL WHERE login_password_plain IS NOT NULL;

-- 2) Fix avatars storage policies to reference the object path, not broker.name
DROP POLICY IF EXISTS avatars_insert_own ON storage.objects;
DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;

CREATE POLICY avatars_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      private.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
      )
    )
  );

CREATE POLICY avatars_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      private.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
      )
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      private.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
      )
    )
  );

CREATE POLICY avatars_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      private.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.brokers b
        WHERE b.user_id = auth.uid()
          AND (b.id)::text = (storage.foldername(storage.objects.name))[1]
      )
    )
  );

-- 3) Lock down SECURITY DEFINER functions with PUBLIC EXECUTE
REVOKE EXECUTE ON FUNCTION public.get_broker_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broker_private(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_daily_team_report(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_team_report(uuid, date) TO authenticated;
