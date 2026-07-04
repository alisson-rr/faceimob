
DO $$ BEGIN
  CREATE POLICY "avatars_read_auth" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars_insert_auth" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars_update_auth" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars_delete_auth" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
