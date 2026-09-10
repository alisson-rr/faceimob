-- =============================================================================
-- Regressão dos achados da auditoria de CRUD.
--
-- Cada bloco reexecuta a sonda que ANTES passava (ou falhava) indevidamente.
-- Se alguma correção do 0012 for revertida, o teste correspondente quebra.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check2(cond boolean, label text)
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
  adm uuid := '00000000-0000-0000-0000-00000000dd01';
  ger uuid := '00000000-0000-0000-0000-00000000dd02';
  cor uuid := '00000000-0000-0000-0000-00000000dd03';
  fora uuid := '00000000-0000-0000-0000-00000000dd04';  -- corretor de outra equipe
  v_team uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@aud.test',  '{"full_name":"Admin Aud"}'),
    (ger,  'ger@aud.test',  '{"full_name":"Gerente Aud"}'),
    (cor,  'cor@aud.test',  '{"full_name":"Corretor Aud"}'),
    (fora, 'fora@aud.test', '{"full_name":"Corretor Fora"}');

  insert into public.user_roles (profile_id, role) values (adm,'admin'), (ger,'manager')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe Aud', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (name, flow) values ('Construtora Aud', 'internal');

  insert into public.work_shifts (code,label,checkin_start,distribution_start,checkout_time,position)
  values ('aud24','Aud 24h','00:00','00:00','23:59',-1);

  -- A 0020 passou a exigir IP identificado no check-in.
  insert into public.allowed_ips (label, ip_range)
  values ('Loja Aud', '203.0.113.0/24');

  -- O teste 02 fecha o mês corrente e roda no mesmo banco. Reabrimos aqui para
  -- que este arquivo não dependa da ordem de execução.
  delete from public.closed_months where period = public.month_start(current_date);
end
$$;

set role authenticated;

-- -----------------------------------------------------------------------------
-- 1. Escalada de privilégio via bypass_ip_check
-- -----------------------------------------------------------------------------
\echo '== 1. bypass de IP =='

do $$
declare cor uuid := '00000000-0000-0000-0000-00000000dd03';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  begin
    update public.profiles set bypass_ip_check = true where id = cor;
    raise exception 'FALHOU: corretor liberou o próprio bypass de IP';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não altera o próprio bypass_ip_check';
  end;

  perform pg_temp.check2(
    (select not bypass_ip_check from public.profiles where id = cor),
    'bypass_ip_check permanece desligado');
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Auto-alteração de status
-- -----------------------------------------------------------------------------
\echo '== 2. status do perfil =='

do $$
declare cor uuid := '00000000-0000-0000-0000-00000000dd03';
begin
  begin
    update public.profiles set status = 'suspended' where id = cor;
    raise exception 'FALHOU: corretor alterou o próprio status';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não altera o próprio status';
  end;

  -- Mas continua editando os dados de contato dele.
  update public.profiles set phone = '11999998888' where id = cor;
  perform pg_temp.check2(
    (select phone from public.profiles where id = cor) = '11999998888',
    'corretor ainda edita os próprios dados de contato');
end
$$;

-- Gestor desliga o corretor, mas não libera IP.
\echo '== 2b. alçada do gestor =='

do $$
declare
  ger uuid := '00000000-0000-0000-0000-00000000dd02';
  cor uuid := '00000000-0000-0000-0000-00000000dd03';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role','authenticated')::text, false);

  update public.profiles set status = 'suspended' where id = cor;
  perform pg_temp.check2(
    (select status from public.profiles where id = cor) = 'suspended',
    'gestor consegue suspender corretor da equipe');

  begin
    update public.profiles set bypass_ip_check = true where id = cor;
    raise exception 'FALHOU: gestor liberou bypass de IP';
  exception
    when insufficient_privilege then
      raise notice '  ok  gestor não libera bypass de IP (só admin)';
  end;

  -- devolve ao normal para os testes seguintes
  update public.profiles set status = 'active' where id = cor;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Check-out próprio
