-- =============================================================================
-- 0081 — Marketing: custo por VENDA e o negócio que contava duas vezes
--
-- Dois defeitos no MESMO número — o retorno que a tela de marketing divide.
--
-- 1) A tabela de campanhas mostra "custo/negócio", que conta lead com
--    `converted_deal_id` preenchido: proposta em aberto entra, venda perdida
--    entra. O custo por VENDA (negócio com `outcome = 'won'`) não existe como
--    coluna, embora a função já leia exatamente esses negócios para somar
--    `revenue`. Quem lê "custo/negócio: R$ 1.200" entende "paguei 1.200 por uma
--    venda" e pode não ter vendido nada.
--
--    A função ganha `sales` — a contagem dos negócios ganhos que alimentam
--    `revenue`. Sai da mesma CTE que já existia: nenhuma varredura a mais.
--
-- 2) `revenue` desduplicava o par (campanha, negócio) — `select distinct
--    l.campaign_id, l.converted_deal_id`. Isso resolve dois leads da MESMA
--    campanha no mesmo negócio, e não resolve dois leads de campanhas
--    DIFERENTES: aí o VGV inteiro conta nas duas e o ROAS das duas infla. A
--    soma das campanhas passa a ser maior que o VGV que a empresa realmente
--    fez — que é a única coisa que a tela promete não fazer.
--
--    A correção desduplica por NEGÓCIO, não por par: cada negócio ganho conta
--    uma vez, na campanha do lead MAIS ANTIGO que aponta para ele. É a regra que
--    a operação já usa para origem ("quem trouxe foi o primeiro contato"), é
--    determinística (desempate por `created_at`, depois `id`) e não inventa
--    rateio de VGV entre campanhas, que seria número que ninguém pediu.
--
--    Por que NÃO um `unique` em `converted_deal_id`: ele fecharia a porta na
--    origem, mas passaria a recusar com 23505 a marcação de dois leads (o mesmo
--    cliente entrando duas vezes) no mesmo negócio — um caminho que hoje
--    nenhuma tela usa, mas que o seed e o harness de SQL exercitam de
--    propósito. Trocar um número inflado por uma gravação recusada não é
--    conserto. Se a operação decidir que a marcação dupla é erro, o índice é a
--    migration seguinte.
--    ponytail: dedupe na leitura; virar índice unique quando alguém decidir que
--    dois leads no mesmo negócio é dado inválido, e não só ambíguo.
--
-- Idempotente: `drop function if exists` + `create` — a assinatura de retorno
-- muda e `create or replace` não troca o `RETURNS TABLE`.
-- =============================================================================

drop function if exists public.marketing_campaign_stats();

create function public.marketing_campaign_stats()
returns table (
  campaign_id text,
  leads integer,
  conversions integer,
  sales integer,
  revenue numeric
)
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
      -- Negócio, não venda: é o que a coluna "Conversões" da tela mostra.
      count(*) filter (where l.converted_deal_id is not null)::int as conversions
    from public.leads l
    where l.campaign_id is not null
    group by l.campaign_id
  ),
  -- UM negócio, UMA campanha: a do lead mais antigo que aponta para ele.
  -- Sem este `distinct on`, o mesmo VGV somava em cada campanha que tivesse um
  -- lead apontando para o negócio, e a soma das campanhas passava do VGV real.
  origem as (
    select distinct on (l.converted_deal_id)
      l.converted_deal_id as did,
      l.campaign_id as cid
    from public.leads l
    where l.campaign_id is not null and l.converted_deal_id is not null
    order by l.converted_deal_id, l.created_at, l.id
  ),
  ganhos as (
    select o.cid, count(*)::int as sales, coalesce(sum(d.vgv_net), 0)::numeric as revenue
    from origem o
    join public.deals d on d.id = o.did and d.outcome = 'won'
    group by o.cid
  )
  select p.cid, p.leads, p.conversions, coalesce(g.sales, 0), coalesce(g.revenue, 0)::numeric
  from por_campanha p
  left join ganhos g on g.cid = p.cid;
end;
$$;

revoke all on function public.marketing_campaign_stats() from public, anon;
grant execute on function public.marketing_campaign_stats() to authenticated, service_role;

comment on function public.marketing_campaign_stats() is
  '0081: leads, conversões (negócio), VENDAS (outcome=won) e VGV atribuído por campanha. Cada negócio ganho conta UMA vez, na campanha do lead mais antigo. Agregada e security definer porque `leads` é recortado por RLS.';
