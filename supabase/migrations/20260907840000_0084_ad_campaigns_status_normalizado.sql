-- =============================================================================
-- 0084 · `ad_campaigns.status` em MAIÚSCULA, uma forma só
--
-- Medido na homologação em 06/09/2026:
--
--   status   | quantas
--   ---------+--------
--   ACTIVE   |    2      <- semente de 28/07
--   active   |    2      <- semente de 26/08
--   PAUSED   |    1
--   paused   |    1
--
-- Duas grafias para o mesmo estado, e o front só conhece uma. O Select do
-- formulário oferece exatamente `ACTIVE` e `PAUSED`
-- (`CampaignPerformancePanel.tsx`), e o `startEdit` carrega o valor cru: ao
-- editar uma das campanhas em minúscula o Radix não acha item correspondente,
-- o campo Status nasce **em branco**, e quem salvar sem reparar troca o estado
-- da campanha sem querer. O filtro por status tem o mesmo problema — metade das
-- linhas some do recorte.
--
-- MAIÚSCULA porque é a forma que a Meta usa na Graph API e a que o formulário
-- já grava; alinhar o banco ao que a tela escreve evita ter de traduzir nos
-- dois sentidos no dia em que a sincronização existir.
--
-- O CHECK vem junto: normalizar sem travar deixa a próxima semente reabrir o
-- caso. `null` continua válido — campanha cadastrada à mão pode não ter estado
-- conhecido, e inventar um seria pior.
--
-- Idempotente: o `update` já filtra o que está fora da forma, e a constraint é
-- recriada por `drop ... if exists`.
-- =============================================================================

update public.ad_campaigns
   set status = upper(status)
 where status is not null
   and status <> upper(status);

alter table public.ad_campaigns
  drop constraint if exists ad_campaigns_status_maiusculo;

alter table public.ad_campaigns
  add constraint ad_campaigns_status_maiusculo
  check (status is null or status = upper(status));

comment on column public.ad_campaigns.status is
  'Estado da campanha na plataforma, em MAIÚSCULA (ACTIVE, PAUSED…), como a Graph API da Meta escreve e como o formulário grava. Hoje é sempre digitado à mão: nenhum código sincroniza com a Meta.';