-- -----------------------------------------------------------------------------
\echo '== 3. check-out =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000dd03';
  v_row public.checkins;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  -- Regressão da 0020: sem IP identificado a trava de loja não existe, então a
  -- RPC recusa — chamada direta pelo client não contorna a validação por IP.
  begin
    v_row := public.perform_checkin(null);
    raise exception 'FALHOU: check-in sem IP deveria ser recusado';
  exception when others then
    if sqlerrm like 'IP não identificado%' then
      raise notice '  ok  check-in sem IP é recusado';
    else
      raise;
    end if;
  end;

  v_row := public.perform_checkin('203.0.113.10'::inet);
  perform pg_temp.check2(v_row.id is not null, 'check-in via RPC funciona com IP liberado');

  v_row := public.perform_checkout();
  perform pg_temp.check2(v_row.checked_out_at is not null,
    'corretor consegue fazer o próprio check-out');
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Negócio manual nasce visível e editável para quem criou
-- -----------------------------------------------------------------------------
\echo '== 4. negócio manual =='

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-00000000dd03';
  ger    uuid := '00000000-0000-0000-0000-00000000dd02';
  v_dev  uuid;
  v_stg  uuid;
  v_deal uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  select id into v_dev from public.developers where name = 'Construtora Aud';
  select id into v_stg from public.pipeline_stages where is_initial;

  -- INSERT ... RETURNING é o que o supabase-js emite com .select().
  insert into public.deals (developer_id, stage_id)
  values (v_dev, v_stg)
  returning id into v_deal;

  perform pg_temp.check2(v_deal is not null,
    'corretor cria negócio manual com RETURNING (o que o supabase-js faz)');

  perform pg_temp.check2(
    exists (select 1 from public.deal_participants
            where deal_id = v_deal and profile_id = cor and role = 'broker'),
    'criador entra automaticamente como corretor do negócio');

  perform pg_temp.check2(
    (select share_pct from public.deal_participants
      where deal_id = v_deal and profile_id = cor and role = 'broker') = 100,
    'criador fica com 100% do VGV');

  perform pg_temp.check2(
    exists (select 1 from public.deal_participants
            where deal_id = v_deal and profile_id = ger and role = 'manager'),
    'gerente da equipe entra junto');

  perform pg_temp.check2(
    (select count(*) from public.deals where id = v_deal) = 1,
    'negócio criado é visível para o criador');

  update public.deals set notes = 'editado pelo criador' where id = v_deal;
  perform pg_temp.check2(
    (select notes from public.deals where id = v_deal) = 'editado pelo criador',
    'negócio criado é editável pelo criador');
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Comentário em lead de outra equipe
-- -----------------------------------------------------------------------------
\echo '== 5. comentário em lead alheio =='

do $$
declare
  cor     uuid := '00000000-0000-0000-0000-00000000dd03';
  fora    uuid := '00000000-0000-0000-0000-00000000dd04';
  v_lead  uuid;
begin
  reset role;
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead de Outra Equipe', '11955554444', 'in_progress', fora)
  returning id into v_lead;
  set role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  begin
    -- UUID literal: o caminho que contorna o filtro de SELECT.
    insert into public.lead_comments (lead_id, author_id, body)
    values (v_lead, cor, 'espiando');
    raise exception 'FALHOU: corretor comentou em lead que não enxerga';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não comenta em lead de outra equipe';
  end;

  -- 0041: anexo segue a mesma regra do comentário. Antes o insert só olhava
  -- `uploaded_by`, gravava, e o select policy escondia a linha — anexo
  -- "enviado" que ninguém via.
  begin
    insert into public.lead_attachments (lead_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_lead, v_lead || '/espiando.pdf', 'espiando.pdf', 'espiando.pdf', cor);
    raise exception 'FALHOU: corretor anexou em lead que não enxerga';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não anexa em lead de outra equipe';
  end;
