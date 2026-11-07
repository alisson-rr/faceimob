-- =============================================================================
-- 0288 — eventos do CRM para a Meta: só lead do Lead Ads, uma vez por etapa.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor     uuid := '00000000-0000-0000-0000-000002880001';
  v_meta  uuid;
  v_site  uuid;
  v_deal  uuid;
  v_wa    uuid;
  v_n     int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c288.test', '{"full_name":"Corretor 288"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.leads (full_name, phone, assigned_to, status, external_id)
    values ('Lead Meta 288', '5551999992881', cor, 'assigned', '1234567890123456') returning id into v_meta;
  insert into public.leads (full_name, phone, assigned_to, status)
    values ('Lead Site 288', '5551999992882', cor, 'assigned') returning id into v_site;

  -- Lead atendido: entra uma vez, só o da Meta.
  update public.leads set first_contact_at = now() where id in (v_meta, v_site);
  update public.leads set first_contact_at = null where id = v_meta;
  update public.leads set first_contact_at = now() where id = v_meta;
  select count(*) into v_n from public.meta_crm_events where event_name = 'Lead atendido' and lead_id in (v_meta, v_site);
  if v_n <> 1 then raise exception 'FALHOU: "Lead atendido" deveria entrar uma vez e só para o lead da Meta (veio %)', v_n; end if;
  raise notice '  ok  lead atendido uma vez, só do Lead Ads';

  -- Virou negócio pelo negócio ligado ao lead.
  insert into public.deals (stage_id, created_by, status_detail, lead_id)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'EM CONTRATO', v_meta)
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    values (v_deal, cor, 'broker', 1) on conflict do nothing;
  update public.deals set status_detail = 'VIROU NEGÓCIO' where id = v_deal;
  if not exists (select 1 from public.meta_crm_events where lead_id = v_meta and event_name = 'Virou negócio') then
    raise exception 'FALHOU: "Virou negócio" deveria entrar na fila';
  end if;
  raise notice '  ok  virou negócio enfileirado pelo lead do negócio';

  -- Reserva conta a tentativa e devolve o leadgen_id.
  if not exists (select 1 from public.meta_crm_reservar(10) r where r.leadgen_id = '1234567890123456') then
    raise exception 'FALHOU: a reserva deveria devolver o leadgen_id';
  end if;
  if exists (select 1 from public.meta_crm_events where lead_id = v_meta and attempts <> 1) then
    raise exception 'FALHOU: a reserva deveria contar uma tentativa';
  end if;
  raise notice '  ok  reserva devolve o lead e conta a tentativa';

  -- 0322 · LeadConfirmado: entra ao chegar em "Interesse confirmado" (ou
  -- depois dele), uma vez só, para Lead Ads e clique-para-WhatsApp com ctwa_clid.
  insert into public.leads (full_name, phone, assigned_to, status, raw_payload)
    values ('Lead WA 322', '5551999993221', cor, 'assigned',
            '{"whatsapp_anuncio":{"adId":"1","ctwaClid":"ARAkTeste322"}}') returning id into v_wa;
  update public.leads set funnel_stage = 'warm' where id in (v_meta, v_site, v_wa);
  if exists (select 1 from public.meta_crm_events where event_name = 'LeadConfirmado') then
    raise exception 'FALHOU: "Interesse inicial" não deveria enfileirar LeadConfirmado';
  end if;
  update public.leads set funnel_stage = 'hot' where id in (v_meta, v_site, v_wa);
  update public.leads set funnel_stage = 'warm' where id = v_meta;
  update public.leads set funnel_stage = 'scheduled_visit' where id = v_meta;
  select count(*) into v_n from public.meta_crm_events where event_name = 'LeadConfirmado';
  if v_n <> 2 then raise exception 'FALHOU: LeadConfirmado deveria entrar uma vez para o lead da Meta e uma para o do WhatsApp (veio %)', v_n; end if;
  if exists (select 1 from public.meta_crm_events where event_name = 'LeadConfirmado' and lead_id = v_site) then
    raise exception 'FALHOU: lead sem leadgen_id nem ctwa_clid não deveria entrar';
  end if;
  if exists (select 1 from public.meta_crm_events where lead_id = v_wa and event_name <> 'LeadConfirmado') then
    raise exception 'FALHOU: as etapas antigas continuam só do Lead Ads';
  end if;
  raise notice '  ok  LeadConfirmado uma vez, Lead Ads e WhatsApp com ctwa_clid';

  if not exists (select 1 from public.meta_crm_reservar(10) r where r.ctwa_clid = 'ARAkTeste322') then
    raise exception 'FALHOU: a reserva deveria devolver o ctwa_clid';
  end if;
  raise notice '  ok  reserva devolve o ctwa_clid';

  -- Usuário comum não lê a fila.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.meta_crm_events;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FALHOU: corretor não deveria ler a fila da Meta'; end if;
  raise notice '  ok  fila só para o admin';
end;
$$;

rollback;
