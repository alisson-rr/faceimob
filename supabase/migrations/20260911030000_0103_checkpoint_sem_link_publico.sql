-- =============================================================================
-- 0103 · O Checkpoint da diretoria sai da superfície anônima
--
-- Decisão do cliente (Douglas) em 10/09/2026: o checkpoint "não precisa ser um
-- link público, pode ser igual aquela tela". A rota anônima `/diretor/:slug` e
-- a página `PublicDirectorCheckpoint` foram removidas na mesma rodada; o
-- conteúdo (funil da semana por equipe, acumulado do mês da 0039 e as
-- pendências de dia útil) passou para `/checkpoint`, que é tela logada e faz o
-- recorte por hierarquia — admin e sócio veem todos, o diretor vê o dele e o
-- dos gerentes dele, o gerente vê só o dele.
--
-- O DIÁRIO NÃO MUDA. `public_daily_team` e `public_daily_submit` continuam
-- anônimas: o gerente lança o diário por link com PIN, sem login, e é assim que
-- o cliente quer. A superfície anônima passa de TRÊS RPCs para DUAS.
--
-- POR QUE REVOGAR E NÃO DROPAR. `drop function` derruba junto qualquer chamador
-- que não esteja neste repositório (um relatório, um script de operação, uma
-- integração) e não deixa caminho de volta a não ser recriar 200 linhas de SQL.
-- Revogar o EXECUTE de `anon` fecha exatamente o que a decisão fechou — o
-- acesso SEM SESSÃO — e é reversível com um `grant`. A função segue existindo,
-- `security definer`, chamável por `authenticated` e por `service_role`.
--
-- `from public, anon` e não só `from anon`: é a mesma fórmula da 0019. Postgres
-- concede EXECUTE a PUBLIC por padrão em função nova, e esta nasceu na 0009,
-- ANTES de a 0019 fechar a torneira — revogar só de `anon` deixaria o privilégio
-- herdado de PUBLIC de pé e o revoke seria decorativo. `authenticated` mantém o
-- grant PRÓPRIO que a 0080 emitiu, então não é alcançado por este revoke.
--
-- CONSEQUÊNCIA MEDIDA: quem tiver um link `/diretor/<slug>` salvo passa a
-- receber 404 do app (a rota não existe mais) e, se chamar a RPC direto sem
-- sessão, 42501. As linhas de `public_links` com `kind = 'director_checkpoint'`
-- continuam gravadas de propósito — apagá-las é decisão de operação, não de
-- migration, e é o que permite reverter tudo com um `grant`.
--
-- Idempotente: `revoke` de privilégio ausente é no-op.
-- =============================================================================

revoke execute on function public.public_director_checkpoint(text, date, text)
  from public, anon;

comment on function public.public_director_checkpoint(text, date, text) is
  'Funil da semana por equipe (com gerente, meta da equipe e link do Diário), validade do link, pendências em dia útil COM lançamento e acumulado do mês de todas as equipes do diretor. Slug desconhecido responde igual a slug conhecido. SEM ACESSO ANÔNIMO desde a 0103: o checkpoint virou tela logada (/checkpoint) e a superfície anônima passou a ser só public_daily_team e public_daily_submit.';
