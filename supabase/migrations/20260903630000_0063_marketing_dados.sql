-- =============================================================================
-- 0063 — Marketing e dados: resumo por construtora, ROAS e as portas que faltavam
--
-- Cinco defeitos que só o banco resolve:
--
-- 1) `menu.admin_developers` não tem NENHUMA linha em `role_permissions`, mas
--    `developers_write` = admin **e cca**. O CCA pode alterar a construtora e
--    não consegue abrir a tela — a mesma divergência de duas fontes de verdade
--    que a 0045 consertou para marketing. Quem toca a esteira de crédito é quem
--    sabe se a construtora virou fluxo externo; ele ganha o item.
--
-- 2) `menu.links` é director/manager/broker/partner. Marketing, CCA e SDR ficam
--    de fora de uma tela cujo conteúdo é link operacional público (docs,
--    Receita, CAIXA) e cuja escrita continua só do admin. Não há decisão
--    registrada em `docs/sprints/decisoes.md` excluindo os três: era omissão.
--
-- 3) `ad_campaigns.total_spend` não tinha piso. "-500" era aceito ponta a ponta
--    e virava CPL negativo na tela. O mesmo para `daily_budget`.
--
-- 4) `developers.submission_email` é `citext` sem check de formato, e é ele que
--    `submit_deal_for_analysis` copia para `developer_submissions.to_email`, de
--    onde a edge `submission-dispatch` manda o dossiê pelo Brevo. Um e-mail
--    torto era gravado e o dossiê saía para o vazio. O mesmo vale para
--    `useful_links.url`: sem "http(s)://" o card vira link relativo e navega
--    para dentro do próprio app.
--
-- 5) Aporte, gasto de campanha, leads, negócios e VGV existem no banco com a
--    MESMA chave (`developers.id`) e nenhuma tela os junta — o dono não
--    consegue responder "quanto investi na Horizonte e quanto ela me devolveu".
--    Somar no navegador não serve: `deals` é recortado por RLS, então o mesmo
--    "panorama por construtora" mudaria de significado por papel sem avisar.
--    Daí `marketing_developer_summary`, agregada e `security definer`, no mesmo
--    desenho de `marketing_campaign_stats`: devolve contagem, nunca dado
--    pessoal, e conta igual para todo papel que tem `reports.view_finance`.
--
-- Período: o aporte é MENSAL e `ad_campaigns.total_spend` é ACUMULADO da vida
-- inteira da campanha. Dividir um custo eterno por um resultado mensal produz
-- número sem sentido, então a função aceita `p_period = null` (tudo acumulado,
-- onde custo e resultado são comparáveis e o ROAS vale) e, com um mês
-- escolhido, recorta aporte/leads/negócios/VGV e devolve `campaign_spend`
-- separado — cabe à tela dizer que ele não tem recorte mensal e não somar os
-- dois. Enquanto ninguém escrever gasto por mês (só a Meta Marketing API traria
-- isso, e não há credencial), essa é a única leitura honesta.
--
-- ROAS = VGV ganho ÷ gasto da campanha que trouxe o lead. O par já existe:
-- `leads.campaign_id` liga o lead à campanha e `leads.converted_deal_id` liga o
-- lead ao negócio. Por isso `marketing_campaign_stats` ganha a coluna `revenue`
-- em vez de nascer uma segunda função com o mesmo grão.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 e 2. Menu: quem o banco já autoriza passa a ter porta de entrada
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission, allowed)
values
  ('cca',       'menu.admin_developers', true),
  ('marketing', 'menu.links',            true),
  ('cca',       'menu.links',            true),
  ('sdr',       'menu.links',            true)
on conflict (role, permission) do update set allowed = true;

-- -----------------------------------------------------------------------------
-- 3. Dinheiro de campanha não é negativo
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_campaigns_spend_not_negative') then
    alter table public.ad_campaigns
      add constraint ad_campaigns_spend_not_negative
      check (total_spend >= 0 and (daily_budget is null or daily_budget >= 0));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Formato de e-mail e de URL na fronteira do banco
--
-- O padrão é o mesmo do front (`invalidEmails`, em developerSubmissions.ts):
-- não aceita espaço, exige um "@" e um ponto no domínio. Deliberadamente frouxo
-- — a validação forte de e-mail é a entrega, não a regex.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'developers_submission_email_format') then
    alter table public.developers
      add constraint developers_submission_email_format
      check (
        submission_email is null
        or submission_email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'useful_links_url_absolute') then
    alter table public.useful_links
      add constraint useful_links_url_absolute
      check (url ~* '^https?://[^[:space:]]+$');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 5a. Estatística por campanha, agora com receita atribuída
--
-- Mesmo corpo e mesma guarda da 0045; entra `revenue`. Trocar o tipo de retorno
-- exige DROP — por isso o `drop ... if exists` antes do `create`.
--
-- A receita conta o negócio UMA vez por campanha mesmo que dois leads apontem
-- para o mesmo `converted_deal_id` (daí o `distinct`), e só negócio ganho
-- (`outcome = 'won'`): proposta em aberto não é retorno.
-- -----------------------------------------------------------------------------
drop function if exists public.marketing_campaign_stats();

