-- 0269 — o negócio criado sem lead_id é ligado ao lead pelo telefone do
-- cliente, só quando o lead é único e anterior ao negócio; e a análise chega
-- à campanha pelo vínculo.
\set ON_ERROR_STOP on
begin;
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002690001';
  v_stg uuid; v_dev uuid;
  l1 uuid; l_dup1 uuid; l_dup2 uuid; l_tarde uuid;
  d1 uuid; d_dup uuid; d_tarde uuid; d_direto uuid;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (adm, 'adm@a269.test', '{"full_name":"Admin 269"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin') on conflict do nothing;
  select id into v_stg from public.pipeline_stages where is_initial;
  select id into v_dev from public.developers limit 1;

  insert into public.leads (full_name, phone, status, campaign_id, campaign_name, created_at)
  values ('L269 unico', '51 90026-9001', 'queued', '269000', 'Campanha 269', now() - interval '2 days') returning id into l1;
  insert into public.leads (full_name, phone, status, created_at) values ('L269 dup a', '51900269002', 'queued', now() - interval '3 days') returning id into l_dup1;
  insert into public.leads (full_name, phone, status, created_at) values ('L269 dup b', '(51) 90026-9002', 'queued', now() - interval '1 days') returning id into l_dup2;

  insert into public.deals (developer_id, stage_id) values (v_dev, v_stg) returning id into d1;
  insert into public.deal_clients (deal_id, ordinal, full_name, phone) values (d1, 1, 'Cliente 1', '(51) 90026-9001');
  insert into public.deals (developer_id, stage_id) values (v_dev, v_stg) returning id into d_dup;
  insert into public.deal_clients (deal_id, ordinal, full_name, phone) values (d_dup, 1, 'Cliente dup', '51900269002');

  insert into public.deals (developer_id, stage_id) values (v_dev, v_stg) returning id into d_tarde;
  insert into public.leads (full_name, phone, status) values ('L269 tarde', '51900269003', 'queued') returning id into l_tarde;
  update public.leads set created_at = now() + interval '1 day' where id = l_tarde;
  insert into public.deal_clients (deal_id, ordinal, full_name, phone) values (d_tarde, 1, 'Cliente tarde', '51900269003');

  insert into public.deals (developer_id, stage_id, lead_id) values (v_dev, v_stg, l1) returning id into d_direto;
  insert into public.deal_clients (deal_id, ordinal, full_name, phone) values (d_direto, 1, 'Cliente direto', '51900269001');

  if (select lead_id from public.deal_lead_links where deal_id = d1) is distinct from l1 then
    raise exception 'FALHOU: telefone único devia ligar o negócio ao lead (mesmo com máscara diferente)';
  end if;
  raise notice '  ok  telefone único liga negócio e lead';

  if exists (select 1 from public.deal_lead_links where deal_id = d_dup) then
    raise exception 'FALHOU: telefone de dois leads não pode ligar';
  end if;
  if exists (select 1 from public.deal_lead_links where deal_id = d_tarde) then
    raise exception 'FALHOU: lead criado depois do negócio não pode ligar';
  end if;
  if exists (select 1 from public.deal_lead_links where deal_id = d_direto) then
    raise exception 'FALHOU: negócio com lead_id não precisa de vínculo';
  end if;
  raise notice '  ok  ambíguo, posterior e já ligado ficam sem vínculo';

  -- A análise do negócio ligado chega à campanha do lead.
  insert into public.deal_status_history (deal_id, to_status) values (d1, 'ESTEIRA AGIL');
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.qualidade_por_campanha(30) q where q.campaign_id = '269000';
  reset role;
  if r.em_analise <> 1 then raise exception 'FALHOU: a análise do negócio ligado devia contar na campanha (veio %)', r.em_analise; end if;
  raise notice '  ok  análise do negócio ligado conta na campanha';
end;
$$;
rollback;
