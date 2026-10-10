-- =============================================================================
-- 0257 — campanhas de WhatsApp listadas pelo nome, com o agente da origem.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002570001';
  cor uuid := '00000000-0000-0000-0000-000002570002';
  v_agente uuid;
  v_ok boolean;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c257.test', '{"full_name":"Admin 257"}'),
    (cor, 'cor@c257.test', '{"full_name":"Corretor 257"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;
  insert into public.ad_campaigns (external_id, platform, name, total_spend, meta_channel, meta_effective_status) values
    ('c257-wa', 'meta', 'WHATS APROVA 257', 0, 'whatsapp', 'ACTIVE'),
    ('c257-form', 'meta', 'FORM 257', 0, 'formulario', 'ACTIVE');
  insert into public.sdr_agents (name, system_prompt) values ('Agente 257', 'teste') returning id into v_agente;
  insert into public.lead_sources (code, label, channel, active, sdr_agent_id, campaign_external_id)
    values ('wa_campanha_c257-wa', 'WhatsApp · WHATS APROVA 257', 'whatsapp', true, v_agente, 'c257-wa');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select * into r from public.campanhas_whatsapp() where external_id like 'c257%';
  if r.external_id <> 'c257-wa' or r.sdr_agent_id is distinct from v_agente or r.name <> 'WHATS APROVA 257' then
    raise exception 'FALHOU: campanha de WhatsApp devia vir com o agente da origem (%)', row_to_json(r);
  end if;
  if exists (select 1 from public.campanhas_whatsapp() where external_id = 'c257-form') then
    raise exception 'FALHOU: campanha de formulário não entra na lista';
  end if;
  raise notice '  ok  só campanhas de WhatsApp, com o agente ligado';

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.campanhas_whatsapp();
    v_ok := true;
  exception when sqlstate '42501' then
    v_ok := false;
  end;
  if v_ok then raise exception 'FALHOU: corretor não lê a lista de campanhas'; end if;
  raise notice '  ok  corretor não lê as campanhas';
end;
$$;

rollback;
