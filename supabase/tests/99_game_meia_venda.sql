-- =============================================================================
-- 0308 — no negócio com dois corretores, cada um tem meia venda e metade dos
-- pontos da venda no placar do game.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-000003080001';
  cor_a  uuid := '00000000-0000-0000-0000-000003080002';
  cor_b  uuid := '00000000-0000-0000-0000-000003080003';
  v_temp uuid := '00000000-0000-0000-0000-0000030800aa';
  v_deal uuid;
  r      record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,   'adm@g308.test', '{"full_name":"Admin 308"}'),
    (cor_a, 'a@g308.test',   '{"full_name":"Corretor A 308"}'),
    (cor_b, 'b@g308.test',   '{"full_name":"Corretor B 308"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor_a, 'broker'), (cor_b, 'broker')
  on conflict do nothing;
  insert into public.game_seasons (id, label, period_start, period_end, closed_at)
    values (v_temp, 'Temporada 308', date '2020-01-01', date '2020-01-31', now());

  -- Negócio ainda em proposta: o rateio entra sem gerar venda pelos gatilhos.
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor_a, 'PROPOSTA')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor_a, 'broker', 1), (v_deal, cor_b, 'broker', 2) on conflict do nothing;
  insert into public.game_events (season_id, profile_id, event_code, points, ref_type, ref_id) values
    (v_temp, cor_a, 'venda', 10, 'deal', v_deal),
    (v_temp, cor_b, 'venda', 10, 'deal', v_deal);

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.visible_game_ranking(v_temp) where profile_id = cor_a;
  execute 'reset role';

  if r.sales is distinct from 0.5 or r.points is distinct from 5 then
    raise exception 'FALHOU: dividido deveria dar meia venda e metade dos pontos (veio % vendas, % pontos)', r.sales, r.points;
  end if;
  raise notice '  ok  dois corretores: meia venda e metade dos pontos para cada';
end;
$$;

rollback;
