-- =============================================================================
-- 0019 — Endurecimento da superfície anônima e search_path
--
-- Os advisors de segurança do Supabase (08/08) mostraram 43 funções SECURITY
-- DEFINER executáveis pelo papel `anon`: o grant default do Supabase em
-- `public` alcança toda função nova, e as migrations até aqui só revogavam
-- caso a caso. O invariante do projeto é que a superfície anônima são
-- EXATAMENTE as três RPCs do Diário (`public_daily_team`,
-- `public_daily_submit`, `public_director_checkpoint`).
--
-- O caso grave: `recalc_deal_shares` é SECURITY DEFINER, não tem checagem
-- interna de autorização e estava chamável sem sessão — uma requisição
-- anônima podia reescrever o rateio (`share_pct`) de qualquer negócio.
--
-- 1. Revoga EXECUTE de `public`/`anon` em toda função de `public`, exceto as 3.
-- 2. Default privileges: função nova já nasce sem EXECUTE para `anon`.
-- 3. `recalc_deal_shares` vira interna (triggers + service_role): nenhuma tela
--    a chama e os triggers que a usam são SECURITY DEFINER.
-- 4. Pina `search_path` nas 11 funções que os advisors apontaram como mutável.
--
-- `authenticated` mantém os grants existentes: as RPCs de usuário logado são
-- gated por RLS ou por checagem interna, e revogar em massa quebraria o app.
-- =============================================================================

-- 1. Superfície anônima = 3 RPCs -----------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in
        ('public_daily_team', 'public_daily_submit', 'public_director_checkpoint')
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
  end loop;
end;
$$;

-- 2. Função nova não nasce executável por anon.
-- Escopo restrito ao schema public de propósito: o escopo global alcançaria
-- também pg_temp e quebraria os helpers que o harness de teste cria lá.
alter default privileges in schema public revoke execute on functions from public, anon;

-- 3. recalc_deal_shares é chamada pelos triggers de deal_participants (que são
-- SECURITY DEFINER) e por edge functions via service_role. Nenhuma tela a chama.
revoke execute on function public.recalc_deal_shares(uuid) from authenticated;
grant execute on function public.recalc_deal_shares(uuid) to service_role;

-- 4. search_path fixo nas funções que os advisors apontaram ---------------------
-- Todas referenciam apenas objetos qualificados ou built-ins; o pin fecha a
-- janela de um objeto malicioso sombrear um nome durante a execução.

alter function public.set_updated_at()                  set search_path = public, pg_temp;
alter function public.normalize_phone(text)             set search_path = public, pg_temp;
alter function public.month_start(date)                 set search_path = public, pg_temp;
alter function public.unaccent_fallback(text)           set search_path = public, pg_temp;
alter function public.slugify(text)                     set search_path = public, pg_temp;
alter function public.leads_normalize()                 set search_path = public, pg_temp;
alter function public.leads_log_changes()               set search_path = public, pg_temp;
alter function public.deals_log_changes()               set search_path = public, pg_temp;
alter function public.cca_cases_log()                   set search_path = public, pg_temp;
alter function public.sdr_messages_touch()              set search_path = public, pg_temp;
alter function public.remarketing_contacts_normalize()  set search_path = public, pg_temp;
