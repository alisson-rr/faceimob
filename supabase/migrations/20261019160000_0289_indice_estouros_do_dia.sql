-- =============================================================================
-- 0289 · Índice para "leads devolvidos por estouro de prazo hoje"
--
-- 19/10/2026: ao meio-dia a API esgotou as conexões com o banco (PGRST003) e
-- cancelou consultas por tempo (57014). Uma das consultas no registro é a dos
-- estouros do dia (`lead_assignments` filtrada por `release_reason = 'timeout'`
-- e `released_at >= hoje`), que todo corretor carrega na tela de leads: sem
-- índice para o filtro, cada chamada varria a tabela inteira das atribuições
-- da roleta, que só cresce. Índice parcial: só as linhas de estouro, ordenadas
-- pela hora da devolução.
-- =============================================================================
create index if not exists lead_assignments_estouro_idx
  on public.lead_assignments (released_at)
  where release_reason = 'timeout';
