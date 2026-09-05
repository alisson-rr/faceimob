-- =============================================================================
-- Regressão da 0063 — resumo por construtora, ROAS e as travas de formato.
--
-- O que este arquivo prova, na ordem em que a 0063 justifica:
--   1. o CCA (que `developers_write` já autoriza) enxerga `menu.admin_developers`,
--      e marketing/CCA/SDR passam a ter `menu.links`;
--   2. gasto negativo, id externo de campanha repetido (0067), e-mail torto e
--      URL relativa param no banco, não na tela;
--   3. `marketing_campaign_stats` devolve receita ATRIBUÍDA (negócio ganho,
--      contado uma vez mesmo com dois leads apontando para ele);
--   4. `marketing_developer_summary` agrupa por `developers.id`, mantém a
--      construtora desativada e — o defeito que mais custa — NÃO PERDE LINHA:
--      a soma por construtora bate com o total da empresa, porque negócio sem
--      construtora e lead de campanha não cadastrada caem no balde nulo;
--   5. o recorte de mês vale para aporte/negócio e NÃO para o gasto de campanha
--      (que é acumulado), que é o motivo de os dois números nunca serem somados;
--   6. papel sem `reports.view_finance` leva 42501 em vez de tabela vazia.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check63(cond boolean, label text)
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

