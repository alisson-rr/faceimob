-- =============================================================================
-- Desfaz a Fase 5 (050_test_scenarios.sql)
--
-- Remove só o que a fase 5 criou — a faixa de UUID 70000000…7f000000 — e devolve
-- o testador ao estado anterior. As fases 1-4 ficam intactas.
--
-- NÃO é executado por `supabase db reset`: rode à mão quando quiser limpar.
--   psql "$DATABASE_URL" -f supabase/seeds/059_test_scenarios_rollback.sql
-- =============================================================================

-- Quem é o testador, resolvido uma vez e guardado numa tabela auxiliar.
--
-- Já foi `pg_temp.tester()`: o schema temporário não sobrevive ao seeder do CLI,
-- que envia o arquivo em lotes. Virou função em `public` e continuou quebrando,
-- porque o divisor de lotes corta no `;` de dentro do corpo `$$`. Uma tabela não
-- tem corpo para cortar e funciona igual no psql, no CLI e no script remoto.
-- Ela é removida no fim deste arquivo.
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

-- Ordem importa: filhos antes dos pais, senão a FK barra.
delete from public.developer_submissions where id::text like '7e000000-%';
delete from public.ad_campaigns          where id::text like '7d000000-%';
delete from public.annual_results        where id::text like '7c000000-%';
delete from public.game_events           where id::text like '7b000000-%';
delete from public.notifications         where id::text like '7a000000-%';
-- Os INSERTs de lead_assignments do seed disparam notify_lead_assigned, que
-- cria notificações com id aleatório — o padrão fixo acima não as alcança.
-- O link é determinístico ('/leads/<id>'), então a limpeza vai por ele.
delete from public.notifications
 where link ~ '^/leads/(75000000|73000000|72000000|70000000)-';
delete from public.visits                where id::text like '79000000-%';
delete from public.tasks                 where id::text like '78000000-%';
delete from public.checkins              where id::text like '77000000-%';
delete from public.lead_assignments      where id::text like '76000000-%'
                                            or id::text like '74000000-%'
                                            or id::text like '71000000-%';
delete from public.leads                 where id::text like '75000000-%'
                                            or id::text like '73000000-%'
                                            or id::text like '72000000-%'
                                            or id::text like '70000000-%';

delete from public.closed_months
 where notes = 'Fechado pelo seed de teste — editar negócio deste mês deve falhar.';

-- Testador volta ao estado original.
--
-- Mesma razão do seed: `profiles_guard_admin_columns` só deixa admin mexer em
-- `bypass_ip_check`, e num psql sem JWT `auth.uid()` é NULL. O script assume a
-- identidade do testador em vez de desligar a trava.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.seed_tester_ref)::text, 'role', 'authenticated')::text,
    true);
  update public.profiles set bypass_ip_check = false where id = (select id from public.seed_tester_ref);
end $$;

delete from public.distribution_group_members
 where profile_id = (select id from public.seed_tester_ref)
   and group_id in (select id from public.distribution_groups where kind = 'general');

delete from public.team_members
 where profile_id = (select id from public.seed_tester_ref)
   and team_id in (select id from public.teams where name = 'Equipe Paulista');

-- Ana, Bruno e Diego NÃO são removidos do grupo de distribuição de propósito:
-- a fase 2 já os coloca lá, e o BLOCO 6 só garante (`on conflict do update`).
-- Removê-los desfaria estado que não é desta fase.

do $$
begin
  raise notice '[059] Cenários de teste removidos. Fases 1-4 preservadas.';
end $$;

drop table if exists public.seed_tester_ref;
