-- =============================================================================
-- 0313 — "Mandar para a roleta" a partir da conversa do SDR.
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
  sdr    uuid := '00000000-0000-0000-0000-000003130001';
  cor    uuid := '00000000-0000-0000-0000-000003130002';
  v_perdido uuid;
  v_comcor  uuid;
  v_conv1   uuid;
  v_conv2   uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (sdr, 'sdr@c3130.test', '{"full_name":"SDR 3130"}'),
    (cor, 'cor@c3130.test', '{"full_name":"Corretor 3130"}');
  insert into public.user_roles (profile_id, role) values (sdr, 'sdr'), (cor, 'broker') on conflict do nothing;

  -- A conversa "Sem responsável" do print: a IA passou para humano, ninguém
  -- assumiu, e o lead tinha sido encerrado.
  insert into public.leads (full_name, phone, status, lost_at, lost_reason)
  values ('Lead Parado', '5551999931301', 'lost', now(), 'SDR IA: sem resposta em 24 h')
  returning id into v_perdido;
  insert into public.sdr_conversations (lead_id, status) values (v_perdido, 'human') returning id into v_conv1;

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Atendido', '5551999931302', 'attending', cor)
  returning id into v_comcor;
  insert into public.sdr_conversations (lead_id, status) values (v_comcor, 'human') returning id into v_conv2;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.falha(format('select public.sdr_mandar_para_roleta(%L)', v_conv1), 'corretor não manda lead para a roleta');

  perform set_config('request.jwt.claims', json_build_object('sub', sdr, 'role', 'authenticated')::text, true);
  perform pg_temp.falha(format('select public.sdr_mandar_para_roleta(%L)', v_conv2), 'lead com corretor atendendo fica com ele');
  if (select assigned_to from public.leads where id = v_comcor) is distinct from cor
     or (select status from public.leads where id = v_comcor) <> 'attending' then
    raise exception 'FALHOU: a recusa não pode mexer no lead do corretor';
  end if;
  raise notice '  ok  o lead do corretor continua com ele';

  perform public.sdr_mandar_para_roleta(v_conv1);
  -- Entregue ou esperando na fila depende do horário e de quem está de turno;
  -- o que se cobra é que voltou a valer e que a conversa saiu do "Sem responsável".
  if (select status from public.leads where id = v_perdido) not in ('queued', 'assigned')
     or (select lost_at from public.leads where id = v_perdido) is not null
     or (select lost_reason from public.leads where id = v_perdido) is not null then
    raise exception 'FALHOU: o lead perdido devia voltar à roleta, sem os dados do encerramento';
  end if;
  if (select status from public.sdr_conversations where id = v_conv1) <> 'handed_off' then
    raise exception 'FALHOU: a conversa devia ficar como entregue';
  end if;
  raise notice '  ok  o lead encerrado volta à roleta e a conversa fica entregue';

  perform pg_temp.falha(format('select public.sdr_mandar_para_roleta(%L)', v_conv1), 'a mesma conversa não vai duas vezes');
end;
$$;

rollback;
