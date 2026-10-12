-- 0267 — qualidade por campanha: soma gasto e funil por campanha, deixa o
-- candidato de fora e só abre para quem vê o financeiro.
\set ON_ERROR_STOP on
begin;
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002670001';
  cor uuid := '00000000-0000-0000-0000-000002670002';
  conta uuid; camp uuid; l1 uuid; l2 uuid; l3 uuid; ag_compra uuid; ag_cand uuid;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@a267.test', '{"full_name":"Admin 267"}'),
    (cor, 'cor@a267.test', '{"full_name":"Corretor 267"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  select id into conta from public.meta_ad_accounts limit 1;
  insert into public.ad_campaigns (external_id, name) values ('267000', 'Campanha 267') returning id into camp;
  insert into public.meta_campaign_insights_daily (campaign_id, day, spend, resultados) values (camp, current_date, 300, 6);

  insert into public.leads (full_name, phone, status, campaign_id, campaign_name, form_id, first_contact_at) values
    ('L267 a', '51900267001', 'queued', '267000', 'Campanha 267', 'f1', now()) returning id into l1;
  insert into public.leads (full_name, phone, status, campaign_id, campaign_name, form_id) values
    ('L267 b', '51900267002', 'queued', '267000', 'Campanha 267 (outro nome)', 'f2') returning id into l2;
  insert into public.leads (full_name, phone, status, campaign_id, campaign_name) values
    ('L267 candidato', '51900267003', 'queued', '267000', 'Campanha 267') returning id into l3;

  insert into public.sdr_agents (name, lead_de_compra) values ('A267', true) returning id into ag_compra;
  insert into public.sdr_agents (name, lead_de_compra) values ('C267', false) returning id into ag_cand;
  insert into public.sdr_conversations (lead_id, agent_id, status) values (l1, ag_compra, 'handed_off');
  insert into public.sdr_conversations (lead_id, agent_id, status) values (l3, ag_cand, 'handed_off');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.qualidade_por_campanha(30) q where q.campaign_id = '267000';
  reset role;
  if r.leads <> 2 then raise exception 'FALHOU: candidato não pode entrar na conta de leads (veio %)', r.leads; end if;
  if r.atendidos <> 1 or r.qualificados <> 1 then raise exception 'FALHOU: atendidos/qualificados errados (% / %)', r.atendidos, r.qualificados; end if;
  if r.gasto <> 300 or r.cpl <> 150 or r.custo_qualificado <> 300 then raise exception 'FALHOU: gasto/CPL errados (% / % / %)', r.gasto, r.cpl, r.custo_qualificado; end if;
  if r.nomes_distintos <> 2 or r.formularios <> 2 then raise exception 'FALHOU: atribuição suspeita não apareceu'; end if;
  if r.resultados_meta <> 6 or r.custo_resultado_meta <> 50 then raise exception 'FALHOU: resultados da Meta errados (% / %)', r.resultados_meta, r.custo_resultado_meta; end if;
  raise notice '  ok  gasto, CPL, funil, atribuição suspeita e resultados da Meta por campanha';

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.qualidade_por_campanha(30);
    raise exception 'FALHOU: corretor não pode ver a qualidade das campanhas';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  raise notice '  ok  corretor não lê';
end;
$$;
rollback;
