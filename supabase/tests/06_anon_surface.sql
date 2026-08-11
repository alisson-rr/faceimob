-- =============================================================================
-- Regressão da 0019 — a superfície anônima são exatamente três RPCs.
--
-- O grant default do Supabase dá EXECUTE em toda função nova de `public` para
-- `anon`. Antes da 0019 isso deixou 43 funções SECURITY DEFINER chamáveis sem
-- sessão — incluindo `recalc_deal_shares`, que reescreve rateio de negócio sem
-- nenhuma checagem interna. Este teste é o tripwire: função nova que nascer
-- executável por `anon` quebra o harness na hora, não no advisor semanas depois.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check6(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

\echo '== superfície anônima (0019) =='

do $$
declare
  extras text;
  n int;
begin
  -- Exatamente as 3 RPCs do Diário. has_function_privilege cobre também grant
  -- herdado via PUBLIC, então pega qualquer caminho de acesso.
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into extras, n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in
      ('public_daily_team', 'public_daily_submit', 'public_director_checkpoint');

  perform pg_temp.check6(n = 0,
    format('nenhuma função além das 3 RPCs é executável por anon (sobraram: %s)',
           coalesce(extras, 'nenhuma')));

  -- As 3 continuam acessíveis — revogar demais quebraria o Diário público.
  perform pg_temp.check6(
    has_function_privilege('anon', 'public.public_daily_team(text,text)', 'execute')
    and has_function_privilege('anon', 'public.public_daily_submit(text,text,jsonb)', 'execute')
    and has_function_privilege('anon', 'public.public_director_checkpoint(text,date,text)', 'execute'),
    'as 3 RPCs do Diário seguem executáveis por anon');

  -- recalc_deal_shares é interna: só triggers (SECURITY DEFINER) e service_role.
  perform pg_temp.check6(
    not has_function_privilege('anon', 'public.recalc_deal_shares(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.recalc_deal_shares(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.recalc_deal_shares(uuid)', 'execute'),
    'recalc_deal_shares restrita a service_role');
end;
$$;

\echo '== search_path pinado nos helpers (0019) =='

do $$
declare
  soltas text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into soltas
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in
      ('set_updated_at', 'normalize_phone', 'month_start', 'unaccent_fallback',
       'slugify', 'leads_normalize', 'leads_log_changes', 'deals_log_changes',
       'cca_cases_log', 'sdr_messages_touch', 'remarketing_contacts_normalize')
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c
                        where c like 'search_path=%'));

  perform pg_temp.check6(soltas is null,
    format('helpers com search_path fixo (soltas: %s)', coalesce(soltas, 'nenhuma')));
end;
$$;

\echo '== privilégios de tabela dos papéis (0023) =='

do $$
declare
  sem_grant text;
begin
  -- Regressão da 0023: banco novo tem que abrir. Antes dela, as 58 tabelas
  -- nasciam sem DML para os papéis do PostgREST e o app subia morto — o que
  -- passou despercebido porque o harness simula os grants nos stubs.
  select string_agg(c.relname, ', ' order by c.relname)
    into sem_grant
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not (
      has_table_privilege('authenticated', c.oid, 'SELECT')
      and has_table_privilege('authenticated', c.oid, 'INSERT')
      and has_table_privilege('service_role', c.oid, 'SELECT')
    );

  perform pg_temp.check6(sem_grant is null,
    format('toda tabela de public é acessível por authenticated/service_role (sem grant: %s)',
           coalesce(sem_grant, 'nenhuma')));

  -- TRUNCATE ignora RLS: nenhum papel de aplicação deve tê-lo.
  select string_agg(c.relname, ', ' order by c.relname)
    into sem_grant
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and has_table_privilege('anon', c.oid, 'TRUNCATE');

  perform pg_temp.check6(sem_grant is null,
    format('anon não trunca tabela nenhuma (tem: %s)', coalesce(sem_grant, 'nenhuma')));
end;
$$;

\echo 'superfície anônima ok'
