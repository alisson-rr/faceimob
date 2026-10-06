-- =============================================================================
-- 0226 — descartar lead e encerrar negócio com observação obrigatória.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002260001';
  ger uuid := '00000000-0000-0000-0000-000002260002';
  v_lead uuid;
  v_deal uuid;
  v_status text;
  r public.leads;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c226.test', '{"full_name":"Corretor 226"}'),
    (ger, 'ger@c226.test', '{"full_name":"Gerente 226"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ger, 'manager') on conflict do nothing;

  -- 1. Descartar lead
  insert into public.leads (full_name, phone, assigned_to) values ('Lead 226', '11902260001', cor) returning id into v_lead;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  r := public.close_lead(v_lead, 'discarded', 'Número de contato do cliente não existe.');
  if r.status <> 'discarded' or r.lost_at is not null or r.lost_reason is null then
    raise exception 'FALHOU: descarte (% / % / %)', r.status, r.lost_at, r.lost_reason;
  end if;
  insert into public.leads (full_name, phone, assigned_to) values ('Lead 226b', '11902260002', cor) returning id into v_lead;
  r := public.close_lead(v_lead, 'lost', 'Sem interesse');
  if r.status <> 'lost' or r.lost_at is null then
    raise exception 'FALHOU: perdido sem lost_at';
  end if;
  raise notice '  ok  descartar e perder lead funcionam (lost_at só no perdido)';

  -- 2. Encerrar negócio num Status 2 que pede observação, com lost_reason
  perform set_config('request.jwt.claims', '', true);
  select s.value into v_status from public.deal_statuses s
   where public.deal_status_bare(s.value) = 'QUEDA' order by active desc limit 1;
  update public.deal_statuses set requires_note = true where value = v_status;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1)
    on conflict do nothing;

  -- Como `postgres` o gatilho deixa passar tudo: a gravação é a da tela.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.deals set status_detail = v_status where id = v_deal;
    raise exception 'FALHOU: Status 2 com observação obrigatória passou sem observação';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
  update public.deals set status_detail = v_status, lost_reason = v_status || ' — sem retorno' where id = v_deal;
  if (select public.deal_status_bare(status_detail) from public.deals where id = v_deal) <> 'QUEDA' then
    raise exception 'FALHOU: encerrar com observação não gravou';
  end if;
  reset role;
  raise notice '  ok  encerrar com observação passa; sem observação continua recusado';
end;
$$;

rollback;
