-- =============================================================================
-- 0224 — CCA comenta em negócio de que não participa; corretor de fora não.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  dono uuid := '00000000-0000-0000-0000-000002240001';
  cca  uuid := '00000000-0000-0000-0000-000002240002';
  fora uuid := '00000000-0000-0000-0000-000002240003';
  v_deal uuid;
  v_ok boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dono, 'dono@c224.test', '{"full_name":"Dono 224"}'),
    (cca,  'cca@c224.test',  '{"full_name":"CCA 224"}'),
    (fora, 'fora@c224.test', '{"full_name":"Fora 224"}');
  insert into public.user_roles (profile_id, role) values (dono, 'broker'), (cca, 'cca'), (fora, 'broker')
    on conflict do nothing;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), dono) returning id into v_deal;

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  perform public.add_deal_comment(v_deal, 'STATUS: pendente de documento');
  if not exists (select 1 from public.deal_history where deal_id = v_deal and actor_id = cca and kind = 'comment') then
    raise exception 'FALHOU: o comentário da CCA não entrou';
  end if;
  raise notice '  ok  CCA comenta em negócio de que não participa';

  perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
  begin
    perform public.add_deal_comment(v_deal, 'não devia entrar');
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALHOU: corretor de fora comentou num negócio que não vê';
  end if;
  raise notice '  ok  corretor de fora continua recusado';
end;
$$;

rollback;