create function public.marketing_campaign_stats()
returns table (campaign_id text, leads int, conversions int, revenue numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('reports.view_finance') then
    raise exception 'Papel sem permissão para métricas de marketing'
      using errcode = '42501';
  end if;

  return query
  with por_campanha as (
    select
      l.campaign_id as cid,
      count(*)::int as leads,
      count(*) filter (where l.converted_deal_id is not null)::int as conversions
    from public.leads l
    where l.campaign_id is not null
    group by l.campaign_id
  ),
  receita as (
    select x.cid, coalesce(sum(d.vgv_net), 0)::numeric as revenue
    from (
      select distinct l.campaign_id as cid, l.converted_deal_id as did
      from public.leads l
      where l.campaign_id is not null and l.converted_deal_id is not null
    ) x
    join public.deals d on d.id = x.did and d.outcome = 'won'
    group by x.cid
  )
  select p.cid, p.leads, p.conversions, coalesce(r.revenue, 0)::numeric
  from por_campanha p
  left join receita r on r.cid = p.cid;
end;
$$;

revoke all on function public.marketing_campaign_stats() from public, anon;
grant execute on function public.marketing_campaign_stats() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5b. Resumo por construtora — aporte, campanha, lead, negócio e VGV na mesma
--     chave (`developers.id`, nunca o nome: construtora renomeada viraria duas
--     linhas).
--
-- Há sempre um balde `developer_id = null` ("Sem construtora"): negócio sem
-- construtora e lead de campanha não cadastrada precisam aparecer em algum
-- lugar, senão o resumo passa a somar menos que a empresa sem dizer.
--
-- A construtora DESATIVADA continua na lista (com `active = false`): a FK de
-- `marketing_investments` é RESTRICT, o dinheiro histórico dela não sai do
-- total, e sumir com o nome era o defeito das telas que só carregavam
-- `developers` ativas.
-- -----------------------------------------------------------------------------
create or replace function public.marketing_developer_summary(p_period date default null)
returns table (
  developer_id uuid,
  developer_name text,
  active boolean,
  investment numeric,
  campaign_spend numeric,
  campaigns int,
  leads int,
  deals int,
  sales int,
  vgv numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := case when p_period is null then null else public.month_start(p_period) end;
begin
  if not public.has_permission('reports.view_finance') then
    raise exception 'Papel sem permissão para o resumo por construtora'
      using errcode = '42501';
  end if;

  return query
  with aporte as (
    select mi.developer_id as dev, sum(mi.amount)::numeric as amount
    from public.marketing_investments mi
    where v_period is null or mi.period = v_period
    group by mi.developer_id
  ),
  campanha as (
    select c.developer_id as dev, sum(c.total_spend)::numeric as spend, count(*)::int as qtd
    from public.ad_campaigns c
    group by c.developer_id
  ),
  -- Lead → construtora pela campanha cadastrada. Lead sem campanha, ou com
  -- `campaign_id` que não casa com nenhuma linha de `ad_campaigns`, cai no
  -- balde nulo — é exatamente o lead que hoje some da conta sem aviso.
  lead_por_dev as (
    select c.developer_id as dev, count(*)::int as qtd
    from public.leads l
    left join public.ad_campaigns c on c.external_id = l.campaign_id
    where v_period is null
       or public.month_start((l.created_at at time zone 'America/Sao_Paulo')::date) = v_period
    group by c.developer_id
  ),
  negocio as (
    select
      d.developer_id as dev,
      count(*)::int as qtd,
      count(*) filter (where d.outcome = 'won')::int as won,
      coalesce(sum(d.vgv_net) filter (where d.outcome = 'won'), 0)::numeric as vgv
    from public.deals d
    where v_period is null or d.month_base = v_period
    group by d.developer_id
  ),
  chaves as (
    select dv.id as dev from public.developers dv
    union select a.dev from aporte a
    union select cp.dev from campanha cp
    union select lp.dev from lead_por_dev lp
    union select ng.dev from negocio ng
  )
  select
    k.dev,
    coalesce(dv.name, 'Sem construtora')::text,
    coalesce(dv.active, false),
    coalesce(a.amount, 0)::numeric,
    coalesce(cp.spend, 0)::numeric,
    coalesce(cp.qtd, 0),
    coalesce(lp.qtd, 0),
    coalesce(ng.qtd, 0),
    coalesce(ng.won, 0),
    coalesce(ng.vgv, 0)::numeric
  from chaves k
  left join public.developers dv on dv.id = k.dev
  left join aporte a          on a.dev  is not distinct from k.dev
  left join campanha cp       on cp.dev is not distinct from k.dev
  left join lead_por_dev lp   on lp.dev is not distinct from k.dev
  left join negocio ng        on ng.dev is not distinct from k.dev
  order by 4 desc, 2;
end;
$$;

revoke all on function public.marketing_developer_summary(date) from public, anon;
grant execute on function public.marketing_developer_summary(date) to authenticated, service_role;