end
$$;

-- -----------------------------------------------------------------------------
-- 6. deal_clients: excluir exige direito de edição, não só de leitura
-- -----------------------------------------------------------------------------
\echo '== 6. deal_clients =='

do $$
declare
  fora     uuid := '00000000-0000-0000-0000-00000000dd04';
  socio    uuid := '00000000-0000-0000-0000-00000000dd05';
  v_deal   uuid;
  v_linhas int;
begin
  select id into v_deal from public.deals order by created_at desc limit 1;

  reset role;
  insert into public.deal_clients (deal_id, ordinal, full_name)
  values (v_deal, 1, 'Cliente Aud');

  insert into auth.users (id, email, raw_user_meta_data)
  values (socio, 'socio@aud.test', '{"full_name":"Socio Aud"}');
  insert into public.user_roles (profile_id, role) values
    (socio, 'partner'), (fora, 'cca')
  on conflict do nothing;
  set role authenticated;

  -- Sócio: leitura ampla, zero escrita. É o papel que separa ver de editar.
  perform set_config('request.jwt.claims',
    json_build_object('sub', socio::text, 'role','authenticated')::text, false);

  perform pg_temp.check2(
    (select count(*) from public.deal_clients where deal_id = v_deal) = 1,
    'sócio enxerga o cliente do negócio');

  delete from public.deal_clients where deal_id = v_deal;
  get diagnostics v_linhas = row_count;
  perform pg_temp.check2(v_linhas = 0, 'sócio não apaga cliente (só leitura)');

  update public.deal_clients set full_name = 'Alterado' where deal_id = v_deal;
  get diagnostics v_linhas = row_count;
  perform pg_temp.check2(v_linhas = 0, 'sócio não edita cliente');

  -- CCA: corrige dado do comprador, mas não exclui o comprador.
  perform set_config('request.jwt.claims',
    json_build_object('sub', fora::text, 'role','authenticated')::text, false);

  update public.deal_clients set cpf = '00000000000' where deal_id = v_deal;
  get diagnostics v_linhas = row_count;
  perform pg_temp.check2(v_linhas = 1, 'CCA corrige dado do comprador');

  delete from public.deal_clients where deal_id = v_deal;
  get diagnostics v_linhas = row_count;
  perform pg_temp.check2(v_linhas = 0, 'CCA não exclui o comprador do negócio');
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Superfícies novas existem e respondem
-- -----------------------------------------------------------------------------
\echo '== 7. cca_stages / annual_results =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000dd01';
  cor uuid := '00000000-0000-0000-0000-00000000dd03';
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role','authenticated')::text, false);

  insert into public.cca_stages (name, color, position, status)
  values ('Estágio Novo', '#000000', 99, 'under_review')
  returning id into v_id;
  perform pg_temp.check2(v_id is not null, 'admin cria estágio de CCA');

  update public.cca_stages set name = 'Renomeado' where id = v_id;
  perform pg_temp.check2(
    (select name from public.cca_stages where id = v_id) = 'Renomeado',
    'admin renomeia estágio de CCA');

  delete from public.cca_stages where id = v_id;
  perform pg_temp.check2(
    not exists (select 1 from public.cca_stages where id = v_id),
    'admin exclui estágio de CCA');

  insert into public.annual_results (year, month, sales_count, vgv)
  values (2026, 7, 12, 4500000)
  on conflict (year, month) do update
    set sales_count = excluded.sales_count, vgv = excluded.vgv;
  perform pg_temp.check2(
    (select sales_count from public.annual_results where year=2026 and month=7) = 12,
    'upsert de resultado anual por ano/mês funciona');

  -- Corretor não lê consolidado financeiro.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);
  perform pg_temp.check2(
    (select count(*) from public.annual_results) = 0,
    'corretor não lê o consolidado anual');
end
$$;

reset role;

\echo ''
\echo 'auditoria de CRUD ok'
