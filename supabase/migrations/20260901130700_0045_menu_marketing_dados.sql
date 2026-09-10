-- =============================================================================
-- 0045 — Marketing para o gerente; "Dados" só para quem lê aporte
--
-- Duas fontes de verdade discordavam sobre marketing. A matriz (0015) concede
-- `menu.marketing` ao gerente, mas as policies de SELECT de `ad_campaigns` e
-- `marketing_investments` (0011) e a guarda de `marketing_campaign_stats`
-- (0031) só aceitam admin/director/partner/marketing. O gerente via o item,
-- abria a tela e recebia "Você não tem permissão para esta ação" — zero KPI,
-- zero tabela.
--
-- Decisão: o gerente ENXERGA marketing. Quem acompanha os números da equipe
-- também vê de onde os leads vêm e quanto custam. Escrita continua com admin e
-- marketing (`*_write` não muda).
--
-- Quem decide a leitura passa a ser a MATRIZ, não o papel cru: os três pontos
-- trocam `has_any_role(...)` por `has_permission('reports.view_finance')` —
-- o código que a 0044 cadastrou com a descrição "Aportes, custos e VGV
-- consolidado", que é exatamente o que estas três superfícies entregam. Sem
-- isso ficávamos com o defeito que este cabeçalho diz consertar: o gerente
-- lendo aporte e custo enquanto a tela de permissões mostrava "Ver dados
-- financeiros" desligado para ele, e o admin desligando o switch sem que nada
-- mudasse. A 0044 concedeu o código a director, marketing e partner; o gerente
-- entra aqui, e o conjunto que passava antes é preservado (admin não precisa de
-- linha: `has_permission` curto-circuita em `is_admin()`).
--
-- `menu.data` era herança ("Dados ficava fora do filtro por papel — todo mundo
-- via", 0015): corretor, CCA e SDR entravam em /data e encontravam "Nenhum
-- aporte" e R$ 0 — o RLS filtra em silêncio. O item fica com os papéis que a
-- policy de SELECT de aporte aceita; os outros caem em "Acesso não liberado".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- O gerente entra na matriz financeira; os demais já vieram da 0044.
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission, allowed)
values ('manager', 'reports.view_finance', true)
on conflict (role, permission) do update set allowed = true;

-- -----------------------------------------------------------------------------
-- Leitura de marketing pela matriz
-- -----------------------------------------------------------------------------
drop policy if exists marketing_investments_select on public.marketing_investments;
create policy marketing_investments_select on public.marketing_investments
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists ad_campaigns_select on public.ad_campaigns;
create policy ad_campaigns_select on public.ad_campaigns
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

-- Mesmo corpo da 0031; só a guarda muda. Continua sem expor dado pessoal nem
-- ampliar o SELECT de leads: devolve contagem agregada por campanha.
create or replace function public.marketing_campaign_stats()
returns table (campaign_id text, leads int, conversions int)
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
  select
    l.campaign_id,
    count(*)::int,
    count(*) filter (where l.converted_deal_id is not null)::int
  from public.leads l
  where l.campaign_id is not null
  group by l.campaign_id;
end;
$$;

revoke all on function public.marketing_campaign_stats() from public, anon;
grant execute on function public.marketing_campaign_stats() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Matriz de menu
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission, allowed)
values ('manager', 'menu.marketing', true)
on conflict (role, permission) do update set allowed = true;

delete from public.role_permissions
 where permission = 'menu.data'
   and role in ('broker', 'cca', 'sdr');
