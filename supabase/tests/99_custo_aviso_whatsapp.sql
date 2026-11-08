-- =============================================================================
-- 0323 — avisos de lead novo por WhatsApp por dia: só quem gerencia
-- integrações lê, e a contagem separa aceitos, falhas e sem telefone.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.falha(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU: % — a chamada passou', p_label;
exception when others then
  if sqlerrm like 'FALHOU:%' then raise; end if;
  raise notice '  ok  % (%)', p_label, sqlerrm;
end;
$$;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000003230001';
  cor uuid := '00000000-0000-0000-0000-000003230002';
  r record;
  b record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c3230.test', '{"full_name":"Admin 3230"}'),
    (cor, 'cor@c3230.test', '{"full_name":"Corretor 3230"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  -- O banco de teste já tem avisos de outros cenários: mede a diferença.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select coalesce(sum(enviados), 0) e, coalesce(sum(falhas), 0) f, coalesce(sum(sem_telefone), 0) s,
         coalesce(sum(esperando), 0) w
    into b from public.whatsapp_avisos_por_dia(30);
  perform set_config('request.jwt.claims', null, true);

  -- Hoje: 2 aceitos, 1 falha, 1 sem telefone, 1 esperando; mais um aviso que
  -- não é de lead (fica de fora) e um de lead fora da janela.
  insert into public.notifications (profile_id, kind, title, body, channel, sent_at, last_error, created_at) values
    (cor, 'lead_assigned', 't', 'b', 'whatsapp', now(), null, now()),
    (cor, 'lead_assigned', 't', 'b', 'whatsapp', now(), null, now()),
    (cor, 'lead_assigned', 't', 'b', 'whatsapp', null, 'Meta 131026', now()),
    (cor, 'lead_assigned', 't', 'b', 'whatsapp', now(), 'perfil sem telefone', now()),
    (cor, 'lead_assigned', 't', 'b', 'whatsapp', null, null, now()),
    (cor, 'task_due',      't', 'b', 'whatsapp', now(), null, now()),
    (cor, 'lead_assigned', 't', 'b', 'whatsapp', now(), null, now() - interval '40 days');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.falha('select * from public.whatsapp_avisos_por_dia(30)', 'corretor não lê os avisos de WhatsApp');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select sum(enviados) - b.e e, sum(falhas) - b.f f, sum(sem_telefone) - b.s s, sum(esperando) - b.w w
    into r from public.whatsapp_avisos_por_dia(30);
  perform pg_temp.ok(r.e = 2 and r.f = 1 and r.s = 1 and r.w = 1,
    format('admin lê só os avisos de lead da janela (+%s/+%s/+%s/+%s)', r.e, r.f, r.s, r.w));
end;
$$;

rollback;
