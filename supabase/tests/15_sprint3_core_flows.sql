\set ON_ERROR_STOP on

create or replace function pg_temp.check15(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  sdr_id uuid := '00000000-0000-0000-0000-00000000f301';
  marketing_id uuid := '00000000-0000-0000-0000-00000000f302';
  broker_id uuid := '00000000-0000-0000-0000-00000000f303';
  template_id uuid;
  v_list_id uuid;
  campaign text := 'campanha-sprint3-sql';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (sdr_id, 'sdr@sprint3.test', '{"full_name":"SDR Sprint 3"}'),
    (marketing_id, 'marketing@sprint3.test', '{"full_name":"Marketing Sprint 3"}'),
    (broker_id, 'broker@sprint3.test', '{"full_name":"Broker Sprint 3"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (sdr_id, 'sdr'), (marketing_id, 'marketing'), (broker_id, 'broker')
  on conflict do nothing;

  insert into public.whatsapp_templates (name, body, approved)
  values ('template_sprint3_sql', 'Olá {{1}}', true)
  returning id into template_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  insert into public.lead_sources (code, label, sdr_agent_id, welcome_template_id)
  values ('origem_sprint3_sql', 'Origem Sprint 3', null, template_id);
  perform pg_temp.check15(
    exists (select 1 from public.lead_sources where code = 'origem_sprint3_sql' and welcome_template_id = template_id),
    'SDR cadastra origem e vincula template existente');

  v_list_id := public.import_remarketing_list(
    'Lista Sprint 3 SQL', template_id, null,
    '[{"full_name":"Contato","phone":"(11) 98888-7777","extra":{"campaign":"SQL"}}]'::jsonb
  );
  perform pg_temp.check15(
    exists (select 1 from public.remarketing_contacts where list_id = v_list_id and phone = '5511988887777'),
    'importação válida cria lista e contato normalizado');

  begin
    perform public.import_remarketing_list(
      'Lista Órfã Sprint 3 SQL', template_id, null,
      '[{"full_name":"Inválido","phone":"abc","extra":{}}]'::jsonb
    );
    raise exception 'FALHOU: telefone inválido deveria abortar a importação';
  exception when raise_exception then
    if sqlerrm like 'FALHOU:%' then raise; end if;
  end;
  perform pg_temp.check15(
    not exists (select 1 from public.remarketing_lists where name = 'Lista Órfã Sprint 3 SQL'),
    'falha de contato desfaz também a lista');

  reset role;
  insert into public.ad_campaigns (external_id, platform, name)
  values (campaign, 'meta', 'Campanha Sprint 3 SQL');
  insert into public.leads (full_name, phone, campaign_id, assigned_to)
  values ('Lead distribuído Sprint 3', '11911112222', campaign, broker_id);

  perform set_config('request.jwt.claims',
    json_build_object('sub', marketing_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform pg_temp.check15(
    exists (select 1 from public.marketing_campaign_stats() s where s.campaign_id = campaign and s.leads = 1),
    'marketing conta lead mesmo depois da distribuição');

  perform set_config('request.jwt.claims',
    json_build_object('sub', broker_id::text, 'role', 'authenticated')::text, false);
  begin
    perform public.marketing_campaign_stats();
    raise exception 'FALHOU: broker leu métricas globais de marketing';
  exception when insufficient_privilege then
    raise notice '  ok  broker não acessa métricas globais de marketing';
  end;

  reset role;
end;
$$;

\echo 'fluxos centrais da Sprint 3 ok'
