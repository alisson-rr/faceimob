-- =============================================================================
-- 0125 · Homônima: trava pelo nome, e conta de anúncios não se apaga
--
-- Dois furos que a reconferência da 0124 achou, os dois raros:
--   - Duas importações SIMULTÂNEAS, uma em cada homônima (manual e
--     sincronizada), passavam as duas: o gatilho só enxerga o gasto já
--     confirmado do outro lado. Agora ele entra em fila pelo nome normalizado
--     antes de comparar; a segunda importação espera a primeira e é recusada.
--   - Apagar a conta de anúncios zerava ad_campaigns.meta_account_id (on delete
--     set null, 0115): a sincronizada virava "manual" com gasto da API, e
--     manual × manual não se compara. Nenhum caminho do produto apaga conta —
--     meta_accounts_save só desliga (enabled = false) —, então a chave passa a
--     on delete restrict: conta com campanha não se apaga, se desliga.
--
-- ponytail: a corrida entre a sincronização (linhas meta_api, que ficam fora
-- deste gatilho) e uma importação no mesmo instante continua possível; a janela
-- é a sobreposição das duas transações. Evoluir levando a mesma trava para a
-- porta de meta_sync_apply se isso aparecer.
--
-- Corpo da 0124 + a trava. Idempotente.
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

  -- Em fila pelo nome normalizado: sem isto, duas importações simultâneas (uma
  -- em cada homônima) não viam o gasto ainda não confirmado da outra e
  -- passavam as duas. Depois da trava, a leitura abaixo já enxerga o que a
  -- primeira confirmou (read committed: snapshot novo a cada comando).
  perform pg_advisory_xact_lock(hashtextextended('homonima:' ||
    (select lower(public.unaccent_fallback(btrim(x.name))) from public.ad_campaigns x where x.id = new.campaign_id), 0));

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
  'Gatilho do livro: recusa (22023) linha de planilha numa campanha manual (sem conta, Meta) quando uma sincronizada de mesmo nome normalizado tem qualquer gasto nos mesmos dias, e numa sincronizada quando a manual homônima tem; diz qual e quais dias. Sincronizada × sincronizada e manual × manual não se comparam (0123; par corrigido na 0124). Entra em fila pelo nome normalizado antes de comparar, para importações simultâneas nas duas homônimas não passarem juntas (0125).';

revoke all on function public.ad_campaign_spend_homonima_api() from public, anon, authenticated;

-- A chave nasceu sem nome explícito na 0115 ("add column ... references"):
-- acha pelo catálogo, em vez de supor o nome gerado.
do $$
declare
  v_nome text;
begin
  select con.conname into v_nome
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
   where con.conrelid = 'public.ad_campaigns'::regclass
     and con.contype = 'f'
     and att.attname = 'meta_account_id';
  if v_nome is not null then
    execute format('alter table public.ad_campaigns drop constraint %I', v_nome);
  end if;
end
$$;

alter table public.ad_campaigns
  add constraint ad_campaigns_meta_account_id_fkey
  foreign key (meta_account_id) references public.meta_ad_accounts(id) on delete restrict;
