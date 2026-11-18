-- 0345 — o corretor cadastra lead para si: nasce em atendimento com ele, sem
-- cronômetro e fora da fila; telefone em atendimento com outro é recusado.
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
  cor uuid := '00000000-0000-0000-0000-000003450001';
  out2 uuid := '00000000-0000-0000-0000-000003450002';
  cca uuid := '00000000-0000-0000-0000-000003450003';
  v_id uuid; v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@a345.test', '{"full_name":"Corretor 345"}'),
    (out2, 'out@a345.test', '{"full_name":"Outro 345"}'),
    (cca, 'cca@a345.test', '{"full_name":"CCA 345"}');
  delete from public.user_roles where profile_id = cca;
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (out2, 'broker'), (cca, 'cca') on conflict do nothing;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at)
    values ('Já do outro 345', '51900345999', 'attending', out2, now());

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_id := public.corretor_criar_lead('Cliente Captado 345', '(51) 9 0034-5001', null, null, null, 'indicação');
  begin
    perform public.corretor_criar_lead('Repetido 345', '5551900345999');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.ok((select status = 'attending' and assigned_to = cor and attend_deadline is null and next_action_at > now()
                        from public.leads where id = v_id), 'lead nasce em atendimento com o corretor, sem cronômetro');
  perform pg_temp.ok(exists (select 1 from public.lead_assignments where lead_id = v_id and profile_id = cor and not counts_for_queue),
    'não conta na fila da roleta');
  perform pg_temp.ok(v_msg like 'Este telefone já está em atendimento com Outro 345%', 'telefone em atendimento com outro é recusado');

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.corretor_criar_lead('Da CCA 345', '51900345002');
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'barrado';
  end;
  reset role;
  perform pg_temp.ok(v_msg = 'barrado', 'quem não é corretor não usa esta porta');
end;
$$;

rollback;
