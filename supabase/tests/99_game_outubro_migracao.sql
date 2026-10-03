-- =============================================================================
-- 0195 — outubro começa com os pontos do sistema anterior: os antigos saem
-- (com cópia) e o nome casa sem acento nem caixa.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  r uuid := '00000000-0000-0000-0000-000001950001';
  v_temporada uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (r,'r@a195.test','{"full_name":"Rudinei Teixeira de Souza"}');
  insert into public.user_roles(profile_id,role) values (r,'broker') on conflict do nothing;
  update public.game_seasons set closed_at = now(), period_end = greatest(period_start, current_date) where closed_at is null;
  insert into public.game_seasons(label, period_start) values ('Outubro 0195', date '2026-10-01') returning id into v_temporada;
  insert into public.game_events(season_id, profile_id, event_code, points) values (v_temporada, r, 'esteira', 140);
  perform set_config('t195.temporada', v_temporada::text, true);
end;
$$;

-- A mesma regra da migration; `\i` não serve: o CI manda o arquivo ao
-- container pelo stdin, sem o repositório.
select private.game_outubro_pontos_da_migracao_0195();

select pg_temp.ok(
  (select coalesce(sum(points), 0) from public.game_events
    where season_id = current_setting('t195.temporada')::uuid
      and profile_id = '00000000-0000-0000-0000-000001950001') = 40,
  'pontuação antiga sai e entram os 40 da migração');
select pg_temp.ok(
  exists (select 1 from private.game_events_antes_0195 where event_code = 'esteira' and points = 140),
  'o que saiu fica guardado');

rollback;
