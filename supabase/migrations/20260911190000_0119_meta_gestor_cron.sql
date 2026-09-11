-- =============================================================================
-- 0119 · Cron do gestor de tráfego IA (F2.2)
--
-- Todo dia às 10:00 UTC (07:00 em São Paulo, UTC-3 o ano todo), uma hora
-- depois da sincronização das 06:00, o pg_cron chama a edge
-- meta-traffic-manager com a service role. Ela analisa cada conta ligada e põe
-- as ações sugeridas na fila como PROPOSTA (meta_action_propose, 0116): nada
-- executa sem uma pessoa aprovar pelo meta-campaign-action.
--
-- A dispatch só confere se há conta ligada. "Chave da OpenAI ausente" quem
-- decide é a edge, que grava a execução como falhou com a frase: a chave pode
-- morar só no secret da function (secrets.ts cai no Deno.env), e o SQL não a
-- enxergaria — voltar cedo aqui calaria a falha todo dia.
--
-- Custo previsível: o índice único (account_id, kind, run_date) where trigger
-- = 'cron' da 0116 faz a segunda chamada no mesmo dia receber a execução
-- existente, sem IA nova; e a proposta repetida não duplica (índice parcial).
--
-- Mesmo padrão da 0018: security definer para ler URL e chave do cofre, sem
-- parâmetro, sem retorno, execução revogada de public, anon e authenticated.
-- Aplica sem pg_cron (harness) e sem pg_net: net.http_post só é resolvida
-- quando a função roda.
-- =============================================================================

create or replace function public.dispatch_meta_gestor()
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  -- Sem conta ligada não há o que analisar: nenhuma chamada HTTP.
  if not exists (select 1 from public.meta_ad_accounts where enabled) then
    return;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  -- O aviso aparece no log do job e em cron_jobs_health() (0018).
  if v_url is null or v_key is null then
    raise warning 'dispatch_meta_gestor: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  -- A edge espera a IA de cada conta (até 45 s): o padrão de 5 s do pg_net
  -- desistiria antes da resposta.
  perform net.http_post(
    url                  := rtrim(v_url, '/') || '/meta-traffic-manager',
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_key
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;

revoke all on function public.dispatch_meta_gestor() from public, anon, authenticated;
grant execute on function public.dispatch_meta_gestor() to service_role;

comment on function public.dispatch_meta_gestor() is
  'Gatilho diário da edge meta-traffic-manager (gestor de tráfego IA). Volta sem HTTP quando não há conta de anúncios ligada; a falta da chave da OpenAI a edge registra na execução. Chamada pelo pg_cron; lê URL e chave do cofre.';

-- -----------------------------------------------------------------------------
-- Agendamento: 10:00 UTC = 07:00 em São Paulo. Falha de agendamento vira
-- aviso, não derruba a migration (padrão da 0083/0117).
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0119] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-gestor-ia') then
      perform cron.unschedule('faceimob-meta-gestor-ia');
    end if;
    perform cron.schedule(
      'faceimob-meta-gestor-ia',
      '0 10 * * *',
      $cmd$select public.dispatch_meta_gestor();$cmd$
    );
    raise notice '[0119] gestor de tráfego IA agendado para 07:00 em São Paulo.';
  exception when others then
    raise warning '[0119] não foi possível agendar o gestor de tráfego IA: %', sqlerrm;
  end;
end
$do$;
