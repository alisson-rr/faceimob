-- =============================================================================
-- 0265 · Anúncios da Meta no CRM: arte e copy sem subir nada à mão
--
-- Pedido de 10/10/2026: a tela "Campanhas do Facebook" do site dentro do CRM,
-- e no card do lead um popup com a arte (1:1) e a copy do anúncio que ele
-- clicou — "sem ter que subir à mão e atualizar a cada campanha nova e quando
-- desligar".
--
--  * `meta_anuncios`: um por anúncio. A sincronização (meta-sync, modo
--    'anuncios', de hora em hora) grava os ativos da conta e marca como
--    inativos os que saíram; e busca também os anúncios de leads dos últimos
--    90 dias que ainda não estão aqui (o popup funciona mesmo depois de a
--    campanha ser desligada).
--  * A arte é copiada para o bucket público `anuncios` (`imagem_path`): o link
--    da Meta expira em dias. Anúncio já é público; nada sensível vai ali.
--  * Leitura para todo autenticado; escrita só pela service role.
-- =============================================================================

create table if not exists public.meta_anuncios (
  ad_id           text primary key check (ad_id ~ '^[0-9]+$'),
  account_id      uuid references public.meta_ad_accounts(id) on delete set null,
  nome            text,
  campanha_id     text,
  campanha_nome   text,
  status          text,
  ativo           boolean not null default false,
  formato         text not null default 'imagem' check (formato in ('imagem', 'video', 'carrossel')),
  copy            text,
  titulo          text,
  -- Link da Meta (expira) e cópia no bucket `anuncios` (não expira).
  imagem_meta_url text,
  imagem_path     text,
  -- Carrossel: [{meta_url, path}] na ordem do anúncio.
  imagens         jsonb not null default '[]'::jsonb,
  preview_url     text,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists meta_anuncios_ativo_idx on public.meta_anuncios (ativo, campanha_nome);

drop trigger if exists meta_anuncios_set_updated_at on public.meta_anuncios;
create trigger meta_anuncios_set_updated_at
  before update on public.meta_anuncios
  for each row execute function public.set_updated_at();

comment on table public.meta_anuncios is
  'Anúncios da conta Meta com arte e copy (0265), sincronizados de hora em hora. Lidos pela tela Campanhas e pelo card do lead.';

alter table public.meta_anuncios enable row level security;
drop policy if exists meta_anuncios_select on public.meta_anuncios;
create policy meta_anuncios_select on public.meta_anuncios
  for select to authenticated using (true);
revoke all on public.meta_anuncios from anon;
grant select on public.meta_anuncios to authenticated;

insert into storage.buckets (id, name, public)
values ('anuncios', 'anuncios', true)
on conflict (id) do update set public = true;

-- -----------------------------------------------------------------------------
-- Anúncios de leads recentes que ainda não foram buscados.
-- -----------------------------------------------------------------------------
create or replace function public.meta_anuncios_faltando(p_limite int default 50)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.ad_id
    from public.leads l
   where l.ad_id ~ '^[0-9]+$'
     and l.created_at >= now() - interval '90 days'
     and not exists (select 1 from public.meta_anuncios a where a.ad_id = l.ad_id)
   group by l.ad_id
   order by max(l.created_at) desc
   limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;
revoke all on function public.meta_anuncios_faltando(int) from public, anon, authenticated;
grant execute on function public.meta_anuncios_faltando(int) to service_role;

-- -----------------------------------------------------------------------------
-- Menu: todos os papéis.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description)
values ('menu.campanhas', 'Campanhas Facebook', 'menu',
        'Anúncios ativos da Meta com arte e copy, para replicar nas conversas.')
on conflict (code) do update
  set label = excluded.label, category = excluded.category, description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
select r, 'menu.campanhas', true
  from unnest(enum_range(null::public.app_role)) as r
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------
-- Gatilho da sincronização: aceita o modo 'anuncios' (igual à 0192 no resto).
-- -----------------------------------------------------------------------------
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
  if p_modo is null or p_modo not in ('completo', 'estado', 'leads', 'anuncios') then
    raise exception 'Modo da sincronização inválido (completo, estado, leads ou anuncios).' using errcode = '22023';
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

revoke all on function public.dispatch_meta_sync_modo(text) from public, anon, authenticated;
grant execute on function public.dispatch_meta_sync_modo(text) to service_role;

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0265] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-anuncios') then
      perform cron.unschedule('faceimob-meta-anuncios');
    end if;
    perform cron.schedule('faceimob-meta-anuncios', '20 * * * *',
      $cmd$select public.dispatch_meta_sync_modo('anuncios');$cmd$);
  exception when others then
    raise warning '[0265] não foi possível agendar a sincronização dos anúncios: %', sqlerrm;
  end;
end
$do$;