create or replace function pg_temp.become63(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres, ignorando RLS)
--
--   Adão = admin · Ciro = CCA · Mila = marketing · Caio = corretor
--   Construtora A (ativa) e Construtora B (desativada)
--   Campanha A (R$ 1.000, ligada a A) e campanha órfã (R$ 500, sem construtora)
--   2 leads da campanha A — um convertido num negócio GANHO de R$ 200.000
--   1 lead de campanha fantasma + 1 lead sem campanha → balde "Sem construtora"
-- -----------------------------------------------------------------------------
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000006301';
  cca1 uuid := '00000000-0000-0000-0000-000000006302';
  mkt  uuid := '00000000-0000-0000-0000-000000006303';
  cor  uuid := '00000000-0000-0000-0000-000000006304';
  devA uuid;
  devB uuid;
  v_stage uuid;
  v_deal uuid;
  v_lead uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adao@mkt63.test',  '{"full_name":"Adão Admin 63"}'),
    (cca1, 'ciro@mkt63.test',  '{"full_name":"Ciro CCA 63"}'),
    (mkt,  'mila@mkt63.test',  '{"full_name":"Mila Marketing 63"}'),
    (cor,  'caio@mkt63.test',  '{"full_name":"Caio Corretor 63"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cca1, 'cca'), (mkt, 'marketing')
  on conflict do nothing;

  insert into public.developers (name, slug) values ('Construtora A 0063', 'construtora-a-0063')
  returning id into devA;
  insert into public.developers (name, slug, active) values ('Construtora B 0063', 'construtora-b-0063', false)
  returning id into devB;

  insert into public.ad_campaigns (external_id, platform, name, developer_id, total_spend)
  values ('camp-0063-a', 'meta', 'Campanha A 0063', devA, 1000);
  insert into public.ad_campaigns (external_id, platform, name, total_spend)
  values ('camp-0063-orfa', 'google', 'Campanha órfã 0063', 500);

  insert into public.marketing_investments (developer_id, period, amount) values
    (devA, '2026-01-01', 5000),
    (devA, '2026-02-01', 7000);

  -- Mês fechado barraria o insert do negócio; nenhum outro teste depende deste.
  delete from public.closed_months where period = date '2026-01-01';
  select id into v_stage from public.pipeline_stages where code = 'proposal';

  insert into public.deals (stage_id, created_by, developer_id, month_base, outcome, vgv_gross, vgv_net)
  values (v_stage, cor, devA, '2026-01-01', 'won', 200000, 200000)
  returning id into v_deal;

  insert into public.leads (full_name, phone, campaign_id, converted_deal_id)
  values ('Lead convertido 0063', '11966660631', 'camp-0063-a', v_deal)
  returning id into v_lead;
  -- Segundo lead no MESMO negócio: a receita não pode contar 400.000.
  insert into public.leads (full_name, phone, campaign_id, converted_deal_id)
  values ('Lead irmão 0063', '11966660632', 'camp-0063-a', v_deal);
  insert into public.leads (full_name, phone, campaign_id) values
    ('Lead fantasma 0063', '11966660633', 'camp-0063-fantasma');
  insert into public.leads (full_name, phone) values ('Lead sem campanha 0063', '11966660634');
end
$$;

\echo '== 1. menu: quem o banco autoriza a escrever agora tem porta de entrada =='

do $$
declare
  cca1 uuid := '00000000-0000-0000-0000-000000006302';
  mkt  uuid := '00000000-0000-0000-0000-000000006303';
begin
  set role authenticated;
  perform pg_temp.become63(cca1);
  perform pg_temp.check63(public.has_permission('menu.admin_developers'),
    'CCA abre /admin/developers (developers_write já o autorizava a escrever)');
  perform pg_temp.check63(public.has_permission('menu.links'), 'CCA vê /links');

  perform pg_temp.become63(mkt);
  perform pg_temp.check63(public.has_permission('menu.links'), 'marketing vê /links');
  perform pg_temp.check63(
    exists (select 1 from public.role_permissions
             where role = 'sdr' and permission = 'menu.links' and allowed),
    'SDR vê /links');
  reset role;
end
$$;

\echo '== 2. formato e piso: o banco recusa o que a tela não deve gravar =='

do $$
declare
  n int;
begin
  begin
    insert into public.ad_campaigns (external_id, platform, name, total_spend)
    values ('camp-0063-negativa', 'meta', 'Negativa 0063', -500);
    raise exception 'FALHOU: ad_campaigns aceitou total_spend negativo';
  exception
    when check_violation then
      raise notice '  ok  total_spend negativo recusado (CPL negativo era possível)';
  end;

  -- 0067: `leads.campaign_id` não carrega plataforma, então o mesmo id externo
  -- em duas plataformas faria cada lead casar com duas campanhas — a soma por
  -- construtora ficaria maior que o total da empresa (o assert do bloco 4).
  begin
    insert into public.ad_campaigns (external_id, platform, name, total_spend)
    values ('camp-0063-a', 'google', 'Duplicata 0063', 100);
    raise exception 'FALHOU: ad_campaigns aceitou o mesmo id externo em outra plataforma';
  exception
    when unique_violation then
      raise notice '  ok  id externo repetido recusado (o lead seria contado duas vezes)';
  end;

  begin
    update public.developers set submission_email = 'sem-arroba'
     where slug = 'construtora-a-0063';
    raise exception 'FALHOU: developers aceitou e-mail sem arroba';
  exception
    when check_violation then
      raise notice '  ok  e-mail torto recusado (o dossiê sairia para o vazio)';
  end;

  update public.developers set submission_email = 'credito@construtora-a.test'
   where slug = 'construtora-a-0063';
  get diagnostics n = row_count;
  perform pg_temp.check63(n = 1, 'e-mail bem formado continua entrando');

  begin
    insert into public.useful_links (label, url) values ('Link torto 0063', 'banana');
    raise exception 'FALHOU: useful_links aceitou URL relativa';
  exception
    when check_violation then
      raise notice '  ok  URL sem http(s) recusada (o card virava rota interna)';
  end;

  insert into public.useful_links (label, url) values ('Link bom 0063', 'https://exemplo.test/doc');
  perform pg_temp.check63(true, 'URL absoluta continua entrando');
end
$$;

\echo '== 3. receita atribuída por campanha (a base do ROAS) =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000006301';
  r record;
begin
  set role authenticated;
  perform pg_temp.become63(adm);

  select * into r from public.marketing_campaign_stats() s
   where s.campaign_id = 'camp-0063-a';
  perform pg_temp.check63(r.leads = 2, format('a campanha conta os 2 leads (tem %s)', r.leads));
  perform pg_temp.check63(r.conversions = 2, 'os dois leads apontam para negócio');
  perform pg_temp.check63(r.revenue = 200000,
    format('a receita conta o negócio UMA vez, não uma por lead (tem %s)', r.revenue));

  select * into r from public.marketing_campaign_stats() s
   where s.campaign_id = 'camp-0063-fantasma';
  perform pg_temp.check63(r.campaign_id is not null,
    'lead de campanha não cadastrada aparece na estatística (é o alerta da tela)');
  perform pg_temp.check63(coalesce(r.revenue, 0) = 0, 'campanha fantasma não inventa receita');
  reset role;
end
$$;

\echo '== 4. resumo por construtora: agrupa por id e não perde linha =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000006301';
  devA uuid;
  r record;
  soma_leads int;
  soma_deals int;
  soma_aporte numeric;
  total_leads int;
  total_deals int;
  total_aporte numeric;
begin
  reset role;
  select id into devA from public.developers where slug = 'construtora-a-0063';
  select count(*)::int into total_leads from public.leads;
  select count(*)::int into total_deals from public.deals;
  select coalesce(sum(amount), 0) into total_aporte from public.marketing_investments;

  set role authenticated;
  perform pg_temp.become63(adm);

  select * into r from public.marketing_developer_summary() s where s.developer_id = devA;
  perform pg_temp.check63(r.investment = 12000, format('aporte acumulado da A = 5.000 + 7.000 (tem %s)', r.investment));
  perform pg_temp.check63(r.campaign_spend = 1000, 'gasto de campanha da A');
  perform pg_temp.check63(r.leads = 2, format('leads chegam pela campanha da construtora (tem %s)', r.leads));
  perform pg_temp.check63(r.sales = 1 and r.vgv = 200000, 'venda e VGV da A');

  -- A soma por construtora tem de bater com a empresa: é o que o balde
  -- "Sem construtora" garante. Sem ele, negócio sem construtora e lead de
  -- campanha não cadastrada sumiriam do resumo sem deixar rastro.
  select sum(s.leads)::int, sum(s.deals)::int, sum(s.investment)
    into soma_leads, soma_deals, soma_aporte
    from public.marketing_developer_summary() s;
  perform pg_temp.check63(soma_leads = total_leads,
    format('nenhum lead some do resumo (%s de %s)', soma_leads, total_leads));
  perform pg_temp.check63(soma_deals = total_deals,
    format('nenhum negócio some do resumo (%s de %s)', soma_deals, total_deals));
  perform pg_temp.check63(soma_aporte = total_aporte, 'nenhum aporte some do resumo');

  perform pg_temp.check63(
    exists (select 1 from public.marketing_developer_summary() s
             where s.developer_id is null and s.developer_name = 'Sem construtora'),
    'o balde "Sem construtora" existe e é nomeado');

  perform pg_temp.check63(
    exists (select 1 from public.marketing_developer_summary() s
             where s.developer_name = 'Construtora B 0063' and not s.active),
    'construtora desativada continua no resumo, marcada como inativa');

  -- Renomear é o teste do agrupamento por id: por nome, viravam duas linhas.
  reset role;
  update public.developers set name = 'Construtora A 0063 renomeada' where id = devA;
  set role authenticated;
  perform pg_temp.become63(adm);
  select count(*)::int into soma_leads from public.marketing_developer_summary() s
   where s.developer_id = devA;
  perform pg_temp.check63(soma_leads = 1, 'construtora renomeada continua sendo UMA linha');
  reset role;
end
$$;

\echo '== 5. recorte de mês: vale para o aporte, não para o gasto acumulado =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000006301';
  devA uuid;
  r record;
begin
  reset role;
  select id into devA from public.developers where slug = 'construtora-a-0063';
  set role authenticated;
  perform pg_temp.become63(adm);

  select * into r from public.marketing_developer_summary(date '2026-01-01') s
   where s.developer_id = devA;
  perform pg_temp.check63(r.investment = 5000, format('janeiro traz só o aporte de janeiro (tem %s)', r.investment));
  perform pg_temp.check63(r.sales = 1 and r.vgv = 200000, 'o negócio de janeiro entra no mês');
  perform pg_temp.check63(r.campaign_spend = 1000,
    'o gasto de campanha NÃO é recortado por mês — por isso a tela não soma os dois');

  select * into r from public.marketing_developer_summary(date '2026-02-01') s
   where s.developer_id = devA;
  perform pg_temp.check63(r.investment = 7000, 'fevereiro traz o aporte de fevereiro');
  perform pg_temp.check63(r.sales = 0 and r.vgv = 0, 'sem negócio em fevereiro, o retorno é zero e não herda janeiro');

  -- Dia qualquer do mês entra pelo mesmo caminho (`month_start`).
  select * into r from public.marketing_developer_summary(date '2026-01-17') s
   where s.developer_id = devA;
  perform pg_temp.check63(r.investment = 5000, 'qualquer dia do mês cai no primeiro dia');
  reset role;
end
$$;

\echo '== 6. sem reports.view_finance, a recusa é explícita =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000006304';
begin
  set role authenticated;
  perform pg_temp.become63(cor);
  begin
    perform count(*) from public.marketing_developer_summary();
    raise exception 'FALHOU: corretor leu o resumo por construtora';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor recebe 42501 em vez de tabela vazia';
  end;
  begin
    perform count(*) from public.marketing_campaign_stats();
    raise exception 'FALHOU: corretor leu as métricas de campanha';
  exception
    when insufficient_privilege then
      raise notice '  ok  marketing_campaign_stats continua guardada';
  end;
  reset role;
end
$$;

reset role;
select set_config('request.jwt.claims', null, false);

-- Limpeza do que este arquivo criou (usuários ficam: os outros testes também deixam os seus).
do $$
declare
  devA uuid;
  devB uuid;
begin
  select id into devA from public.developers where slug = 'construtora-a-0063';
  select id into devB from public.developers where slug = 'construtora-b-0063';
  delete from public.leads where phone like '119666606%';
  delete from public.deals where developer_id = devA;
  delete from public.marketing_investments where developer_id in (devA, devB);
  delete from public.ad_campaigns where external_id like 'camp-0063-%';
  delete from public.useful_links where label like '%0063';
  delete from public.developers where id in (devA, devB);
end
$$;

\echo 'marketing e dados por construtora ok'
