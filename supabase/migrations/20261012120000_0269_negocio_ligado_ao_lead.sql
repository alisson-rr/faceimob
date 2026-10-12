-- =============================================================================
-- 0269 · Negócio ligado ao lead pelo telefone do cliente
--
-- Pedido de 12/10/2026: na Qualidade por campanha, Em análise, Aprovadas e
-- Vendas ficavam em zero. Medido no banco: dos 168 negócios dos últimos 30 dias,
-- 161 não tinham `lead_id` — o corretor cria o negócio direto no pipeline, sem
-- converter o lead. Sem o vínculo, a análise e a venda não chegam à campanha.
--
-- O vínculo vive numa tabela PRÓPRIA (`deal_lead_links`) e não em `deals.lead_id`:
-- atualizar `deals` dispara as travas de mês fechado, de conferência de
-- documentos, de valor e a pontuação do game, e uma carga em lote não deve
-- passar por nenhuma delas. Tabela própria também se desfaz com um delete.
--
-- Regra conservadora: só liga quando o telefone de um cliente do negócio
-- (titular ou compra conjunta) casa com EXATAMENTE UM lead, criado antes do
-- negócio. Mais de um lead com o telefone, ou nenhum, não liga: melhor sem
-- vínculo do que na campanha errada. `deals.lead_id`, quando existe, vale mais.
-- Vale para os negócios novos (gatilho em `deal_clients`) e para os existentes
-- (carga única no fim).
-- =============================================================================

create table if not exists public.deal_lead_links (
  deal_id    uuid primary key references public.deals(id) on delete cascade,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  origem     text not null default 'telefone' check (origem in ('telefone')),
  created_at timestamptz not null default now()
);

create index if not exists deal_lead_links_lead_idx on public.deal_lead_links (lead_id);

comment on table public.deal_lead_links is
  'Negócio sem lead_id ligado ao lead pelo telefone do cliente (0269): alimenta a Qualidade por campanha sem mexer em deals.';

alter table public.deal_lead_links enable row level security;
drop policy if exists deal_lead_links_select on public.deal_lead_links;
create policy deal_lead_links_select on public.deal_lead_links
  for select to authenticated using (public.can_see_deal(deal_id));
revoke all on public.deal_lead_links from anon, authenticated;
grant select on public.deal_lead_links to authenticated;
grant all on public.deal_lead_links to service_role;

