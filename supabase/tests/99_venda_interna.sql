-- =============================================================================
-- 0319 — venda interna: não pontua e só o admin marca.
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

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000003190001';
  cor uuid := '00000000-0000-0000-0000-000003190002';
  v_deal uuid;
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c3190.test', '{"full_name":"Admin 3190"}'),
    (cor, 'cor@c3190.test', '{"full_name":"Corretor 3190"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  insert into public.deals (stage_id, created_by) values (v_stage, cor) returning id into v_deal;

  -- O corretor não marca a própria venda como interna.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.falha(format('update public.deals set venda_interna = true where id = %L', v_deal),
    'corretor não marca venda interna');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update public.deals set venda_interna = true where id = v_deal;
  perform pg_temp.ok((select venda_interna from public.deals where id = v_deal), 'o admin marca a venda interna');

  perform pg_temp.ok(public.award_game_points(cor, 'venda', 'deal', v_deal) is null
      and not exists (select 1 from public.game_events where ref_id = v_deal),
    'venda interna não pontua no game');
end;
$$;

rollback;
