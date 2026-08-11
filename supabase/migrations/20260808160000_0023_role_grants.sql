-- =============================================================================
-- 0023 — Privilégios de tabela para os papéis do PostgREST
--
-- Descoberto ao subir um banco limpo só com as migrations (stack local do CLI):
-- as 58 tabelas de `public` ficaram SEM select/insert/update/delete para
-- `anon`, `authenticated` e `service_role`. O app não abre — toda consulta
-- volta "permission denied for table ..." — e o RLS sequer entra em cena,
-- porque o GRANT nega antes.
--
-- Por que ninguém tinha visto: o projeto remoto foi criado quando o Supabase
-- concedia esses privilégios por padrão, então lá está tudo liberado; e o
-- harness de teste **simula** os grants em `tests/00_supabase_stubs.sql`
-- ("Supabase concede tudo em public para anon/authenticated e usa RLS como
-- portão — não os GRANTs"). Ou seja: os testes passavam e o remoto funcionava,
-- enquanto qualquer ambiente novo (projeto novo, branch de preview, restauração
-- de backup, self-hosted) nascia quebrado. Esta migration torna o schema
-- autossuficiente.
--
-- Modelo, que é o documentado pelo Supabase: o GRANT abre a porta da tabela e o
-- **RLS é o porteiro** de qual linha cada um enxerga. Toda tabela de `public`
-- tem RLS ligada — o `validate-schema.sh` falha se alguma não tiver.
--
-- Privilégio mínimo de propósito: só os quatro verbos que o PostgREST usa.
-- TRUNCATE fica de fora porque ignora RLS, e REFERENCES/TRIGGER porque papel de
-- aplicação não cria constraint nem gatilho.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

-- Funções: concessão em bloco e depois revogação nominal das internas.
--
-- A concessão ampla não é preguiça — é necessidade. As policies de RLS chamam
-- helpers (`auth_visible_profiles`, `can_see_deal`, `has_role`, `is_admin`…) e
-- a expressão da policy roda como o usuário que consulta: sem `execute` nesses
-- helpers, todo SELECT morre com "permission denied for function". Manter uma
-- lista de permitidos significaria caçar cada helper novo que entrasse numa
-- policy, e o erro só apareceria em produção.
--
-- A lista de exceções é a inversa e é curta: as engrenagens que rodam por cron
-- ou por edge function e que ninguém deve poder chamar do navegador. Elas já
-- nasceram restritas nas migrations que as criaram; a revogação aqui repõe
-- essa decisão depois do bloco, e `tests/08_frontend_rpc_grants.sql` é o
-- tripwire de que ela continua valendo.
grant execute on all functions in schema public to authenticated, service_role;

revoke execute on function public.assign_lead(uuid)                    from authenticated;
revoke execute on function public.assign_queued_leads()                from authenticated;
revoke execute on function public.release_expired_leads()              from authenticated;
revoke execute on function public.auto_checkout_expired()              from authenticated;
revoke execute on function public.recalc_deal_shares(uuid)             from authenticated;
revoke execute on function public.dispatch_pending_notifications()     from authenticated;
revoke execute on function public.dispatch_pending_submissions()       from authenticated;
revoke execute on function public.award_game_points(uuid, text, text, uuid, timestamptz)
  from authenticated;

-- Objeto novo já nasce com o mesmo contrato, senão a próxima migration que
-- criar tabela reintroduz exatamente este bug.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- `private` continua fechado (0001) e o cofre segue só pela porta da 0016.
revoke all on schema private from public, anon, authenticated;
