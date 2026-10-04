-- =============================================================================
-- 0222 — o aviso de lead novo traz a campanha.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002220001';
  cor uuid := '00000000-0000-0000-0000-000002220002';
  v_lead uuid;
  v_corpo text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c222.test', '{"full_name":"Admin 222"}'),
    (cor, 'cor@c222.test', '{"full_name":"Corretor 222"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;
  perform set_config('request.jwt.claims', '', true);

  insert into public.leads (full_name, phone, campaign_name, utm_source)
  values ('Lead Campanha 222', '11900222001', 'Solar do Bosque', 'meta') returning id into v_lead;
  set constraints all immediate;

  select body into v_corpo from public.notifications
   where profile_id = adm and kind = 'lead_new_admin' and link = '/leads?lead=' || v_lead;
  if v_corpo not like '%Solar do Bosque%' then
    raise exception 'FALHOU: aviso do admin sem a campanha (%)', v_corpo;
  end if;
  raise notice '  ok  aviso do admin traz a campanha: %', v_corpo;

  insert into public.lead_assignments (lead_id, profile_id, sequence, deadline)
  values (v_lead, cor, 1, now() + interval '10 minutes');
  select body into v_corpo from public.notifications
   where profile_id = cor and kind = 'lead_assigned' and channel = 'in_app' and link = '/leads?lead=' || v_lead;
  if v_corpo not like 'Solar do Bosque · Você tem até%' then
    raise exception 'FALHOU: aviso do corretor sem a campanha (%)', v_corpo;
  end if;
  raise notice '  ok  aviso do corretor traz a campanha: %', v_corpo;
end;
$$;

rollback;
