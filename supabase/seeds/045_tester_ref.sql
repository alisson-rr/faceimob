-- =============================================================================
-- Fase 4.5 — Quem é o testador
--
-- Resolve dinamicamente porque o e-mail do admin real muda por ambiente. Ordem:
-- 1) dev.alisson.rosa@gmail.com  2) qualquer admin que não seja o do seed
-- 3) o admin do seed. `union all … limit 1` devolve o primeiro que existir.
--
-- Por que isto mora num arquivo próprio, e não no 050 que o consome: o seeder
-- do CLI manda cada arquivo como UM lote (`SendBatch` do pgx), e num lote todas
-- as instruções são preparadas antes de a primeira rodar. Criar o objeto e usá-lo
-- no mesmo arquivo falha com "does not exist" — que era o erro que travava
-- `supabase db reset`. Entre arquivos funciona, porque cada um é um lote novo.
--
-- Antes disto era `pg_temp.tester()`: além do problema do lote, o schema
-- temporário nem sobrevive entre eles. O 050 remove a tabela no fim.
-- =============================================================================

drop table if exists public.seed_tester_ref;

create table public.seed_tester_ref as
select id from public.profiles where email = 'dev.alisson.rosa@gmail.com'
union all
select p.id from public.profiles p
 where exists (select 1 from public.user_roles r
                where r.profile_id = p.id and r.role = 'admin')
   and p.id <> '10000000-0000-0000-0000-000000000001'
union all
select '10000000-0000-0000-0000-000000000001'::uuid
limit 1;
