-- Regressão Jenifer: receber, atender ou perder prazo em A não reordena B.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
-- Determinístico em qualquer hora/dia; substituição desfeita no rollback.
create or replace function public.roleta_horario_aberto() returns boolean
language sql stable as $$ select true $$;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice 'ok: %', label;
end;
$$;

do $$
declare
  ana uuid := '00000000-0000-0000-0000-000003200001';
  bia uuid := '00000000-0000-0000-0000-000003200002';
  ga uuid;
  gb uuid;
  turno uuid;
  lead uuid;
  assignment uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana, 'ana@fila320.test', '{"full_name":"Ana 320"}'),
    (bia, 'bia@fila320.test', '{"full_name":"Bia 320"}');
  insert into public.user_roles (profile_id, role) values (ana, 'broker'), (bia, 'broker') on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active)
    values ('Fila A 320', 'fila-a-320', 'specific', true) returning id into ga;
  insert into public.distribution_groups (name, slug, kind, active)
    values ('Fila B 320', 'fila-b-320', 'specific', true) returning id into gb;
  insert into public.distribution_group_members (group_id, profile_id, active)
    values (ga, ana, true), (ga, bia, true), (gb, ana, true), (gb, bia, true);
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
    values ('integral-320', 'Integral 320', '00:00', '00:00', '23:59:59.999999', -320) returning id into turno;
  insert into public.checkins (profile_id, shift_id, work_date, checked_in_at) values
    (ana, turno, public.current_work_date(), now() - interval '60 minutes'),
    (bia, turno, public.current_work_date(), now() - interval '50 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  perform pg_temp.ok((select queue_position = 1 from public.distribution_queue_interna(ga) where profile_id = ana), 'Ana começa em primeiro em A');
  perform pg_temp.ok((select queue_position = 1 from public.distribution_queue_interna(gb) where profile_id = ana), 'Ana começa em primeiro em B');

  insert into public.leads (full_name, phone, status, distribution_group_id)
    values ('Contato teste 320', '11900320001', 'attending', ga) returning id into lead;
  insert into public.lead_assignments (lead_id, profile_id, group_id, assigned_at, deadline, counts_for_queue)
    values (lead, ana, ga, now() - interval '5 minutes', now() + interval '5 minutes', true) returning id into assignment;
  perform pg_temp.ok(not exists(select 1 from public.distribution_queue_interna(ga) where profile_id = ana)
    and not exists(select 1 from public.distribution_queue_interna(gb) where profile_id = ana), 'trava global de atendimento preservada');

  update public.lead_assignments set responded_at = now() where id = assignment;
  perform pg_temp.ok((select queue_position = 2 from public.distribution_queue_interna(ga) where profile_id = ana), 'atender em A manda Ana ao fim de A');
  perform pg_temp.ok((select queue_position = 1 and last_turn_at is null and last_assigned_at is null
    from public.distribution_queue_interna(gb) where profile_id = ana), 'atender em A preserva posição e histórico de B');
  perform pg_temp.ok((select posicao = 1 and last_turn_at is null from public.fila_em_formacao()
    where group_id = gb and profile_id = ana), 'fila exibida de B também fica independente');
  perform pg_temp.ok((select posicao = 2 from public.fila_em_formacao()
    where group_id = ga and profile_id = ana), 'fila exibida de A acompanha atendimento');
  perform pg_temp.ok(not exists(select 1 from public.fila_em_formacao() where profile_id <> ana), 'corretor continua vendo só sua fila');

  update public.lead_assignments set responded_at = null, released_at = now(), release_reason = 'timeout' where id = assignment;
  perform pg_temp.ok((select queue_position = 2 from public.distribution_queue_interna(ga) where profile_id = ana), 'timeout reordena A');
  perform pg_temp.ok((select queue_position = 1 from public.distribution_queue_interna(gb) where profile_id = ana), 'timeout em A não reordena B');
  update public.lead_assignments set counts_for_queue = false where id = assignment;
  perform pg_temp.ok((select queue_position = 1 from public.distribution_queue_interna(ga) where profile_id = ana), 'repasse fora da roleta não mexe na ordem');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.distribution_queue_interna(uuid)', 'execute'), 'fila interna não fica pública');
end;
$$;
rollback;
