-- =============================================================================
-- 0264 — candidato aprovado pela Luna não entra na roleta; gestor vê todos os
-- disponíveis, pega um (só um ganha) e depois só ele vê; admin vê o painel.
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
  ger1 uuid := '00000000-0000-0000-0000-000002640001';
  ger2 uuid := '00000000-0000-0000-0000-000002640002';
  cor  uuid := '00000000-0000-0000-0000-000002640003';
  v_luna uuid;
  v_lead uuid;
  v_conv uuid;
  v_cand uuid;
  v_n int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ger1, 'g1@c264.test', '{"full_name":"Gerente Um"}'),
    (ger2, 'g2@c264.test', '{"full_name":"Gerente Dois"}'),
    (cor,  'co@c264.test', '{"full_name":"Corretor 264"}');
  insert into public.user_roles (profile_id, role) values (ger1, 'manager'), (ger2, 'director'), (cor, 'broker')
    on conflict do nothing;

  insert into public.sdr_agents (name, system_prompt, active, lead_de_compra)
    values ('Luna 264', 'p', true, false) returning id into v_luna;
  insert into public.leads (full_name, phone, status) values ('Perfil WhatsApp', '51900264001', 'queued') returning id into v_lead;
  insert into public.sdr_conversations (lead_id, agent_id, status, score, summary, collected)
    values (v_lead, v_luna, 'active', 85, 'Experiente', '{"Nome":"Marina","Unidade":"Zona Sul","CRECI":"sim"}')
    returning id into v_conv;

  perform public.sdr_handoff(v_conv, 'qualified');
  select id into v_cand from public.candidatos where conversation_id = v_conv;
  perform pg_temp.ok(v_cand is not null, 'aprovado pela Luna vira candidato');
  perform pg_temp.ok((select zona from public.candidatos where id = v_cand) = 'sul', 'zona sai da Unidade');
  perform pg_temp.ok((select status from public.leads where id = v_lead) = 'discarded'
    and (select assigned_to from public.leads where id = v_lead) is null,
    'o lead não entra na roleta nem fica com ninguém');

  -- Gestores veem o disponível; corretor não vê nada.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.candidatos;
  reset role;
  perform pg_temp.ok(v_n = 0, 'corretor não vê candidatos');

  perform set_config('request.jwt.claims', json_build_object('sub', ger2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.candidatos where id = v_cand;
  reset role;
  perform pg_temp.ok(v_n = 1, 'diretor vê o candidato disponível');

  -- Gerente 1 pega; gerente 2 não consegue pegar e deixa de ver.
  perform set_config('request.jwt.claims', json_build_object('sub', ger1, 'role', 'authenticated')::text, true);
  perform public.candidato_pegar(v_cand);
  perform pg_temp.ok((select responsavel_id from public.candidatos where id = v_cand) = ger1, 'gerente pega o candidato');

  perform set_config('request.jwt.claims', json_build_object('sub', ger2, 'role', 'authenticated')::text, true);
  begin
    perform public.candidato_pegar(v_cand);
    raise exception 'FALHOU: segundo gestor não podia pegar';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  segundo gestor não pega o mesmo candidato';
  end;
  set local role authenticated;
  select count(*) into v_n from public.candidatos where id = v_cand;
  reset role;
  perform pg_temp.ok(v_n = 0, 'depois de pego, outro gestor não vê');

  perform set_config('request.jwt.claims', json_build_object('sub', ger1, 'role', 'authenticated')::text, true);
  perform public.candidato_mudar_status(v_cand, 'selecionado');
  perform pg_temp.ok((select status from public.candidatos where id = v_cand) = 'selecionado', 'gestor marca selecionado');

  perform set_config('request.jwt.claims', json_build_object('sub', ger2, 'role', 'authenticated')::text, true);
  begin
    perform public.candidato_mudar_status(v_cand, 'descartado');
    raise exception 'FALHOU: gestor alheio não podia mudar status';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  gestor alheio não mexe no candidato';
  end;
  begin
    perform public.candidatos_painel();
    raise exception 'FALHOU: painel é só de admin/sócio';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  painel fechado para gestor';
  end;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

rollback;
