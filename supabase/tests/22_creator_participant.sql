-- =============================================================================
-- 0048 — quem cria o negócio entra com o PAPEL REAL, não como corretor fixo.
--
-- Até a 0047, `deals_add_creator_participant` gravava `'broker'` para qualquer
-- autor: gerente e diretor viravam "Corretor 1", ficavam com 100% do rateio de
-- VGV (`recalc_deal_shares` só divide entre brokers) e levavam os pontos de
-- venda do game.
--
-- O cenário aqui reproduz o banco de verdade, e não o caso fácil:
-- `handle_new_auth_user` (0002) dá `broker` a TODO perfil novo e nunca o retira,
-- então admin, gerente e diretor cadastrados pela tela carregam `broker` junto.
-- Podar esse `broker` no teste provaria só o que já funcionava. Ele fica, e é
-- exatamente contra ele que os asserts correm:
--
--   1. gerente {manager, broker} cria → `manager`, share 0, sem linha broker;
--   2. diretor {director, broker} cria → `director`;
--   3. corretor puro cria → `broker`, com os 100% do rateio;
--   4. admin {admin, broker} cria → sem linha nenhuma, mas com `can_edit_deal`;
--   5. CCA {cca, broker} cria → sem linha nenhuma.
--
-- Mais o motivo original do gatilho (0012), que não pode ter se perdido: o autor
-- continua enxergando e editando o próprio negócio. E a porta que a 0012 deixou
-- fechada de propósito — negócio vindo de lead não ganha participante aqui.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check22(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

-- Cria o negócio COMO o usuário: `deals.created_by` tem default `auth.uid()`,
-- e é dele que o gatilho parte.
create or replace function pg_temp.criar22(p_user uuid, p_stage uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.deals (stage_id, vgv_gross) values (p_stage, 300000)
  returning id into v_id;
  reset role;
  return v_id;
end;
$$;

\echo '== papel do criador do negócio =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000004801';
  ger  uuid := '00000000-0000-0000-0000-000000004802';
  dir  uuid := '00000000-0000-0000-0000-000000004803';
  cor  uuid := '00000000-0000-0000-0000-000000004804';
  cca  uuid := '00000000-0000-0000-0000-000000004805';
  v_stage uuid;
  v_lead  uuid;
  v_ger   uuid;
  v_dir   uuid;
  v_cor   uuid;
  v_adm   uuid;
  v_cca   uuid;
  v_deal_lead uuid;
  v_role  text;
  v_share numeric;
  v_count int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@criador.test', '{"full_name":"Admin Criador"}'),
    (ger, 'ger@criador.test', '{"full_name":"Gerente Criador"}'),
    (dir, 'dir@criador.test', '{"full_name":"Diretor Criador"}'),
    (cor, 'cor@criador.test', '{"full_name":"Corretor Criador"}'),
    (cca, 'cca@criador.test', '{"full_name":"CCA Criador"}');

  -- O `broker` sai do gatilho de cadastro; reforçado aqui para o cenário não
  -- depender de o harness ter disparado `handle_new_auth_user`. É a condição
  -- real de toda conta criada pelo app, e é o que o gatilho precisa vencer.
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'),    (adm, 'broker'),
    (ger, 'manager'),  (ger, 'broker'),
    (dir, 'director'), (dir, 'broker'),
    (cor, 'broker'),
    (cca, 'cca'),      (cca, 'broker')
  on conflict do nothing;

  select count(*) into v_count
    from public.user_roles
   where role = 'broker' and profile_id in (adm, ger, dir, cca);
  perform pg_temp.check22(v_count = 4,
    'cenário reproduz o broker automático do cadastro nos quatro perfis');

  select id into v_stage from public.pipeline_stages where code = 'proposal';
  perform pg_temp.check22(v_stage is not null, 'catálogo de etapas carregado');

  -- `deals_guard_closed_month` é BEFORE INSERT e testes anteriores fecham meses.
  delete from public.closed_months where period = public.month_start(current_date);

  v_ger := pg_temp.criar22(ger, v_stage);
  v_dir := pg_temp.criar22(dir, v_stage);
  v_cor := pg_temp.criar22(cor, v_stage);
  v_adm := pg_temp.criar22(adm, v_stage);
  v_cca := pg_temp.criar22(cca, v_stage);

  -- ---------------------------------------------------------------------------
  -- 1. Gerente: entra como gerente, fora do rateio, e sem virar "Corretor 1" —
  --    apesar de carregar `broker` desde o cadastro.
  -- ---------------------------------------------------------------------------
  select role, share_pct into v_role, v_share
    from public.deal_participants where deal_id = v_ger and profile_id = ger;
  perform pg_temp.check22(v_role = 'manager',
    'gerente com broker de cadastro participa como manager, não como corretor');
  perform pg_temp.check22(v_share = 0,
    'gerente criador fica com 0% do rateio de VGV');

  select count(*) into v_count
    from public.deal_participants where deal_id = v_ger and role = 'broker';
  perform pg_temp.check22(v_count = 0,
    'negócio criado por gerente nasce sem nenhum corretor');

  -- ---------------------------------------------------------------------------
  -- 2. Diretor: mesmo caminho, papel próprio.
  -- ---------------------------------------------------------------------------
  select role, share_pct into v_role, v_share
    from public.deal_participants where deal_id = v_dir and profile_id = dir;
  perform pg_temp.check22(v_role = 'director',
    'diretor com broker de cadastro participa como director');
  perform pg_temp.check22(v_share = 0,
    'diretor criador fica fora do rateio de VGV');

  -- ---------------------------------------------------------------------------
  -- 3. Corretor puro: é quem atende, então leva o rateio inteiro.
  -- ---------------------------------------------------------------------------
  select role, share_pct into v_role, v_share
    from public.deal_participants where deal_id = v_cor and profile_id = cor;
  perform pg_temp.check22(v_role = 'broker',
    'corretor que cria o negócio participa como corretor');
  perform pg_temp.check22(v_share = 100,
    'corretor único fica com 100% do rateio');

  -- ---------------------------------------------------------------------------
  -- 4. Admin: sem linha, porque `can_edit_deal` já o aceita por permissão.
  --    É o caso que o `broker` de cadastro quebrava — os dois admins do banco
  --    de homologação carregam `broker`.
  -- ---------------------------------------------------------------------------
  select count(*) into v_count
    from public.deal_participants where deal_id = v_adm;
  perform pg_temp.check22(v_count = 0,
    'admin com broker de cadastro não vira participante do negócio que criou');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check22(public.can_edit_deal(v_adm),
    'admin continua editando o negócio que criou, sem participar dele');

  -- ---------------------------------------------------------------------------
  -- 5. CCA: mesma saída, mesma razão.
  -- ---------------------------------------------------------------------------
  select count(*) into v_count
    from public.deal_participants where deal_id = v_cca;
  perform pg_temp.check22(v_count = 0,
    'CCA com broker de cadastro não vira participante do negócio que criou');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check22(public.can_edit_deal(v_cca),
    'CCA continua editando o negócio que criou, sem participar dele');

  -- ---------------------------------------------------------------------------
  -- 6. O motivo do gatilho (0012) continua de pé para quem depende dele.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check22(public.can_see_deal(v_ger) and public.can_edit_deal(v_ger),
    'gerente criador continua vendo e editando o próprio negócio');

  perform set_config('request.jwt.claims',
    json_build_object('sub', dir::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check22(public.can_edit_deal(v_dir),
    'diretor criador continua editando o próprio negócio');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check22(public.can_edit_deal(v_cor),
    'corretor criador continua editando o próprio negócio');

  -- ---------------------------------------------------------------------------
  -- 7. Negócio vindo de lead segue ignorado: quem cuida é convert_lead_to_deal.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', false);
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente Criador', '11955554801', 'in_progress', cor)
  returning id into v_lead;

  insert into public.deals (stage_id, vgv_gross, lead_id, created_by)
  values (v_stage, 250000, v_lead, ger)
  returning id into v_deal_lead;

  select count(*) into v_count
    from public.deal_participants where deal_id = v_deal_lead;
  perform pg_temp.check22(v_count = 0,
    'negócio com lead_id não ganha participante pelo gatilho');
end;
$$;

-- Não deixa o papel simulado vazar para o próximo arquivo da suíte.
select set_config('request.jwt.claims', '', false);

\echo '== 22_creator_participant: ok =='
