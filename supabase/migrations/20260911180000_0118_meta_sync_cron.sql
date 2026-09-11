-- =============================================================================
-- 0118 · Crons da sincronização com a Marketing API da Meta
--
-- DOIS JOBS, UMA EDGE (meta-sync), com a service role:
--  - faceimob-meta-sync · '0 9 * * *' = 06:00 em São Paulo (UTC-3 o ano todo).
--    Sincronização completa de toda conta ligada: gasto no livro, insights,
--    estado da conta e, logo depois, os alertas (meta_avaliar_alertas).
--  - faceimob-meta-estado-conta · '0 0,1,11-23 * * *' = de hora em hora, das
--    08:00 às 22:00 em São Paulo. Só o estado da conta (status, bloqueio, limite
--    e saldo), sem insights e sem IA: uma chamada à Meta por conta por hora.
--    Sem ele, "sem saldo" às 10:00 só seria avisado às 06:00 do dia seguinte.
--
-- A DISPATCH SÓ CONFERE SE HÁ CONTA LIGADA. "Sem token" quem decide é a edge:
-- ela responde 409, grava a execução como 'falhou' com a frase e abre o alerta
-- sync_falhou (uma vez; fecha na próxima ok). O token pode morar só no secret
-- da function (secrets.ts cai no Deno.env) e o SQL não o enxergaria — voltar
-- cedo aqui calaria a falha todo dia, com a tela mostrando número velho sem
-- motivo.
--
-- Idempotência: meta_sync_start recusa segunda execução simultânea da mesma
-- conta; rodar de novo no mesmo dia regrava a mesma janela (apaga e insere);
-- alertas deduplicados por dedupe_key; aviso de estado só na mudança (0117).
--
-- Padrão da 0018/0119: security definer para ler URL e chave do cofre,
-- execução revogada de public, anon e authenticated. Aplica sem pg_cron
-- (harness) e sem pg_net: net.http_post só é resolvida quando a função roda.
-- =============================================================================

create or replace function public.dispatch_meta_sync_modo(p_modo text)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  if p_modo is null or p_modo not in ('completo', 'estado') then
    raise exception 'Modo da sincronização inválido (completo ou estado).' using errcode = '22023';
  end if;

  -- Sem conta ligada não há o que sincronizar: nenhuma chamada HTTP.
  if not exists (select 1 from public.meta_ad_accounts where enabled) then
    return false;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  -- O aviso aparece no log do job e em cron_jobs_health() (0018).
  if v_url is null or v_key is null then
    raise warning 'dispatch_meta_sync: cadastre functions_url e service_role_key em Integrações.';
    return false;
  end if;

  -- A edge lê várias páginas da Meta por conta: o padrão de 5 s do pg_net
  -- desistiria antes da resposta.
  perform net.http_post(
    url                  := rtrim(v_url, '/') || '/meta-sync',
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_key
                            ),
    body                 := jsonb_build_object('modo', p_modo),
    timeout_milliseconds := 150000
  );
  return true;
end;
$$;

comment on function public.dispatch_meta_sync_modo(text) is
  'Gatilho da edge meta-sync: modo completo (sincronização diária) ou estado (leitura horária do estado da conta). Volta false sem HTTP quando não há conta de anúncios ligada; a falta do token a edge registra na execução. Chamada pelo pg_cron; lê URL e chave do cofre.';

create or replace function public.dispatch_meta_sync()
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.dispatch_meta_sync_modo('completo');
$$;

comment on function public.dispatch_meta_sync() is
  'Sincronização diária completa (cron faceimob-meta-sync). Volta false sem conta ligada.';

revoke all on function public.dispatch_meta_sync_modo(text) from public, anon, authenticated;
revoke all on function public.dispatch_meta_sync()          from public, anon, authenticated;
grant execute on function public.dispatch_meta_sync_modo(text) to service_role;
grant execute on function public.dispatch_meta_sync()          to service_role;

-- -----------------------------------------------------------------------------
-- Agendamento. Falha de agendamento vira aviso, não derruba a migration
-- (padrão da 0083/0117/0119).
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0118] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-sync') then
      perform cron.unschedule('faceimob-meta-sync');
    end if;
    perform cron.schedule(
      'faceimob-meta-sync',
      '0 9 * * *',
      $cmd$select public.dispatch_meta_sync();$cmd$
    );

    if exists (select 1 from cron.job where jobname = 'faceimob-meta-estado-conta') then
      perform cron.unschedule('faceimob-meta-estado-conta');
    end if;
    perform cron.schedule(
      'faceimob-meta-estado-conta',
      '0 0,1,11-23 * * *',
      $cmd$select public.dispatch_meta_sync_modo('estado');$cmd$
    );
    raise notice '[0118] sincronização da Meta às 06:00 e estado da conta de hora em hora (08:00-22:00), em São Paulo.';
  exception when others then
    raise warning '[0118] não foi possível agendar a sincronização da Meta: %', sqlerrm;
  end;
end
$do$;
