-- =============================================================================
-- 0245 — líder que também é corretor conta como gerente do próprio negócio;
-- OFF histórico pode reabrir direto no caminho da construtora externa.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok245b(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  v_lider uuid := '00000000-0000-0000-0000-000000024511';
  v_team uuid := '00000000-0000-0000-0000-000000024512';
  v_deal uuid := '00000000-0000-0000-0000-000000024513';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_lider, 'lider@v0245.test', '{"full_name":"Líder 0245"}') on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (v_lider, 'broker'), (v_lider, 'manager'), (v_lider, 'director') on conflict do nothing;
  insert into public.teams (id, name, manager_id, director_id, active)
  values (v_team, 'Equipe 0245', v_lider, v_lider, true);
  insert into public.team_members (team_id, profile_id, joined_at)
  values (v_team, v_lider, now());

  insert into public.deals (id, stage_id, created_by, month_base, status_detail)
  select v_deal, s.id, v_lider,
         public.month_start(coalesce(public.current_season_month(), current_date)) - interval '1 month',
         (select ds.value from public.deal_statuses ds
           where ds.active and public.deal_status_bare(ds.value) = 'OFF' limit 1)
    from public.pipeline_stages s where s.active and s.is_initial limit 1;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
  values (v_deal, v_lider, 'broker', 1) on conflict do nothing;

  perform pg_temp.ok245b(
    (select count(*) = 3 from public.deal_participants
      where deal_id = v_deal and profile_id = v_lider
        and role in ('broker', 'manager', 'director')),
    'a mesma pessoa entra com os três papéis sem duplicar o rateio');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_lider::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reactivate_deal_with_destination(v_deal, v_lider, 'external');
  reset role;

  perform pg_temp.ok245b(
    (select public.deal_status_bare(status_detail) = 'ANÁLISE EXTERNA'
       and outcome = 'open'
       and month_base = public.month_start(coalesce(public.current_season_month(), current_date))
       from public.deals where id = v_deal),
    'OFF volta ao mês vigente diretamente em ANÁLISE EXTERNA');
end;
$$;

rollback;
