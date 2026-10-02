-- Recuperação de novos leads da Meta quando o webhook não os entrega.
-- Sem marco de ativação, o cron não faz HTTP nem importa leads antigos.
alter table public.automation_settings
  add column if not exists meta_leads_started_at timestamptz default null,
  add column if not exists meta_leads_last_sync_at timestamptz default null;

comment on column public.automation_settings.meta_leads_started_at is
  'Marco inicial fixo da recuperação de leads da Meta. Nulo mantém a recuperação desligada; leads anteriores nunca entram automaticamente.';
comment on column public.automation_settings.meta_leads_last_sync_at is
  'Última janela concluída da recuperação de leads da Meta, sem avançar em caso de falha.';

create or replace function public.dispatch_meta_sync_modo(p_modo text)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
  v_started_at timestamptz;
  v_paused boolean;
begin
  if p_modo is null or p_modo not in ('completo', 'estado', 'leads') then
    raise exception 'Modo da sincronização inválido (completo, estado ou leads).' using errcode = '22023';
  end if;

  if p_modo = 'leads' then
    select s.meta_leads_started_at, s.leads_paused
      into v_started_at, v_paused
      from public.automation_settings s where s.id;
    if v_started_at is null or coalesce(v_paused, false) then
      return false;
    end if;
  elsif not exists (select 1 from public.meta_ad_accounts where enabled) then
    return false;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  if v_url is null or v_key is null then
    raise warning 'dispatch_meta_sync: cadastre functions_url e service_role_key em Integrações.';
    return false;
  end if;

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
  'Gatilho de meta-sync com URL e chave do cofre. Completo/estado exigem conta ligada; leads exige marco inicial e pausa desligada. Exclusivo da service role.';

revoke all on function public.dispatch_meta_sync_modo(text) from public, anon, authenticated;
grant execute on function public.dispatch_meta_sync_modo(text) to service_role;

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0192] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-leads') then
      perform cron.unschedule('faceimob-meta-leads');
    end if;
    perform cron.schedule(
      'faceimob-meta-leads',
      '*/2 * * * *',
      $cmd$select public.dispatch_meta_sync_modo('leads');$cmd$
    );
  exception when others then
    raise warning '[0192] não foi possível agendar a recuperação de leads da Meta: %', sqlerrm;
  end;
end
$do$;
