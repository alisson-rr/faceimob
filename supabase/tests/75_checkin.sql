-- =============================================================================
-- 0075 · Trava do ponto, turno sobreposto e faixa de IP duplicada
--
-- O que este arquivo cobra:
--
--   1. gerente que lidera a própria equipe NÃO grava presença direto em
--      `checkins` — nem a dele nem a de um corretor da equipe. Era o furo:
--      `manages_profile(self)` é verdadeiro para ele, e a policy antiga
--      (`checkins_manage`) pulava trava de IP, janela de turno e
--      `checkin_eligibility()`;
--   2. admin continua conseguindo corrigir ponto (a capacidade legítima não
--      pode sumir junto com o furo);
--   3. `anon` não tem privilégio de tabela nas três tabelas do ponto;
--   4. turno com horários fora de ordem, turno sobreposto e exclusão de turno
--      com presença falham com mensagem em pt-BR (P0001), não com o genérico
--      do CHECK/FK;
--   5. a mesma faixa de IP não entra duas vezes, e faixa /0 não entra nunca.
--
-- Não depende de seed.sql: o cenário cria perfis, equipe e turno próprios.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check75(cond boolean, label text)
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

-- -----------------------------------------------------------------------------
-- Cenário
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000750001';
  ger uuid := '00000000-0000-0000-0000-000000750002';
  cor uuid := '00000000-0000-0000-0000-000000750003';
  v_team uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@checkin75.test', '{"full_name":"Admin 75"}'),
    (ger, 'ger@checkin75.test', '{"full_name":"Gerente 75"}'),
    (cor, 'cor@checkin75.test', '{"full_name":"Corretor 75"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker')
  on conflict do nothing;

  insert into public.teams (name, slug, manager_id, active)
  values ('Equipe 75', 'equipe-75', ger, true)
  on conflict (slug) do update set manager_id = excluded.manager_id
  returning id into v_team;

  -- O gerente é MEMBRO da equipe que lidera: é exatamente essa configuração
  -- que faz `manages_profile(self)` devolver verdadeiro.
  insert into public.team_members (team_id, profile_id)
  select v_team, p
    from unnest(array[ger, cor]) as p
   where not exists (
     select 1 from public.team_members tm
      where tm.team_id = v_team and tm.profile_id = p and tm.left_at is null
   );
end
$$;

-- -----------------------------------------------------------------------------
-- 1. Gerente não grava presença direto
-- -----------------------------------------------------------------------------
\echo '0075 — escrita direta em checkins'

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000750001';
  ger uuid := '00000000-0000-0000-0000-000000750002';
  cor uuid := '00000000-0000-0000-0000-000000750003';
  v_shift uuid;
  v_id    uuid;
begin
  -- Turno de fixture: aqui `current_user` é `postgres`, não `authenticated`,
  -- então a regra de sobreposição não se aplica — é o mesmo caminho que os
  -- outros arquivos do harness usam para ter um turno sempre aberto.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('teste-75', 'Integral 75', '00:00', '00:00', '23:59', -75)
  on conflict (code) do nothing;
  select id into v_shift from public.work_shifts where code = 'teste-75';

  -- a) a própria presença
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  -- A pré-condição do furo: para o banco, o gerente é gestor de si mesmo.
  perform pg_temp.check75(public.manages_profile(ger),
    'cenário: manages_profile(self) é verdadeiro para quem lidera a própria equipe');

  begin
    set local role authenticated;
    insert into public.checkins (profile_id, shift_id, work_date)
    values (ger, v_shift, public.current_work_date());
    reset role;
    raise exception 'FALHOU: gerente gravou a própria presença sem passar por perform_checkin';
  exception when insufficient_privilege then
    reset role;
    raise notice '  ok  gerente não grava a própria presença direto em checkins';
  end;

  -- b) a presença de um corretor da equipe dele
  begin
    set local role authenticated;
    insert into public.checkins (profile_id, shift_id, work_date)
    values (cor, v_shift, public.current_work_date());
    reset role;
    raise exception 'FALHOU: gerente gravou a presença de um corretor da equipe sem trava de IP';
  exception when insufficient_privilege then
    reset role;
    raise notice '  ok  gerente não grava a presença de corretor da equipe';
  end;

  -- c) o admin continua corrigindo ponto
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.checkins (profile_id, shift_id, work_date)
  values (cor, v_shift, public.current_work_date())
  returning id into v_id;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check75(v_id is not null,
    'admin ainda corrige ponto — a capacidade legítima não sumiu junto com o furo');
  -- Correção manual é distinguível do ponto real: a RPC exige IP identificado.
  perform pg_temp.check75(
    (select ip_address is null from public.checkins where id = v_id),
    'correção manual nasce sem ip_address, o que a separa do ponto batido pela RPC');

  delete from public.checkins where id = v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. `anon` fora das tabelas do ponto
