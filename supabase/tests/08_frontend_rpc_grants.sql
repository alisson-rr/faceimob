-- =============================================================================
-- Contrato entre o frontend e os privilégios do banco.
--
-- Toda RPC que uma tela chama precisa de `execute` para `authenticated` numa
-- migration. No projeto remoto isso passava despercebido: ele foi criado quando
-- o Supabase concedia execute em bloco, então funcionava mesmo sem a concessão
-- escrita. Num banco novo (0023) só vale o que está declarado.
--
-- A lista sai de `grep -rhoE '\.rpc\(' src/`. Tela nova que chame RPC nova sem
-- a concessão quebra aqui, não em produção.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check8(cond boolean, label text)
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

\echo '== RPCs chamadas pelo frontend estão liberadas para authenticated =='

do $$
declare
  alvo text;
  faltando text[] := '{}';
  chamadas text[] := array[
    'add_deal_comment', 'checkin_eligibility', 'claim_lead', 'close_game_season',
    'close_month_and_season', 'convert_lead_to_deal', 'cron_jobs_health',
    'current_game_season', 'current_shift', 'current_work_date', 'distribution_queue', 'ip_is_allowed',
    'import_remarketing_list', 'list_integrations', 'marketing_campaign_stats',
    'reassign_lead', 'remarketing_list_stats',
    'review_deal_documents', 'submit_deal_for_manager_review',
    'set_integration_secret', 'set_public_link_pin'
  ];
begin
  foreach alvo in array chamadas loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = alvo
        and has_function_privilege('authenticated', p.oid, 'execute')
    ) then
      faltando := faltando || alvo;
    end if;
  end loop;

  perform pg_temp.check8(cardinality(faltando) = 0,
    format('as %s RPCs de tela executam como authenticated (faltando: %s)',
           cardinality(chamadas), coalesce(array_to_string(faltando, ', '), '')));
end;
$$;

\echo '== engrenagens internas seguem fora do alcance do usuário logado =='

do $$
declare
  alvo text;
  vazadas text[] := '{}';
  internas text[] := array[
    'assign_lead', 'release_expired_leads', 'auto_checkout_expired',
    'award_game_points', 'assign_queued_leads', 'recalc_deal_shares',
    'dispatch_pending_notifications', 'dispatch_pending_submissions',
    'submit_deal_for_analysis'
  ];
begin
  foreach alvo in array internas loop
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = alvo
        and has_function_privilege('authenticated', p.oid, 'execute')
    ) then
      vazadas := vazadas || alvo;
    end if;
  end loop;

  -- Se isto quebrar, provavelmente alguém escreveu um
  -- `grant execute on all functions ... to authenticated`: a roleta e a
  -- pontuação passariam a ser chamáveis direto pelo navegador.
  perform pg_temp.check8(cardinality(vazadas) = 0,
    format('rotinas internas não são executáveis por authenticated (vazaram: %s)',
           coalesce(array_to_string(vazadas, ', '), '')));
end;
$$;

\echo 'contrato de RPC do frontend ok'
