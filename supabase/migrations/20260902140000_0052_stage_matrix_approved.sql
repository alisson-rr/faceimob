-- =============================================================================
-- 0052 · O corretor não entra em "Aprovado"
--
-- Medido na homologação em 02/09/2026:
--
--   role     | code            | can_enter | can_exit
--   broker   | approved        | TRUE      | false
--   manager  | approved        | false     | false
--
-- Ou seja: o corretor podia arrastar o próprio negócio para "Aprovado" — a
-- etapa que significa crédito aprovado — enquanto o gerente não podia. Aprovar
-- é decisão da esteira de crédito (`cca_cases`), não de quem vende; é por isso
-- que `deals_guard_stage()` (0028) recusa a entrada em `approved` sem a
-- conferência documental aprovada.
--
-- Duas travas para o mesmo fato discordavam: a do banco recusava, a da matriz
-- permitia. Quem lê a tela via o caminho aberto e só descobria no erro — e
-- "Aprovado" é número que a diretoria olha.
--
-- Nenhuma migration semeia `stage_permissions`: as linhas entram pela tela de
-- Permissões. Esta corrige o estado e NÃO impede que um admin volte a conceder
-- pela tela, que continua sendo a fonte de verdade da matriz. É correção de
-- dado, não trava nova.
--
-- `e2e/broker/etapas.spec.ts` ("a matriz realmente nega 'Aprovado' ao corretor")
-- cobra isto desde antes desta sprint e vinha reprovando.
-- =============================================================================

update public.stage_permissions sp
   set can_enter = false
  from public.pipeline_stages ps
 where ps.id = sp.stage_id
   and ps.code = 'approved'
   and sp.role = 'broker'
   and sp.can_enter;
