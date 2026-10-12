-- 0270 — aprovação (condicionada ou total) de um negócio em ANÁLISE EXTERNA
-- exige comentário, de qualquer perfil; com comentário, passa e fica no histórico.
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
  adm uuid := '00000000-0000-0000-0000-000002700001';
  v_deal uuid;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (adm, 'adm@a270.test', '{"full_name":"Admin 270"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin') on conflict do nothing;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), adm) returning id into v_deal;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.move_deal_status(v_deal, 'ANÁLISE EXTERNA', 'enviado ao correspondente');

  begin
    perform public.move_deal_status(v_deal, 'APROV. COND.', null);
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'Comente o retorno da análise externa%', 'aprovar sem comentário é recusado, até para o admin');

  set local role authenticated;
  perform public.move_deal_status(v_deal, 'APROV. COND.', 'aprovado com condicionante de renda');
  reset role;
  perform pg_temp.ok(
    (select public.deal_status_bare(status_detail) = 'APROV. COND.' from public.deals where id = v_deal),
    'com comentário a aprovação passa');
  perform pg_temp.ok(
    exists (select 1 from public.deal_history where deal_id = v_deal and kind = 'comment' and to_value like '%condicionante de renda%'),
    'o comentário fica no histórico do negócio');
end;
$$;

rollback;
