-- =============================================================================
-- 0267 · Qualidade por campanha
--
-- Pedido de 11/10/2026: voltar a medir a qualidade dos leads por campanha agora
-- que o CRM tem o rastreio (campanha, formulário, anúncio). Para cada campanha:
-- quanto gastou, quantos leads, quantos o corretor atendeu, quantos o robô
-- qualificou e entregou, quantos chegaram à análise de crédito, quantos foram
-- aprovados e quantos viraram venda.
--
--  * Coorte por criação do lead: os leads criados na janela, com o que
--    aconteceu com eles DEPOIS (a venda demora mais que a janela).
--  * Lead de candidato (agente com `lead_de_compra = false`, a Luna) fica de
--    fora: não é lead de compra e distorceria CPL e taxas.
--  * Qualificado = o robô entregou ao grupo (`handed_off`), a medida rápida.
--    A análise segue sendo a medida de qualidade: mesma regra do Funil de
--    Vendas (0216) — entrou na esteira do CCA, ou o Status 2 passou a Esteira
--    Ágil, Retorno à Esteira ou Análise Externa; aprovada = Aprov. Total ou
--    Cond.; venda = fechado, ou Status 1 VENDA em aberto (0207).
--  * Leitura só para quem vê o financeiro (`reports.view_finance`) e para a
--    service role (ponte do relatório do Telegram).
--  * `nomes_distintos` e `formularios` expõem atribuição suspeita: uma
--    campanha com mais de um nome ou formulário nos leads.
-- =============================================================================

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
  custo_analise     numeric
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
  analise as (
    select d.lead_id
      from public.deals d
     where d.lead_id in (select id from base)
       and (exists (select 1 from public.cca_cases c where c.deal_id = d.id and c.submitted_at is not null)
         or exists (select 1 from public.deal_status_history h
                     where h.deal_id = d.id
                       and public.status2_chave(h.to_status) in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANALISE EXTERNA')))
  ),
  aprov as (
    select d.lead_id
      from public.deals d
     where d.lead_id in (select id from base)
       and exists (select 1 from public.deal_status_history h
                    where h.deal_id = d.id
                      and public.status2_chave(h.to_status) in ('APROV. TOTAL', 'APROV. COND.'))
  ),
  venda as (
    select d.lead_id
      from public.deals d
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
    select ac.external_id as campaign_id, max(ac.name) as nome_meta, sum(i.spend) as gasto
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
         round(coalesce(g.gasto, 0) / nullif(p.n_analise, 0), 2)
    from por_campanha p
    full join gasto_meta g on g.campaign_id = p.campaign_id
   order by coalesce(g.gasto, 0) desc, coalesce(p.n_leads, 0) desc;
end;
$$;

comment on function public.qualidade_por_campanha(int) is
  'Qualidade por campanha na janela de p_dias (0267): gasto, leads, atendidos, qualificados, análise, aprovadas e vendas, com CPL e custo por qualificado/análise. Só reports.view_finance e service role.';

revoke all on function public.qualidade_por_campanha(int) from public, anon;
grant execute on function public.qualidade_por_campanha(int) to authenticated, service_role;
