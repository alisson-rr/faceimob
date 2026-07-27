
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'controle@faceimob.com.br';
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'controle@faceimob.com.br', crypt('Face@12345', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Admin Faceimob"}'::jsonb,
      '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email','controle@faceimob.com.br'), 'email', v_uid::text, now(), now(), now());
  ELSE
    UPDATE auth.users SET encrypted_password = crypt('Face@12345', gen_salt('bf')), email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = v_uid;
  END IF;

  INSERT INTO public.profiles (user_id, name, email)
  VALUES (v_uid, 'Admin Faceimob', 'controle@faceimob.com.br')
  ON CONFLICT (user_id) DO NOTHING;

  DELETE FROM public.user_roles WHERE user_id = v_uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin');
END $$;
