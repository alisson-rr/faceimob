-- =============================================================================
-- 0279 — vincular o lead a um negócio que já existe.
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

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002790001';
  out uuid := '00000000-0000-0000-0000-000002790002';
  v_deal uuid;
  v_outro uuid;
  v_lead uuid;
  v_lead2 uuid;
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c2790.test', '{"full_name":"Corretor 2790"}'),
    (out, 'out@c2790.test', '{"full_name":"Outro 2790"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (out, 'broker') on conflict do nothing;

  insert into public.deals (stage_id, created_by) values (v_stage, cor) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;
  insert into public.deal_clients (deal_id, ordinal, full_name, cpf) values (v_deal, 1, 'Maria Cliente', '123.456.789-09');

  insert into public.deals (stage_id, created_by) values (v_stage, out) returning id into v_outro;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_outro, out, 'broker', 1) on conflict do nothing;
  insert into public.deal_clients (deal_id, ordinal, full_name, cpf) values (v_outro, 1, 'Joao Alheio', '98765432100');

  insert into public.leads (full_name, phone, assigned_to, status) values ('Maria Lead', '5551999990001', cor, 'assigned') returning id into v_lead;
  insert into public.leads (full_name, phone, assigned_to, status) values ('Outro Lead', '5551999990002', out, 'assigned') returning id into v_lead2;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);

  perform pg_temp.falha(format('select public.vincular_lead_a_negocio(%L,%L,%L)', v_lead, v_deal, '123'), 'CPF curto não passa');
  perform pg_temp.falha(format('select public.vincular_lead_a_negocio(%L,%L,%L)', v_lead, v_deal, '11144477735'), 'CPF de outro cliente não passa');
  perform pg_temp.falha(format('select public.vincular_lead_a_negocio(%L,%L,%L)', v_lead, v_outro, '98765432100'), 'negócio de outro corretor não passa');
  perform pg_temp.falha(format('select public.vincular_lead_a_negocio(%L,%L,%L)', v_lead2, v_deal, '12345678909'), 'lead de outro corretor não passa');

  perform public.vincular_lead_a_negocio(v_lead, v_deal, '123.456.789-09');
  if (select status from public.leads where id = v_lead) <> 'converted'
     or (select converted_deal_id from public.leads where id = v_lead) <> v_deal
     or (select lead_id from public.deals where id = v_deal) <> v_lead then
    raise exception 'FALHOU: o lead devia ficar convertido e ligado ao negócio';
  end if;
  raise notice '  ok  lead convertido e ligado ao negócio existente, com o CPF mascarado';

  if not exists (select 1 from public.lead_events where lead_id = v_lead and kind = 'converted' and to_value = v_deal::text)
     or not exists (select 1 from public.deal_history where deal_id = v_deal and kind = 'lead_linked') then
    raise exception 'FALHOU: o histórico dos dois lados devia registrar o vínculo';
  end if;
  raise notice '  ok  o histórico do lead e do negócio registra o vínculo';

  perform pg_temp.falha(format('select public.vincular_lead_a_negocio(%L,%L,%L)', v_lead, v_deal, '12345678909'), 'lead já convertido não vincula de novo');
  if (select count(*) from public.deals) <> 2 then
    raise exception 'FALHOU: vincular não pode criar negócio';
  end if;
  raise notice '  ok  nenhum negócio novo foi criado';
end;
$$;

rollback;
