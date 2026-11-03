-- =============================================================================
-- 0316 — reativar lead perdido/descartado direto para um corretor.
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
  adm  uuid := '00000000-0000-0000-0000-000003160001';
  cor  uuid := '00000000-0000-0000-0000-000003160002';
  v_desc uuid;
  v_perd uuid;
  v_aberto uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c3160.test', '{"full_name":"Admin 3160"}'),
    (cor, 'cor@c3160.test', '{"full_name":"Corretor 3160"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  insert into public.leads (full_name, phone, status, lost_reason)
  values ('Descartado 316', '11900316001', 'discarded', 'Não responde') returning id into v_desc;
  insert into public.leads (full_name, phone, status, lost_reason, lost_at)
  values ('Perdido 316', '11900316002', 'lost', 'Sem interesse', now()) returning id into v_perd;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Aberto 316', '11900316003', 'attending', cor, now(), now() + interval '1 day') returning id into v_aberto;

  -- O corretor não reativa: é da liderança, como a realocação.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.falha(format('select public.reativar_lead(%L, %L)', v_desc, cor), 'corretor não reativa lead');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.reativar_lead(v_desc, cor);
  perform pg_temp.ok(
    (select status = 'assigned' and assigned_to = cor and lost_reason is null and attend_deadline is null
       from public.leads where id = v_desc),
    'o descartado volta em aberto, com o corretor e sem o motivo do encerramento');
  perform pg_temp.ok(
    exists (select 1 from public.lead_events where lead_id = v_desc and kind = 'reactivated'),
    'o histórico registra a reativação');

  perform public.reativar_lead(v_perd, cor);
  perform pg_temp.ok((select status = 'assigned' and lost_at is null from public.leads where id = v_perd),
    'o perdido também volta (lost_at sai junto com o status)');

  perform pg_temp.falha(format('select public.reativar_lead(%L, %L)', v_aberto, cor), 'lead em aberto não é reativado');
end;
$$;

rollback;
