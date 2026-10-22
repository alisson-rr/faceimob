-- =============================================================================
-- 0299 — lead descartado continua contando como lead recebido do corretor,
-- sem voltar para a base dele.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-000002990001';
  cor    uuid := '00000000-0000-0000-0000-000002990002';
  v_lead uuid;
  v_r    jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c299.test', '{"full_name":"Admin 299"}'),
    (cor, 'cor@c299.test', '{"full_name":"Corretor 299"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  insert into public.leads (full_name, phone, status, assigned_to, assigned_at)
  values ('Lead 299', '11955529901', 'attending', cor, now())
  returning id into v_lead;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.close_lead(v_lead, 'discarded', 'Não era cliente');
  execute 'reset role';

  if (select assigned_to from public.leads where id = v_lead) is not null then
    raise exception 'FALHOU: lead descartado deveria sair da base do corretor';
  end if;
  if (select ultimo_corretor_id from public.leads where id = v_lead) is distinct from cor then
    raise exception 'FALHOU: lead descartado deveria guardar quem o tinha';
  end if;
  raise notice '  ok  descartar guarda o último corretor e tira da base';

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_r := public.leads_recebidos(cor, false);
  execute 'reset role';
  if (v_r ->> 'mes')::int <> 1 or (v_r ->> 'hoje')::int <> 1 or (v_r ->> 'mes_descartados')::int <> 1 then
    raise exception 'FALHOU: o descartado deveria contar nos leads do corretor (veio %)', v_r;
  end if;
  raise notice '  ok  descartado conta nos leads do mês do corretor';

  if has_function_privilege('anon', 'public.leads_recebidos(uuid, boolean)', 'execute') then
    raise exception 'FALHOU: anon não pode contar leads';
  end if;
  raise notice '  ok  anon fora';
end;
$$;

rollback;
