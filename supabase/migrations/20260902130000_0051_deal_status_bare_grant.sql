-- =============================================================================
-- 0051 · `deal_status_bare` volta a ser executável por `authenticated`
--
-- A 0037 revogou a função de todo mundo:
--
--   revoke all on function public.deal_status_bare(text) from public, anon, authenticated;
--
-- Mas `deals_guard_esteira_label()` — o gatilho que roda em TODO insert e
-- update de `deals` — a chama, e é `SECURITY INVOKER`. Trigger em Postgres não
-- exige privilégio sobre a própria função do gatilho, mas exige sobre o que ela
-- chama, com o privilégio de quem disparou. Resultado: qualquer usuário
-- autenticado que criasse ou editasse um negócio levava
-- `42501: permission denied for function deal_status_bare`, que o PostgREST
-- devolve como **403**.
--
-- Sintoma medido na suíte E2E contra a homologação: 8 testes falhando com o
-- modal do negócio que não fecha — criar negócio, editar, perder pelo Status 2,
-- rateio, matriz de etapas. Não era a tela: era todo `write` em `deals`.
--
-- POR QUE O GRANT, E NÃO `SECURITY DEFINER` NO GATILHO
--
-- Tornar `deals_guard_esteira_label()` definer faria `current_user` virar o dono
-- (postgres) dentro dele — e a condição de escape do próprio guard é
-- `current_user not in ('postgres','service_role')`. A trava passaria a liberar
-- todo mundo, sempre: a suíte ficaria verde com a proteção da 0037 morta.
-- Correção que apaga o teste em vez do defeito.
--
-- `deal_status_bare` é normalização de texto pura — `regexp_replace(upper(btrim
-- (...)))`, sem tabela, sem dado, sem privilégio. Não há o que proteger nela; a
-- revogação foi defesa sem ameaça, e custou a escrita inteira de `deals`.
-- `anon` continua de fora: a superfície anônima são as três RPCs do diário.
-- =============================================================================

grant execute on function public.deal_status_bare(text) to authenticated;

comment on function public.deal_status_bare(text) is
  'Rótulo de status sem prefixo numerado, aparado, caixa alta — espelha bare() de src/lib/dealStatus.ts. Executável por authenticated porque deals_guard_esteira_label (invoker) a chama em todo write de deals.';
