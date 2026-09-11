-- =============================================================================
-- 0097 · Sócio responde como administrador em `is_admin()`
--
-- Decisão do cliente (Douglas) em 10/09/2026, na revisão do sistema: onde ele
-- escreve "administrador", o sócio está incluído — os dois têm exatamente a
-- mesma permissão. `partner` deixa de ser o observador de leitura ampla e
-- escrita nenhuma que era desde a 0002.
--
-- POR QUE NÃO É O GATILHO DE PROMOÇÃO DA 0093. Aquela migration dava o papel
-- `admin` a todo `partner` por gatilho, e a 0094 a desfez porque a promoção
-- mexia em DADO: mudava a linha de `user_roles` da pessoa, aparecia no
-- `role_change_log` como se alguém tivesse concedido, e um `delete` direto na
-- linha desfazia a equivalência sem aviso. Aqui ninguém é promovido — a pessoa
-- continua com `partner` e só com `partner`. O que muda é a AUTORIZAÇÃO: a
-- pergunta "é administrador?" passa a responder sim para ela. Reverter é
-- reescrever uma função, não caçar linhas concedidas por engano.
--
-- POR QUE `is_admin()` E NÃO CADA POLICY. `is_admin()` é o gate de escrita
-- privilegiada em 138 pontos das migrations (policies, `set_profile_roles`,
-- `has_permission()`, `can_enter_stage()`, fechamento de mês). Redefinir a
-- função cobre os 138 de uma vez, sem tocar em policy nenhuma.
--
-- LIMITE CONHECIDO, dito com todas as letras: os 87 gates escritos como
-- `has_any_role('admin', <outro papel>)` — a esteira de CCA, as metas de
-- diretoria, as tabelas de marketing/SDR — NÃO passam a aceitar o sócio, porque
-- não perguntam por `is_admin()`. Nesses lugares o sócio continua barrado onde
-- o administrador entra.
-- ponytail: só `is_admin()`; evoluir quando alguém reclamar de uma tela
-- específica — aí se decide entre acrescentar `'partner'` naquele gate ou fazer
-- `has_any_role` tratar `'admin'` como "admin ou sócio".
--
-- CONSEQUÊNCIA: sócio passa a poder alterar papéis de outras pessoas, mexer na
-- matriz de permissões, fechar o mês e apagar dado. Era isso que estava sendo
-- pedido. Quem quiser um sócio que só acompanha deve receber `director`, que é
-- o papel de leitura ampla sem administrar (`can_read_all()`).
--
-- CONSEQUÊNCIA 2: as 15 asserções de `supabase/tests/` que cobram "sócio não
-- edita / não apaga / é somente leitura" passam a afirmar o contrário do que o
-- banco faz e precisam ser reescritas junto com esta decisão.
--
-- CONSEQUÊNCIA 3: a linha de `partner` na matriz de permissões vira decorativa,
-- porque `has_permission()` curto-circuita em `is_admin()`. O front já não
-- oferece o papel para edição lá (`EDITABLE_ROLES`).
--
-- Idempotente: `create or replace`.
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role('admin', 'partner');
$$;

comment on function public.is_admin() is
  'Administrador OU sócio (0097): decisão do cliente em 10/09/2026 de que os dois papéis têm a mesma permissão. Não promove ninguém — `partner` continua sendo `partner` em `user_roles`, só a autorização responde igual. Não cobre os gates escritos como `has_any_role(''admin'', …)`.';