-- O lead único que casa com o telefone do cliente do negócio, ou nulo.
create or replace function public.lead_do_negocio(p_deal_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select array_agg(distinct l.id)
    into v_ids
    from public.deals d
    join public.deal_clients c on c.deal_id = d.id
    join public.leads l on l.phone = public.normalize_phone(c.phone)
   where d.id = p_deal_id
     and c.phone is not null
     and l.created_at <= d.created_at;
  return case when cardinality(v_ids) = 1 then v_ids[1] end;
end;
$$;

revoke all on function public.lead_do_negocio(uuid) from public, anon, authenticated;
grant execute on function public.lead_do_negocio(uuid) to service_role;

-- Liga o negócio ao lead se ele ainda não tem lead nem vínculo.
create or replace function public.deal_vincular_lead(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
begin
  if exists (select 1 from public.deals d where d.id = p_deal_id and d.lead_id is not null)
     or exists (select 1 from public.deal_lead_links v where v.deal_id = p_deal_id) then
    return;
  end if;
  v_lead := public.lead_do_negocio(p_deal_id);
  if v_lead is not null then
    insert into public.deal_lead_links (deal_id, lead_id) values (p_deal_id, v_lead)
    on conflict (deal_id) do nothing;
  end if;
end;
$$;

revoke all on function public.deal_vincular_lead(uuid) from public, anon, authenticated;
grant execute on function public.deal_vincular_lead(uuid) to service_role;

create or replace function public.deal_clients_vincula_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.deal_vincular_lead(new.deal_id);
  return null;
end;
$$;

revoke all on function public.deal_clients_vincula_lead() from public, anon, authenticated;

drop trigger if exists deal_clients_vincula_lead on public.deal_clients;
create trigger deal_clients_vincula_lead
  after insert or update of phone on public.deal_clients
  for each row execute function public.deal_clients_vincula_lead();

-- Carga única dos negócios existentes.
do $$
declare
  v_total int;
  v_ligados int;
begin
  select count(*) into v_total from public.deals d where d.lead_id is null;
  perform public.deal_vincular_lead(d.id) from public.deals d where d.lead_id is null;
  select count(*) into v_ligados from public.deal_lead_links;
  raise notice '[0269] % negócios sem lead_id; % ligados a um lead pelo telefone.', v_total, v_ligados;
end
$$;

-- A Qualidade por campanha passa a enxergar o vínculo.
create or replace function public.qualidade_por_campanha(p_dias int default 30)
returns table (
  campaign_id       text,
  campanha          text,
  nomes_distintos   int,
  formularios       int,
  leads             int,
  atendidos         int,
  qualificados      int,
  em_analise        int,
  aprovadas         int,
  vendas            int,
  gasto             numeric,
  cpl               numeric,
  custo_qualificado numeric,
  custo_analise     numeric,
  resultados_meta   int,
  custo_resultado_meta numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := least(greatest(coalesce(p_dias, 30), 1), 365);
  v_ini  timestamptz := now() - make_interval(days => v_dias);
begin
  if auth.uid() is not null and not public.has_permission('reports.view_finance') then
    raise exception 'Sem permissão para ver a qualidade das campanhas.' using errcode = '42501';
  end if;

  return query
  with
  base as (
    select l.id, l.campaign_id, l.campaign_name, l.form_id, l.first_contact_at
      from public.leads l
     where l.created_at >= v_ini
       and not exists (
         select 1 from public.sdr_conversations sc
           join public.sdr_agents a on a.id = sc.agent_id
          where sc.lead_id = l.id and a.lead_de_compra = false)
  ),
  qualif as (
    select distinct sc.lead_id from public.sdr_conversations sc
     where sc.status = 'handed_off' and sc.lead_id in (select id from base)
  ),
  negocios as (
    select d.id, d.outcome, d.status_group_id, coalesce(d.lead_id, v.lead_id) as lead_id
      from public.deals d
      left join public.deal_lead_links v on v.deal_id = d.id
  ),
  analise as (
    select d.lead_id
      from negocios d
     where d.lead_id in (select id from base)
       and (exists (select 1 from public.cca_cases c where c.deal_id = d.id and c.submitted_at is not null)
         or exists (select 1 from public.deal_status_history h
                     where h.deal_id = d.id
                       and public.status2_chave(h.to_status) in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANALISE EXTERNA')))
  ),
  aprov as (
    select d.lead_id
      from negocios d
     where d.lead_id in (select id from base)
       and exists (select 1 from public.deal_status_history h
                    where h.deal_id = d.id
                      and public.status2_chave(h.to_status) in ('APROV. TOTAL', 'APROV. COND.'))
  ),
  venda as (
    select d.lead_id
      from negocios d
      left join public.deal_status_groups g on g.id = d.status_group_id
     where d.lead_id in (select id from base)
       and (d.outcome = 'won' or (d.outcome = 'open' and g.code = 'VENDA'))
  ),
  por_campanha as (
    select b.campaign_id,
           max(b.campaign_name) as nome_lead,
           count(distinct b.campaign_name)::int as nomes,
           count(distinct b.form_id)::int as forms,
           count(*)::int as n_leads,
           count(*) filter (where b.first_contact_at is not null)::int as n_atend,
           count(*) filter (where b.id in (select lead_id from qualif))::int as n_qualif,
           count(*) filter (where b.id in (select lead_id from analise))::int as n_analise,
           count(*) filter (where b.id in (select lead_id from aprov))::int as n_aprov,
           count(*) filter (where b.id in (select lead_id from venda))::int as n_venda
      from base b
     group by b.campaign_id
  ),
  gasto_meta as (
    select ac.external_id as campaign_id, max(ac.name) as nome_meta, sum(i.spend) as gasto,
           sum(i.resultados)::int as resultados
      from public.meta_campaign_insights_daily i
      join public.ad_campaigns ac on ac.id = i.campaign_id
     where i.day >= (v_ini at time zone 'America/Sao_Paulo')::date
     group by ac.external_id
  )
  select coalesce(p.campaign_id, g.campaign_id),
         coalesce(g.nome_meta, p.nome_lead, '(sem campanha)'),
         coalesce(p.nomes, 0),
         coalesce(p.forms, 0),
         coalesce(p.n_leads, 0),
         coalesce(p.n_atend, 0),
         coalesce(p.n_qualif, 0),
         coalesce(p.n_analise, 0),
         coalesce(p.n_aprov, 0),
         coalesce(p.n_venda, 0),
         coalesce(g.gasto, 0)::numeric,
         round(coalesce(g.gasto, 0) / nullif(p.n_leads, 0), 2),
         round(coalesce(g.gasto, 0) / nullif(p.n_qualif, 0), 2),
         round(coalesce(g.gasto, 0) / nullif(p.n_analise, 0), 2),
         coalesce(g.resultados, 0),
         round(coalesce(g.gasto, 0) / nullif(g.resultados, 0), 2)
    from por_campanha p
    full join gasto_meta g on g.campaign_id = p.campaign_id
   order by coalesce(g.gasto, 0) desc, coalesce(p.n_leads, 0) desc;
end;
$$;

comment on function public.qualidade_por_campanha(int) is
  'Qualidade por campanha na janela de p_dias (0267/0268): gasto, leads, atendidos, qualificados, análise, aprovadas e vendas, com CPL e custo por qualificado/análise. Traz também os resultados contados pela Meta, para comparar com os leads do CRM. Só reports.view_finance e service role.';

revoke all on function public.qualidade_por_campanha(int) from public, anon;
grant execute on function public.qualidade_por_campanha(int) to authenticated, service_role;