-- -----------------------------------------------------------------------------
\echo '0075 — privilégio de tabela de anon'

do $$
declare
  v_tab text;
  v_verbo text;
begin
  foreach v_tab in array array['public.checkins', 'public.work_shifts', 'public.allowed_ips'] loop
    foreach v_verbo in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', v_tab, v_verbo) then
        raise exception 'FALHOU: anon ainda tem % em %', v_verbo, v_tab;
      end if;
    end loop;
  end loop;
  raise notice '  ok  anon não tem select/insert/update/delete em checkins, work_shifts e allowed_ips';

  -- `authenticated` continua com a porta aberta: o porteiro é o RLS.
  perform pg_temp.check75(
    has_table_privilege('authenticated', 'public.checkins', 'SELECT'),
    'authenticated mantém o privilégio de tabela — quem recorta a linha é a policy');
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Turno: ordem, meia-noite, sobreposição e exclusão
-- -----------------------------------------------------------------------------
\echo '0075 — guarda de work_shifts'

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000750001';
  cor uuid := '00000000-0000-0000-0000-000000750003';
  v_shift uuid;
  v_msg   text;
  v_state text;
begin
  -- a) distribuição antes do check-in: mensagem nossa, não o 23514 do CHECK.
  begin
    insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time)
    values ('ordem-75', 'Ordem 75', '10:00', '09:00', '12:00');
    raise exception 'FALHOU: turno com distribuição antes do check-in foi aceito';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    perform pg_temp.check75(v_state = 'P0001' and v_msg like '%não pode começar antes do check-in%',
      'distribuição antes do check-in explica qual campo corrigir (P0001, não 23514)');
  end;

  -- b) turno atravessando a meia-noite: recusado COM o motivo.
  begin
    insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time)
    values ('meianoite-75', 'Vira o dia 75', '22:00', '22:30', '02:00');
    raise exception 'FALHOU: turno atravessando a meia-noite foi aceito';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    perform pg_temp.check75(v_state = 'P0001' and v_msg like '%atravessa a meia-noite%',
      'turno que vira o dia é recusado dizendo por quê e o que fazer');
  end;

  -- c) sobreposição: recusada para usuário autenticado...
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('base-75', 'Base 75', '08:00', '08:30', '12:00', 75)
  on conflict (code) do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  begin
    set local role authenticated;
    insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
    values ('sobrepoe-75', 'Sobrepõe 75', '11:00', '11:30', '14:00', 76);
    reset role;
    raise exception 'FALHOU: turno sobreposto foi aceito pela tela do admin';
  exception when others then
    reset role;
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    perform pg_temp.check75(v_state = 'P0001' and v_msg like '%se sobrepõe ao turno%',
      'turno sobreposto é recusado na escrita do admin, com o turno conflitante nomeado');
  end;
  perform set_config('request.jwt.claims', '', false);

  -- ...e liberada para service_role, que monta turno 24h como fixture.
  select id into v_shift from public.work_shifts where code = 'teste-75';
  perform pg_temp.check75(v_shift is not null,
    'o turno 24h do harness (service_role) continua podendo existir sobre os outros');

  -- d) excluir turno com presença: mensagem nossa, não o 23503 da FK.
  insert into public.checkins (profile_id, shift_id, work_date)
  values (cor, v_shift, public.current_work_date());
  begin
    delete from public.work_shifts where id = v_shift;
    raise exception 'FALHOU: turno com presença registrada foi excluído';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    perform pg_temp.check75(v_state = 'P0001' and v_msg like '%presença(s) registrada(s)%',
      'excluir turno com presença diz que o vínculo são presenças e oferece desativar');
  end;

  delete from public.checkins where shift_id = v_shift;
  delete from public.work_shifts where code in ('teste-75', 'base-75');
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Faixa de IP: uma por (endereço, equipe) e nunca /0
-- -----------------------------------------------------------------------------
\echo '0075 — guarda de allowed_ips'

