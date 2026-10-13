-- 0273 — gerente que lidera o corretor (sem ser participante do negócio) passa da
-- checagem de papel no envio; gerente de fora continua recusado.
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
  cor uuid := '00000000-0000-0000-0000-000002730001';
  lider uuid := '00000000-0000-0000-0000-000002730002';
  fora uuid := '00000000-0000-0000-0000-000002730003';
  v_team uuid; v_deal uuid; v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@a273.test', '{"full_name":"Corretor 273"}'),
    (lider, 'lid@a273.test', '{"full_name":"Lider 273"}'),
    (fora, 'for@a273.test', '{"full_name":"Fora 273"}');
  delete from public.user_roles where profile_id in (lider, fora);
  insert into public.user_roles (profile_id, role) values (lider, 'manager'), (fora, 'manager') on conflict do nothing;
  insert into public.teams (name, slug, manager_id) values ('Equipe 273', 'equipe-273', lider) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'reenvio', 'agil');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'Somente corretor, gerente ou diretor do negócio%', 'gerente de fora segue recusado');

  perform set_config('request.jwt.claims', json_build_object('sub', lider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'reenvio', 'agil');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg not like 'Somente corretor, gerente ou diretor do negócio%',
    'gerente que lidera o corretor passa da checagem de papel (barra adiante, por documento ou construtora: ' || v_msg || ')');
end;
$$;

rollback;
