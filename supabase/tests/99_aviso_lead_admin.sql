-- =============================================================================
-- 0176 — admin avisado de todo lead que chega; desliga por preferência.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000017601', 'ana@v0176.test', '{"full_name":"Ana Admin 0176"}'),
  ('00000000-0000-0000-0000-000000017602', 'sol@v0176.test', '{"full_name":"Sol Sócia 0176"}'),
  ('00000000-0000-0000-0000-000000017603', 'caio@v0176.test', '{"full_name":"Caio Corretor 0176"}')
on conflict do nothing;
insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000017601', 'admin'),
  ('00000000-0000-0000-0000-000000017602', 'partner'),
  ('00000000-0000-0000-0000-000000017603', 'broker')
on conflict do nothing;
-- A sócia desligou o aviso.
insert into public.push_preferences (profile_id, category, enabled)
values ('00000000-0000-0000-0000-000000017602', 'lead_geral', false);

-- Lead que chega sozinho (webhook, site): sem sessão de usuário.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.leads (id, full_name, phone, status, funnel_stage, utm_source)
values ('00000000-0000-0000-0000-0000000176c1', 'Lia Chegou', '51999990180', 'queued', 'new', 'meta');
set constraints leads_avisa_admin immediate;

do $$
begin
  perform pg_temp.ok(exists (
      select 1 from public.notifications
       where profile_id = '00000000-0000-0000-0000-000000017601' and kind = 'lead_new_admin'
         and title = 'Novo lead: Lia Chegou' and link = '/leads?lead=00000000-0000-0000-0000-0000000176c1'),
    'admin avisado do lead que chegou');
  perform pg_temp.ok(
    (select body from public.notifications
      where profile_id = '00000000-0000-0000-0000-000000017601' and kind = 'lead_new_admin'
        and link like '%176c1') = 'meta · está na fila da roleta',
    'aviso diz a origem e para onde o lead foi');
  perform pg_temp.ok(not exists (
      select 1 from public.notifications
       where profile_id = '00000000-0000-0000-0000-000000017602' and kind = 'lead_new_admin'),
    'quem desligou não recebe');
  perform pg_temp.ok(not exists (
      select 1 from public.notifications
       where profile_id = '00000000-0000-0000-0000-000000017603' and kind = 'lead_new_admin'),
    'corretor não recebe o aviso de admin');
end
$$;

-- Lead cadastrado ou importado por alguém logado não avisa.
set constraints leads_avisa_admin deferred;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-000000017601', 'role', 'authenticated')::text, true);
insert into public.leads (id, full_name, phone, status, funnel_stage)
values ('00000000-0000-0000-0000-0000000176c2', 'Importado Planilha', '51999990181', 'queued', 'new');
set constraints leads_avisa_admin immediate;
do $$
begin
  perform pg_temp.ok(not exists (
      select 1 from public.notifications where kind = 'lead_new_admin' and link like '%176c2'),
    'importação e cadastro manual não avisam');
end
$$;

rollback;
