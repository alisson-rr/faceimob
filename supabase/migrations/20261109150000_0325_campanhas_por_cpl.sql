-- =============================================================================
-- 0325 · Campanhas do Facebook em ordem de CPL (menor primeiro)
--
-- Pedido de 09/11/2026. A tela é de todo corretor, mas gasto é dado financeiro
-- (`meta_campaign_insights_daily` exige `reports.view_finance`). Por isso a
-- função devolve a ORDEM para todos e o VALOR do CPL só para quem já vê
-- finanças. Saber que a campanha A converte mais barato que a B não revela
-- quanto se gasta.
--
-- CPL = gasto ÷ resultados dos últimos 7 dias (o `resultados` já é o do canal
-- da campanha: formulário, conversa ou LP — ver 0115). Campanha sem resultado
-- ou sem gasto no período vai para o fim.
-- =============================================================================

create or replace function public.campanhas_por_cpl(p_dias integer default 7)
returns table (campanha_id text, posicao integer, cpl numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with janela as (
    select least(greatest(coalesce(p_dias, 7), 1), 90) as dias
  ), soma as (
    select c.external_id as campanha_id, sum(i.spend) as gasto, sum(i.resultados) as resultados
      from public.meta_campaign_insights_daily i
      join public.ad_campaigns c on c.id = i.campaign_id, janela j
     where c.external_id is not null
       and i.day >= current_date - (j.dias - 1)
     group by c.external_id
  ), com_cpl as (
    select s.campanha_id,
           case when s.resultados > 0 and s.gasto > 0 then round(s.gasto / s.resultados, 2) end as cpl
      from soma s
  )
  select k.campanha_id,
         row_number() over (order by k.cpl nulls last, k.campanha_id)::int,
         case when public.has_permission('reports.view_finance') then k.cpl end
    from com_cpl k
   where auth.uid() is not null;
$$;

comment on function public.campanhas_por_cpl(integer) is
  'Ordem das campanhas da Meta por CPL (gasto ÷ resultados) na janela (1 a 90 dias, padrão 7). A posição sai para todo usuário logado; o valor do CPL só para quem tem reports.view_finance (0325).';

revoke all on function public.campanhas_por_cpl(integer) from public, anon;
grant execute on function public.campanhas_por_cpl(integer) to authenticated;
