-- 0277 — reativar OFF/Distrato/Queda e mudar a construtora de quem virou negócio.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.status2(p_bare text) returns text language sql as $$
  select value from public.deal_statuses where active and public.deal_status_bare(value) = p_bare order by position, id limit 1
$$;

do $$
declare
  cor   uuid := '00000000-0000-0000-0000-000002770001';
  lider uuid := '00000000-0000-0000-0000-000002770002';
  fora  uuid := '00000000-0000-0000-0000-000002770003';
  cor2  uuid := '00000000-0000-0000-0000-000002770004';
  alheio uuid := '00000000-0000-0000-0000-000002770005';
  v_team uuid; v_stage uuid; v_msg text;
  v_off uuid; v_dist uuid; v_queda uuid; v_virou uuid; v_aberto uuid;
  v_dev1 uuid; v_dev2 uuid; v_mes date; v_ant date; v_row public.deals;
  v_n int;

begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@a277.test', '{"full_name":"Corretor 277"}'),
    (lider, 'lid@a277.test', '{"full_name":"Lider 277"}'),
    (fora, 'for@a277.test', '{"full_name":"Fora 277"}'),
    (cor2, 'co2@a277.test', '{"full_name":"Corretor 2 277"}'),
    (alheio, 'al@a277.test', '{"full_name":"Corretor Alheio 277"}');
  delete from public.user_roles where profile_id in (lider, fora);
  insert into public.user_roles (profile_id, role) values (lider, 'manager'), (fora, 'manager') on conflict do nothing;
  insert into public.teams (name, slug, manager_id) values ('Equipe 277', 'equipe-277', lider) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor), (v_team, cor2);

  v_mes := public.month_start(coalesce(public.current_season_month(), current_date));
  v_ant := (v_mes - interval '1 month')::date;
  select id into v_stage from public.pipeline_stages where is_initial limit 1;

  insert into public.deals (stage_id, created_by, month_base, status_detail)
    values (v_stage, cor, v_ant, pg_temp.status2('OFF')) returning id into v_off;
  insert into public.deals (stage_id, created_by, month_base, status_detail)
    values (v_stage, cor, v_ant, pg_temp.status2('DISTRATO')) returning id into v_dist;
  insert into public.deals (stage_id, created_by, month_base, status_detail)
    values (v_stage, cor, v_mes, pg_temp.status2('QUEDA')) returning id into v_queda;
  insert into public.deals (stage_id, created_by, month_base, status_detail)
    values (v_stage, cor, v_mes, pg_temp.status2('VIROU NEGÓCIO')) returning id into v_virou;
  insert into public.deals (stage_id, created_by, month_base)
    values (v_stage, cor, v_mes) returning id into v_aberto;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    select d, cor, 'broker', 1 from unnest(array[v_off, v_dist, v_queda, v_virou, v_aberto]) d on conflict do nothing;

  -- 1. Gerente da equipe reativa OFF de mês anterior.
  perform set_config('request.jwt.claims', json_build_object('sub', lider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reativar_negocio(v_off, 'Cliente voltou a negociar', cor2);
  reset role;
  select * into v_row from public.deals where id = v_off;
  perform pg_temp.ok(public.deal_status_bare(v_row.status_detail) = 'INCOMPLETO', 'OFF volta para INCOMPLETO');
  perform pg_temp.ok(v_row.month_base = v_mes, 'e vai para o mês atual');
  perform pg_temp.ok(v_row.stage_id = v_stage and v_row.outcome = 'open', 'na etapa inicial, aberto');
  perform pg_temp.ok(exists (select 1 from public.deal_history where deal_id = v_off and kind = 'reactivated'), 'o histórico registra a reativação');
  perform pg_temp.ok(exists (select 1 from public.deal_history where deal_id = v_off and kind = 'comment' and to_value like 'REATIVAÇÃO (OFF): Cliente voltou%'),
                     'e o motivo fica nos comentários');

  perform pg_temp.ok((select count(*) from public.deal_participants where deal_id = v_off and role = 'broker' and profile_id = cor2) = 1
                       and not exists (select 1 from public.deal_participants where deal_id = v_off and role = 'broker' and profile_id = cor),
                     'o negócio vai para o corretor ESCOLHIDO, não para o anterior');
  perform pg_temp.ok(exists (select 1 from public.deal_participants where deal_id = v_off and role = 'manager' and profile_id = lider),
                     'e o gerente vem da equipe do corretor escolhido');

  -- 2. DISTRATO (mês anterior) e QUEDA (mês atual) também.
  set local role authenticated;
  perform public.reativar_negocio(v_dist, 'Distrato revertido com o banco', cor);
  perform public.reativar_negocio(v_queda, 'Queda foi engano do cadastro', cor);
  reset role;
  perform pg_temp.ok((select count(*) from public.deals where id in (v_dist, v_queda)
                       and public.deal_status_bare(status_detail) = 'INCOMPLETO' and month_base = v_mes) = 2,
                     'DISTRATO e QUEDA também voltam para INCOMPLETO no mês atual');

  -- 3. Sem motivo, fora do status, corretor e gerente de fora são recusados.
  set local role authenticated;
  begin perform public.reativar_negocio(v_off, '  ', cor); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Escreva o motivo%' or v_msg like 'Só negócio em OFF%', 'motivo vazio não passa');

  insert into public.deals (stage_id, created_by, month_base, status_detail)
    values (v_stage, cor, v_ant, pg_temp.status2('OFF')) returning id into v_off;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_off, cor, 'broker', 1) on conflict do nothing;

  set local role authenticated;
  begin perform public.reativar_negocio(v_off, 'Motivo válido para testar', null); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Escolha o corretor%', 'sem escolher o corretor não reativa');

  set local role authenticated;
  begin perform public.reativar_negocio(v_off, 'Motivo válido para testar', alheio); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Escolha um corretor da sua equipe%', 'gerente não passa o negócio a corretor de fora da equipe dele');

  set local role authenticated;
  begin perform public.reativar_negocio(v_off, 'x', cor); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Escreva o motivo%', 'motivo curto demais não passa');

  set local role authenticated;
  begin perform public.reativar_negocio(v_aberto, 'Motivo qualquer válido', cor); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Só negócio em OFF%', 'negócio que não está encerrado não é reativado');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.reativar_negocio(v_off, 'Corretor tentando', cor); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Só gerente, diretor%', 'corretor não reativa');

  perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.reativar_negocio(v_off, 'Gerente de outra equipe', cor); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Negócio não encontrado%', 'gerente de outra equipe não reativa');

  -- 4. Mudar construtora: só com VIROU NEGÓCIO, construtora nova, empreendimento e comentário.
  insert into public.developers (name, slug) values ('Construtora A 277', 'cons-a-277') returning id into v_dev1;
  insert into public.developers (name, slug) values ('Construtora B 277', 'cons-b-277') returning id into v_dev2;
  update public.deals set developer_id = v_dev1, project_name = 'Residencial Velho', unit = 'B-101' where id = v_virou;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.mudar_construtora_do_negocio(v_virou, v_dev1, 'Residencial Novo', 'Mesma construtora'); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Escolha uma construtora diferente%', 'a construtora precisa ser outra');

  set local role authenticated;
  begin perform public.mudar_construtora_do_negocio(v_virou, v_dev2, '', 'Cliente quer outra obra'); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Informe o empreendimento%', 'o empreendimento é obrigatório');

  set local role authenticated;
  begin perform public.mudar_construtora_do_negocio(v_virou, v_dev2, 'Residencial Novo', ' '); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'Escreva o comentário%', 'o comentário é obrigatório');

  set local role authenticated;
  begin perform public.mudar_construtora_do_negocio(v_aberto, v_dev2, 'Residencial Novo', 'Fora do status'); v_msg := 'passou'; exception when others then v_msg := sqlerrm; end;
  reset role;
  perform pg_temp.ok(v_msg like 'A construtora só muda%', 'só com o Status 2 em VIROU NEGÓCIO');

  set local role authenticated;
  perform public.mudar_construtora_do_negocio(v_virou, v_dev2, 'Residencial Novo', 'Cliente quer outra obra');
  reset role;
  select * into v_row from public.deals where id = v_virou;
  perform pg_temp.ok(v_row.developer_id = v_dev2 and v_row.project_name = 'Residencial Novo' and v_row.unit is null,
                     'construtora e empreendimento trocados, unidade zerada');
  perform pg_temp.ok(public.deal_status_bare(v_row.status_detail) = 'ANÁLISE P/ VIRAR NEGÓCIO', 'o Status 2 volta para ANÁLISE P/ VIRAR NEGÓCIO');
  perform pg_temp.ok((select status from public.cca_cases where deal_id = v_virou) = 'under_review', 'o caso volta à CCA em análise');
  perform pg_temp.ok(v_row.construtora_trocada_em is not null, 'o negócio fica marcado com o selo de troca de construtora');
  perform pg_temp.ok(exists (select 1 from public.deal_history where deal_id = v_virou and kind = 'comment' and to_value like 'CONSTRUTORA ALTERADA:%'),
                     'o histórico registra a troca');
end $$;

rollback;
