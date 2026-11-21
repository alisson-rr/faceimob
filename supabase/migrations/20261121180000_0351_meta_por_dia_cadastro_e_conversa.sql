-- =============================================================================
-- 0351 · Números da Meta por dia, separados em cadastro e conversa
--
-- Pedido de 21/11/2026: o gráfico de custo por lead por dia vira dois — custo
-- por cadastro (formulário e landing page) e custo por conversa (WhatsApp).
-- No gráfico único, a conversa encarecendo ficava escondida pelo cadastro.
-- Mesma função da 0350 com as colunas de cada canal; muda o tipo de retorno,
-- por isso drop + create (só o painel de campanhas a chama).
-- =============================================================================

drop function if exists public.meta_metricas_por_dia(date, date);

create function public.meta_metricas_por_dia(p_from date, p_to date)
returns table (
  day               date,
  spend             numeric,
  impressions       bigint,
  link_clicks       bigint,
  resultados        int,
  spend_lead        numeric,
  resultados_lead   int,
  spend_cadastro    numeric,
  cadastros         int,
  spend_conversa    numeric,
  conversas         int
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
         coalesce(sum(i.resultados) filter (where coalesce(c.meta_channel, 'outro') <> 'outro'), 0)::int,
         coalesce(sum(i.spend) filter (where c.meta_channel in ('formulario', 'landing_page')), 0),
         coalesce(sum(i.resultados) filter (where c.meta_channel in ('formulario', 'landing_page')), 0)::int,
         coalesce(sum(i.spend) filter (where c.meta_channel = 'whatsapp'), 0),
         coalesce(sum(i.resultados) filter (where c.meta_channel = 'whatsapp'), 0)::int
    from public.meta_campaign_insights_daily i
    join public.ad_campaigns c on c.id = i.campaign_id
   where i.day between p_from and p_to
   group by i.day
   order by i.day;
end;
$$;

comment on function public.meta_metricas_por_dia(date, date) is
  'Insights da Meta somados por dia: total, campanhas de lead (canal diferente de outro), cadastro (formulário e landing page) e conversa (WhatsApp). Mesma checagem de meta_metricas: reports.view_finance ou service_role. Período de até 400 dias.';

revoke all on function public.meta_metricas_por_dia(date, date) from public, anon;
grant execute on function public.meta_metricas_por_dia(date, date) to authenticated, service_role;
