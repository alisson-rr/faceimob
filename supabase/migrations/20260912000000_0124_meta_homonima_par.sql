-- =============================================================================
-- 0124 · Homônima: o gatilho da planilha compara só manual × sincronizada
--
-- O gatilho da 0123 comparava QUALQUER par de campanhas de mesmo nome e só
-- olhava gasto meta_api do lado oposto. Dois furos:
--   - planilha × planilha passava: a sincronizada recebe o plano B (planilha que
--     apaga os dias da API) e depois a manual homônima recebe a mesma planilha;
--     os dias contam em dobro;
--   - duas campanhas reais da Meta com o mesmo nome, ambas sincronizadas,
--     recusavam o plano B uma por causa da outra, e a mensagem mandava importar
--     na gêmea, que também recusava.
-- Agora o par comparado é só manual (meta_account_id nulo, plataforma meta)
-- × sincronizada (meta_account_id preenchido), nos dois sentidos, com qualquer
-- gasto do lado oposto. Sincronizada × sincronizada e manual × manual não são
-- comparadas, a mesma regra da porta da sincronização (meta_sync_apply, 0123).
-- As linhas meta_api que a sincronização grava continuam fora do gatilho: a
-- porta dela já barra a manual com planilha na janela.
--
-- Corpo da 0123; mudam o par, a origem do gasto oposto e a mensagem. Dado que
-- a 0123 já tenha deixado em dobro não é apagado aqui. Idempotente.
-- =============================================================================

create or replace function public.ad_campaign_spend_homonima_api()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if new.source is distinct from 'planilha' then
    return null;
  end if;

  select c.name as nome, o.name as outra, o.external_id,
         c.meta_account_id is null as manual,
         public.faixas_de_dias(array_agg(d::date)) as dias
    into v
    from public.ad_campaigns c
    join public.ad_campaigns o
      on o.id <> c.id
     and (o.meta_account_id is null) <> (c.meta_account_id is null)
     -- A manual do par é da Meta, como na porta da sincronização: uma do
     -- Google de mesmo nome é outro gasto.
     and case when c.meta_account_id is null then c.platform else o.platform end = 'meta'
     and lower(public.unaccent_fallback(btrim(o.name))) = lower(public.unaccent_fallback(btrim(c.name)))
    join public.ad_campaign_spend s
      on s.campaign_id = o.id
     and s.period_start <= new.period_end
     and s.period_end   >= new.period_start
    cross join lateral generate_series(greatest(s.period_start, new.period_start),
                                       least(s.period_end, new.period_end), interval '1 day') as d
   where c.id = new.campaign_id
   group by c.name, c.meta_account_id, o.id, o.name, o.external_id
   order by o.external_id
   limit 1;

  if found then
    raise exception '%', format(
      '%s: a campanha %s (ID externo %s), de mesmo nome e %s, já tem gasto em %s. Lançar a planilha aqui contaria esses dias duas vezes: tire-os do arquivo ou importe-os na campanha %s.',
      v.nome, v.outra, v.external_id,
      case when v.manual then 'sincronizada com a Meta' else 'lançada à mão' end,
      v.dias, v.external_id)
      using errcode = '22023';
  end if;
  return null;
end;
$$;

comment on function public.ad_campaign_spend_homonima_api() is
  'Gatilho do livro: recusa (22023) linha de planilha numa campanha manual (sem conta, Meta) quando uma sincronizada de mesmo nome normalizado tem qualquer gasto nos mesmos dias, e numa sincronizada quando a manual homônima tem; diz qual e quais dias. Sincronizada × sincronizada e manual × manual não se comparam (0123; par corrigido na 0124).';

revoke all on function public.ad_campaign_spend_homonima_api() from public, anon, authenticated;
