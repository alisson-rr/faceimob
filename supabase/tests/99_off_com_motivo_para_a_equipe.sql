-- 0271 — corretor marca OFF com motivo, pela RPC; sem motivo é recusado; quem
-- não tem papel de equipe nem é admin não marca; OFF escrito direto continua
-- de admin e sócio.
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
  cor uuid := '00000000-0000-0000-0000-000002710001';
  cca uuid := '00000000-0000-0000-0000-000002710002';
  v_deal uuid;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@a271.test', '{"full_name":"Corretor 271"}'),
    (cca, 'cca@a271.test', '{"full_name":"CCA 271"}');
  -- O cadastro dá o papel de corretor a todo mundo: a CCA do teste fica só com o dela.
  delete from public.user_roles where profile_id = cca;
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (cca, 'cca') on conflict do nothing;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1)
    on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.marcar_off(v_deal, 'ok');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  perform pg_temp.ok(v_msg like 'Escreva o motivo do OFF%', 'OFF sem motivo é recusado');

  begin
    update public.deals set status_detail = (select value from public.deal_statuses where public.deal_status_bare(value) = 'OFF' limit 1) where id = v_deal;
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  perform pg_temp.ok(v_msg like 'Só administrador e sócio marcam OFF%', 'OFF escrito direto continua de admin e sócio');

  perform public.marcar_off(v_deal, 'cliente desistiu da compra');
  reset role;
  perform pg_temp.ok(
    (select public.deal_status_bare(status_detail) = 'OFF' from public.deals where id = v_deal),
    'corretor marca OFF com motivo');
  perform pg_temp.ok(
    exists (select 1 from public.deal_history where deal_id = v_deal and kind = 'comment' and to_value = 'OFF: cliente desistiu da compra'),
    'o motivo fica no histórico, junto do OFF');

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.marcar_off(v_deal, 'motivo qualquer da cca');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg is not null and v_msg <> 'passou', 'quem não é da equipe nem admin não marca OFF por aqui');
end;
$$;

rollback;
