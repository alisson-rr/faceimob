-- =============================================================================
-- 0209 — Central do Corretor: o menu existe e vale para todo papel; o corretor
-- lê os atalhos e os documentos do site pelo CRM, e não escreve neles.
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
  cor uuid := '00000000-0000-0000-0000-000002090001';
  n int;
  negado boolean := false;
begin
  perform pg_temp.ok(not exists (
    select 1 from unnest(enum_range(null::public.app_role)) r
     where not exists (select 1 from public.role_permissions rp
                        where rp.role = r and rp.permission = 'menu.central' and rp.allowed)),
    'todo papel tem a Central do Corretor');

  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c209.test', '{"full_name":"Corretor 209"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into site.broker_links (key, label, url, active, sort_order)
  values ('c209', 'Atalho 209', 'https://exemplo.test', true, 999);
  insert into site.support_documents (title, active, sort_order) values ('Doc 209', true, 999), ('Oculto 209', false, 999);

  perform set_config('request.jwt.claims', json_build_object('sub', cor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok(public.has_permission('menu.central'), 'o corretor tem o menu');
  perform pg_temp.ok(exists (select 1 from site.broker_links where key = 'c209'), 'o corretor lê os atalhos');
  -- A policy do site (0169) não filtra `active`: quem esconde o oculto é a tela.
  select count(*) into n from site.support_documents where title = 'Doc 209';
  perform pg_temp.ok(n = 1, 'o corretor lê os documentos de suporte');
  begin
    insert into site.support_documents (title, active, sort_order) values ('Forjado 209', true, 1);
  exception when insufficient_privilege then negado := true;
  end;
  reset role;
  perform pg_temp.ok(negado, 'o corretor não cadastra documento');
end;
$$;

rollback;
