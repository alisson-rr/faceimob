-- =============================================================================
-- 0350 · Números da Meta por dia (painel de campanhas, pedido de 21/11/2026)
--
-- O painel "Gestão de anúncios" ganhou o gráfico de custo por lead por dia e
-- os indicadores com a variação contra o período anterior. `meta_metricas`
-- soma por campanha; aqui a mesma base (insights diários) somada por DIA, uma
-- linha por dia — sem esbarrar no teto de 1000 linhas do PostgREST.
--
-- "De lead" = campanha com canal conhecido (formulário, WhatsApp, landing page
-- ou misto); `outro` (alcance, engajamento) fica fora do custo por lead.
-- Alcance não vem: é pessoa única por período e somar dias inventa número.
-- =============================================================================

create or replace function public.meta_metricas_por_dia(p_from date, p_to date)
returns table (
  day             date,
  spend           numeric,
  impressions     bigint,
  link_clicks     bigint,
  resultados      int,
  spend_lead      numeric,
  resultados_lead int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('reports.view_finance') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Sem permissão para ver os números da Meta.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;

  return query
  select i.day,
         sum(i.spend),
         sum(i.impressions)::bigint,
         sum(i.link_clicks)::bigint,
         sum(i.resultados)::int,
         coalesce(sum(i.spend) filter (where coalesce(c.meta_channel, 'outro') <> 'outro'), 0),
         coalesce(sum(i.resultados) filter (where coalesce(c.meta_channel, 'outro') <> 'outro'), 0)::int
    from public.meta_campaign_insights_daily i
    join public.ad_campaigns c on c.id = i.campaign_id
   where i.day between p_from and p_to
   group by i.day
   order by i.day;
end;
$$;

comment on function public.meta_metricas_por_dia(date, date) is
  'Insights da Meta somados por dia (todas as campanhas) e o recorte das campanhas de lead (canal diferente de outro). Mesma checagem de meta_metricas: reports.view_finance ou service_role. Período de até 400 dias.';

revoke all on function public.meta_metricas_por_dia(date, date) from public, anon;
grant execute on function public.meta_metricas_por_dia(date, date) to authenticated, service_role;
