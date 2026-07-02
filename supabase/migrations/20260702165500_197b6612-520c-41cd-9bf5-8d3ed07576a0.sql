DO $$
DECLARE tbl record; has_priv boolean;
BEGIN
  FOR tbl IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname='public' LOOP
    SELECT EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE grantee='authenticated' AND table_schema='public' AND table_name=tbl.relname AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) INTO has_priv;
    IF NOT has_priv THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl.relname); END IF;
    SELECT EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE grantee='service_role' AND table_schema='public' AND table_name=tbl.relname AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) INTO has_priv;
    IF NOT has_priv THEN EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl.relname); END IF;
    SELECT EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public' AND table_name=tbl.relname AND privilege_type='SELECT') INTO has_priv;
    IF NOT has_priv THEN EXECUTE format('GRANT SELECT ON public.%I TO anon', tbl.relname); END IF;
  END LOOP;
END $$;