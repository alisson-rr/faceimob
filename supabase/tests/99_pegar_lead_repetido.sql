-- =============================================================================
-- 0314 — pegar o lead que já é seu confirma em vez de dar erro.
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
  dai    uuid := '00000000-0000-0000-0000-000003140001';
  outra  uuid := '00000000-0000-0000-0000-000003140002';
  v_lead uuid;
  v_data timestamptz := date_trunc('hour', now()) + interval '3 days';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dai, 'dai@c3140.test', '{"full_name":"Corretora 3140"}'),
    (outra, 'outra@c3140.test', '{"full_name":"Outra 3140"}');
  insert into public.user_roles (profile_id, role) values (dai, 'broker'), (outra, 'broker') on conflict do nothing;

  insert into public.leads (full_name, phone, status, assigned_to, assigned_at)
  values ('Maria Repetida', '5551999931401', 'assigned', dai, now())
  returning id into v_lead;

  -- O caso de 31/10: primeiro pelo botão do aviso (sem data), depois pelo
  -- diálogo da ficha, com "Em 3 dias".
  perform set_config('request.jwt.claims', json_build_object('sub', dai, 'role', 'authenticated')::text, true);
  perform public.claim_lead(v_lead);
  perform public.claim_lead(v_lead, v_data);

  if (select status from public.leads where id = v_lead) <> 'attending'
     or (select next_action_at from public.leads where id = v_lead) <> v_data then
    raise exception 'FALHOU: o segundo pegar devia confirmar e gravar a data escolhida';
  end if;
  raise notice '  ok  o segundo pegar confirma e a data escolhida vence';

  if (select count(*) from public.lead_events where lead_id = v_lead and kind = 'claimed') <> 1
     or (select count(*) from public.tasks where ref_type = 'lead' and ref_id = v_lead) <> 1
     or (select due_at from public.tasks where ref_type = 'lead' and ref_id = v_lead) <> v_data then
    raise exception 'FALHOU: devia haver um só "pegou" e uma só atividade, com o prazo novo';
  end if;
  raise notice '  ok  um só "pegou" no histórico e uma só atividade, com o prazo novo';

  perform set_config('request.jwt.claims', json_build_object('sub', outra, 'role', 'authenticated')::text, true);
  perform pg_temp.falha(format('select public.claim_lead(%L)', v_lead), 'outra corretora não pega o lead');
end;
$$;

rollback;
