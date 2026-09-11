-- =============================================================================
-- 0114 · O livro do gasto não aceita período sobreposto
--
-- O ACHADO. `ad_campaign_spend_write` (0113) é `for all`: admin, sócio e
-- marketing escrevem na tabela DIRETO pelo PostgREST, sem passar por
-- `marketing_import_ad_spend`. E a regra que impede o mesmo dia de contar duas
-- vezes vive só dentro da RPC — é ela que apaga o recorte sobreposto antes de
-- gravar o novo. A chave primária (campaign_id, period_start, period_end) só
-- barra o período IDÊNTICO: inserir 01-31/08 ao lado de 10-20/08 passava, e o
-- recálculo seguinte (`total_spend` = soma do livro) somava os dias 10 a 20
-- duas vezes no número que divide o CPL e o ROAS.
--
-- A policy não pode ser estreitada: a RPC é `security invoker` e precisa
-- exatamente desse insert/delete para funcionar. Então a regra desce para o
-- lugar onde ninguém passa por fora — uma constraint de exclusão, que é o
-- "único por intervalo" do Postgres.
--
-- `btree_gist` já está instalado desde a 0001 (schema `extensions`), que é o que
-- permite misturar `campaign_id with =` e o intervalo no mesmo índice gist. A
-- classe de operador padrão de `uuid` para gist vem dela e é achada pelo tipo,
-- não pelo `search_path`.
--
-- A RPC CONTINUA PASSANDO: ela apaga o que se sobrepõe antes de cada insert, e
-- o índice do exclude ainda acelera esse delete. Quem passa a levar 23P01 é
-- quem grava por fora — que é o caminho que não tem como saber o que apagar.
--
-- Idempotente: a constraint só é criada se ainda não existir. Se o banco já
-- tiver sobreposição gravada, a criação FALHA apontando o par em conflito — e
-- isso é o resultado certo: dinheiro contado duas vezes precisa de decisão
-- humana sobre qual recorte vale, não de um delete automático numa migration.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ad_campaign_spend'::regclass
       and conname  = 'ad_campaign_spend_sem_sobreposicao'
  ) then
    alter table public.ad_campaign_spend
      add constraint ad_campaign_spend_sem_sobreposicao
      exclude using gist (
        campaign_id with =,
        daterange(period_start, period_end, '[]') with &&
      );
  end if;
end
$$;

comment on constraint ad_campaign_spend_sem_sobreposicao on public.ad_campaign_spend is
  'Dois recortes da MESMA campanha não podem se cruzar: total_spend é a soma do livro, e período sobreposto conta o mesmo dia duas vezes. A importação (marketing_import_ad_spend) apaga o recorte antigo antes de gravar o novo e não esbarra aqui; escrita direta pelo PostgREST esbarra, de propósito.';