do $$
declare
  v_msg   text;
  v_state text;
begin
  -- 198.51.100.0/24 é TEST-NET-2 (RFC 5737), reservada para documentação.
  insert into public.allowed_ips (ip_range, label, active)
  values ('198.51.100.64/32', 'faixa 75', true);

  begin
    insert into public.allowed_ips (ip_range, label, active)
    values ('198.51.100.64/32', 'faixa 75 gêmea', true);
    raise exception 'FALHOU: a mesma faixa global entrou duas vezes';
  exception when unique_violation then
    raise notice '  ok  a mesma faixa global não entra duas vezes';
  end;

  begin
    insert into public.allowed_ips (ip_range, label, active)
    values ('0.0.0.0/0', 'a internet inteira', true);
    raise exception 'FALHOU: faixa /0 foi aceita e libera o check-in para o mundo';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    perform pg_temp.check75(v_state = 'P0001' and v_msg like '%qualquer endereço da internet%',
      'faixa /0 é recusada dizendo que ela anula a trava antifraude');
  end;

  -- Reativar uma /0 que já existisse cai na mesma guarda (é UPDATE).
  begin
    insert into public.allowed_ips (ip_range, label, active)
    values ('::/0', 'a internet inteira, v6', false);
    raise exception 'FALHOU: faixa ::/0 foi aceita';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.check75(v_state = 'P0001', 'a guarda vale para IPv6 (::/0) também');
  end;

  delete from public.allowed_ips where label like 'faixa 75%';
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Elegibilidade: o ramo "Perfil inativo" nunca tinha sido testado
-- -----------------------------------------------------------------------------
\echo '0075 — checkin_eligibility com perfil inativo'

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000750001';
  cor uuid := '00000000-0000-0000-0000-000000750003';
  v_ok     boolean;
  v_reason text;
begin
  -- `profiles_guard_admin_columns` (0012) exige admin para mexer em `status`;
  -- o caminho real é o do administrador, então é o que o teste usa.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  -- `profile_status` tem active/suspended/terminated; 'inativo' na tela é
  -- qualquer coisa diferente de 'active'.
  update public.profiles set status = 'suspended' where id = cor;

  select e.allowed, e.reason into v_ok, v_reason from public.checkin_eligibility(cor) e;
  perform pg_temp.check75(not v_ok, 'perfil inativo não bate ponto');
  perform pg_temp.check75(v_reason = 'Perfil inativo.',
    'o motivo chega pronto em pt-BR — a tela mostra o texto do banco, não uma conta dela');

  update public.profiles set status = 'active' where id = cor;
  perform set_config('request.jwt.claims', '', false);

  select e.allowed into v_ok from public.checkin_eligibility(cor) e;
  perform pg_temp.check75(v_ok, 'reativar o perfil devolve a elegibilidade');
end
$$;

\echo '0075 ok'
