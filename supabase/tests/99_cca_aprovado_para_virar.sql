-- 0356 — CCA leva o aprovado para "Análise p/ virar negócio"; corretor não.
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
  cca uuid := '00000000-0000-0000-0000-000003560001';
  cor uuid := '00000000-0000-0000-0000-000003560002';
  v_destino text := (select value from public.deal_statuses
                      where public.status2_chave(value) = 'ANALISE P/ VIRAR NEGOCIO' order by active desc limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cca, 'cca@c356.test', '{"full_name":"CCA 356"}'),
    (cor, 'cor@c356.test', '{"full_name":"Corretor 356"}');
  insert into public.user_roles (profile_id, role) values (cca, 'cca'), (cor, 'broker') on conflict do nothing;
  perform pg_temp.ok(v_destino is not null, 'o catálogo tem Análise p/ virar negócio');

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.deal_status_move_block('09. APROV. TOTAL', v_destino) is null, 'CCA: aprovado total → análise p/ virar');
  perform pg_temp.ok(public.deal_status_move_block('APROV. COND. RESTRIÇÃO', v_destino) is null, 'CCA: condicionado com restrição → análise p/ virar');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.deal_status_move_block('09. APROV. TOTAL', v_destino) is not null, 'corretor segue barrado');
end;
$$;

rollback;
