-- =============================================================================
-- 0246 — gerente/diretor não recebe a chegada global; recebe a própria vez.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok246(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  v_admin uuid := '00000000-0000-0000-0000-000000024601';
  v_lider uuid := '00000000-0000-0000-0000-000000024602';
  v_lead  uuid := '00000000-0000-0000-0000-000000024603';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_admin, 'admin@v0246.test', '{"full_name":"Admin 0246"}'),
    (v_lider, 'lider@v0246.test', '{"full_name":"Líder 0246"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (v_admin, 'admin'),
    (v_lider, 'admin'),
    (v_lider, 'manager'),
    (v_lider, 'director')
  on conflict do nothing;

  -- Simula chegada automática pelo webhook, sem usuário autenticado.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.leads (id, full_name, phone, status, funnel_stage, utm_source)
  values (v_lead, 'Lead 0246', '51999992460', 'queued', 'new', 'meta');
  set constraints leads_avisa_admin immediate;

  perform pg_temp.ok246(exists (
    select 1 from public.notifications
     where profile_id = v_admin and kind = 'lead_new_admin'
       and link = '/leads?lead=' || v_lead),
    'administrador sem papel de liderança mantém o aviso global');
  perform pg_temp.ok246(not exists (
    select 1 from public.notifications
     where profile_id = v_lider and kind = 'lead_new_admin'
       and link = '/leads?lead=' || v_lead),
    'gerente/diretor não recebe o aviso global mesmo acumulando admin');

  -- Quando chega a vez da liderança na roleta, o produtor pessoal continua
  -- gravando os canais in-app e WhatsApp diretamente para ela.
  insert into public.lead_assignments (lead_id, profile_id, deadline)
  values (v_lead, v_lider, now() + interval '5 minutes');
  perform pg_temp.ok246(
    (select count(*) = 2 from public.notifications
      where profile_id = v_lider and kind = 'lead_assigned'
        and link = '/leads?lead=' || v_lead),
    'liderança recebe os dois avisos somente quando o lead cai para ela');

  insert into public.notifications (profile_id, kind, title, link) values
    (v_admin, 'lead_unattended', 'Lead sem atendimento', '/leads?lead=' || v_lead),
    (v_lider, 'lead_unattended', 'Lead sem atendimento', '/leads?lead=' || v_lead);
  perform pg_temp.ok246(exists (
    select 1 from public.notifications
     where profile_id = v_admin and kind = 'lead_unattended'
       and link = '/leads?lead=' || v_lead),
    'administrador mantém o aviso da bandeja global');
  perform pg_temp.ok246(not exists (
    select 1 from public.notifications
     where profile_id = v_lider and kind = 'lead_unattended'
       and link = '/leads?lead=' || v_lead),
    'liderança também não recebe alerta global de lead sem atendimento');
end;
$$;

rollback;
