-- =============================================================================
-- 0194 — "Novo" com corretor do CRM vai para ele, em atendimento e sem aviso;
-- "Novo" com corretor de fora fica na base.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001940001';
  cor uuid := '00000000-0000-0000-0000-000001940002';
  v jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@i194.test','{"full_name":"Admin 194"}'),
    (cor,'cor@i194.test','{"full_name":"Winnie Stefani Scapim"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin') on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := public.importar_leads_leadfy(jsonb_build_array(
    jsonb_build_object('id','n1','status','Novo','corretor','Winnie Scapim','cliente','Nova','telefone','51999194001','criado_em','2026-10-02T18:00:00-03:00'),
    jsonb_build_object('id','n2','status','Novo','corretor','Fulano de Fora','cliente','Outra','telefone','51999194002','criado_em','2026-10-02T18:05:00-03:00')
  ));
  reset role;

  perform pg_temp.ok(
    (select assigned_to = cor and status = 'attending' and funnel_stage = 'new'
       from public.leads where external_id = 'leadfy:n1'),
    'novo com corretor do CRM vai para ele, em atendimento, etapa novo');
  perform pg_temp.ok(
    (select assigned_to is null and status = 'lost' from public.leads where external_id = 'leadfy:n2'),
    'novo com corretor de fora fica na base');
  perform pg_temp.ok(
    not exists (select 1 from public.notifications where profile_id = cor),
    'o corretor não recebe aviso');
end;
$$;

rollback;
