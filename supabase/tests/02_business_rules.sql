-- =============================================================================
-- Teste funcional das regras de negócio críticas.
--
-- Exercita o que o cliente descreveu em reunião e que, se quebrar, quebra
-- silenciosamente em produção:
--
--   1. roleta distribui por round-robin, não aleatório
--   2. só entra na roleta quem tem check-in aberto
--   3. claim_lead trava o lead e para o cronômetro
--   4. prazo estourado devolve o lead à fila e redistribui
--   5. check-in bloqueado com 20+ leads atrasados
--   6. conversão em negócio exige documento anexado
--   7. VGV divide igualmente entre corretores e fecha em 100%
--   8. gerente e diretor entram no negócio automaticamente
--   9. mês fechado bloqueia edição de negócio
--
-- Depende de seed.sql (estágios, tipos de documento, fila geral).
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check(cond boolean, label text)
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
  chefe uuid := '00000000-0000-0000-0000-00000000aa01'; -- admin
  ger   uuid := '00000000-0000-0000-0000-00000000aa02'; -- gerente
  dir   uuid := '00000000-0000-0000-0000-00000000aa03'; -- diretor
  c1    uuid := '00000000-0000-0000-0000-00000000aa04'; -- corretor 1
  c2    uuid := '00000000-0000-0000-0000-00000000aa05'; -- corretor 2
  c3    uuid := '00000000-0000-0000-0000-00000000aa06'; -- corretor 3, sem check-in
  v_team  uuid;
  v_grupo uuid;
  v_shift uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (chefe, 'chefe@t.test', '{"full_name":"Chefe"}'),
    (dir,   'dir@t.test',   '{"full_name":"Diretor Teste"}'),
    (ger,   'ger@t.test',   '{"full_name":"Gerente Teste"}'),
    (c1,    'c1@t.test',    '{"full_name":"Corretor Um"}'),
    (c2,    'c2@t.test',    '{"full_name":"Corretor Dois"}'),
    (c3,    'c3@t.test',    '{"full_name":"Corretor Tres"}');

  insert into public.user_roles (profile_id, role) values
    (chefe, 'admin'), (dir, 'director'), (ger, 'manager')
  on conflict do nothing;

  insert into public.teams (name, director_id, manager_id)
  values ('Equipe Teste', dir, ger) returning id into v_team;

  insert into public.team_members (team_id, profile_id)
  values (v_team, c1), (v_team, c2), (v_team, c3);

  select id into v_grupo from public.distribution_groups where kind = 'general' limit 1;

  insert into public.distribution_group_members (group_id, profile_id)
  values (v_grupo, c1), (v_grupo, c2), (v_grupo, c3);

  -- Turno que cobre o dia inteiro, para o teste não depender da hora do relógio.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('teste', 'Integral Teste', '00:00', '00:00', '23:59', 0)
  returning id into v_shift;

  -- c1 e c2 batem ponto; c3 não.
  insert into public.checkins (profile_id, shift_id, work_date) values
    (c1, v_shift, current_date),
    (c2, v_shift, current_date);
end
$$;

-- -----------------------------------------------------------------------------
-- 1-2. Roleta: distribui só para quem tem check-in, em round-robin
-- -----------------------------------------------------------------------------
\echo '== roleta =='

do $$
declare
  c1 uuid := '00000000-0000-0000-0000-00000000aa04';
  c2 uuid := '00000000-0000-0000-0000-00000000aa05';
  c3 uuid := '00000000-0000-0000-0000-00000000aa06';
  l1 uuid; l2 uuid; l3 uuid;
  a1 uuid; a2 uuid; a3 uuid;
begin
  insert into public.leads (full_name, phone) values ('Lead A', '11900000001') returning id into l1;
  insert into public.leads (full_name, phone) values ('Lead B', '11900000002') returning id into l2;
  insert into public.leads (full_name, phone) values ('Lead C', '11900000003') returning id into l3;

  a1 := public.assign_lead(l1);
  a2 := public.assign_lead(l2);
  a3 := public.assign_lead(l3);

  perform pg_temp.check(a1 is not null, 'primeiro lead foi atribuído');
  perform pg_temp.check(a1 <> a2, 'segundo lead foi para outro corretor (round-robin)');
  perform pg_temp.check(a3 = a1, 'terceiro lead voltou ao primeiro da fila');
  perform pg_temp.check(
    a1 <> c3 and a2 <> c3 and a3 <> c3,
    'corretor sem check-in não recebeu lead');

  -- Fila tem exatamente os dois presentes.
  perform pg_temp.check(
    (select count(*) from public.distribution_queue(
       (select id from public.distribution_groups where kind = 'general' limit 1))) = 2,
    'fila da roleta lista apenas os 2 com check-in');
end
$$;

-- -----------------------------------------------------------------------------
-- 3-4. Trava de atendimento e devolução por timeout
-- -----------------------------------------------------------------------------
\echo '== trava de atendimento =='

do $$
declare
  v_lead   uuid;
  v_broker uuid;
  v_status lead_status;
  v_dl     timestamptz;
  v_moved  int;
begin
  insert into public.leads (full_name, phone) values ('Lead Trava', '11900000010')
  returning id into v_lead;
  v_broker := public.assign_lead(v_lead);

  select status, attend_deadline into v_status, v_dl from public.leads where id = v_lead;
  perform pg_temp.check(v_status = 'assigned', 'lead atribuído fica em "assigned"');
  perform pg_temp.check(v_dl is not null, 'cronômetro de 5 min está correndo');

  -- O corretor assume: trava com ele e o cronômetro para.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_broker::text, 'role', 'authenticated')::text, false);
  perform public.claim_lead(v_lead);

  select status, attend_deadline into v_status, v_dl from public.leads where id = v_lead;
  perform pg_temp.check(v_status = 'attending', 'após atender, lead fica em "attending"');
  perform pg_temp.check(v_dl is null, 'cronômetro parou ao assumir o lead');
  perform set_config('request.jwt.claims', '', false);

  -- Outro lead cujo prazo já venceu volta para a fila e é redistribuído.
  insert into public.leads (full_name, phone) values ('Lead Vencido', '11900000011')
  returning id into v_lead;
  perform public.assign_lead(v_lead);
  update public.leads set attend_deadline = now() - interval '1 minute' where id = v_lead;

  v_moved := public.release_expired_leads();
  perform pg_temp.check(v_moved = 1, 'varredura devolveu 1 lead vencido');

  perform pg_temp.check(
    (select count(*) from public.lead_assignments
      where lead_id = v_lead and release_reason = 'timeout') = 1,
    'atribuição vencida ficou registrada com motivo timeout');
  perform pg_temp.check(
    (select count(*) from public.lead_assignments where lead_id = v_lead) = 2,
    'lead foi redistribuído (2ª volta da roleta)');

  -- Quem estourou o prazo não recebe o mesmo lead de volta na hora (0014).
  -- Antes da 0014 a fila ordenava por assigned_at, e o corretor que ignorou o
  -- lead continuava com o carimbo de 5 minutos atrás — podia seguir na frente.
  perform pg_temp.check(
    (select profile_id from public.lead_assignments
       where lead_id = v_lead and sequence = 2)
    is distinct from
    (select profile_id from public.lead_assignments
       where lead_id = v_lead and sequence = 1),
    'lead vencido foi para outro corretor, não voltou para quem o ignorou');
end
$$;

-- -----------------------------------------------------------------------------
-- 4b. Ordenação da fila: timeout encerra a vez  (0014)
--
-- Timestamps explícitos porque now() é constante dentro da transação: com
-- released_at e o novo assigned_at no mesmo instante o desempate cairia no
-- profile_id e o teste ficaria não-determinístico.
-- -----------------------------------------------------------------------------
\echo '== ordem da fila após timeout =='

do $$
declare
  c1     uuid := '00000000-0000-0000-0000-00000000aa04';
  c2     uuid := '00000000-0000-0000-0000-00000000aa05';
  grupo  uuid;
  v_pos1 int;
  v_pos2 int;
  v_last timestamptz;
  v_turn timestamptz;
begin
  select id into grupo from public.distribution_groups where kind = 'general' limit 1;

  -- c1 recebeu há 10 min e perdeu o lead no prazo há 1 min.
  update public.lead_assignments
     set assigned_at = now() - interval '10 minutes'
   where profile_id = c1;
  update public.lead_assignments
     set released_at = now() - interval '1 minute', release_reason = 'timeout'
   where profile_id = c1
     and assigned_at = (select max(assigned_at) from public.lead_assignments where profile_id = c1);

  -- c2 recebeu há 5 min e continua com o lead.
  update public.lead_assignments
     set assigned_at = now() - interval '5 minutes',
         released_at = null, release_reason = null
   where profile_id = c2;

  select queue_position into v_pos1 from public.distribution_queue(grupo) where profile_id = c1;
  select queue_position into v_pos2 from public.distribution_queue(grupo) where profile_id = c2;

  -- Por assigned_at, c1 (-10min) viria antes de c2 (-5min). Pelo fim da vez,
  -- c1 (-1min) vem depois: é o que a 0014 corrige.
  perform pg_temp.check(v_pos2 < v_pos1,
    'quem perdeu o lead por timeout ficou atrás de quem está atendendo');
  perform pg_temp.check(
    v_pos1 = (select count(*) from public.distribution_queue(grupo)),
    'corretor que estourou o prazo foi para o fim da fila');

  select last_assigned_at, last_turn_at into v_last, v_turn
  from public.distribution_queue(grupo) where profile_id = c1;

  perform pg_temp.check(v_last < v_turn,
    'last_assigned_at continua sendo o recebimento; last_turn_at é o fim da vez');

  -- Liberação por outro motivo não tira a vez de ninguém: o gestor realocar um
  -- lead, ou o SDR repassar, não é falha de atendimento do corretor.
  update public.lead_assignments
     set release_reason = 'reassigned'
   where profile_id = c1 and release_reason = 'timeout';

  select last_turn_at into v_turn
  from public.distribution_queue(grupo) where profile_id = c1;
  perform pg_temp.check(v_turn = (select last_assigned_at from public.distribution_queue(grupo)
                                   where profile_id = c1),
    'liberação por realocação não conta como vez consumida');
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Bloqueio de check-in por leads atrasados
-- -----------------------------------------------------------------------------
\echo '== bloqueio por atraso =='

do $$
declare
  c1 uuid := '00000000-0000-0000-0000-00000000aa04';
  v_ok boolean;
  i int;
begin
  select allowed into v_ok from public.checkin_eligibility(c1);
  perform pg_temp.check(v_ok, 'corretor sem atraso pode fazer check-in');

  -- 20 leads vencidos.
  for i in 1..20 loop
    insert into public.leads (full_name, phone, status, assigned_to, next_action_at)
    values ('Atrasado ' || i, '1190000' || lpad(i::text, 4, '0'),
            'in_progress', c1, now() - interval '1 day');
  end loop;

  select allowed into v_ok from public.checkin_eligibility(c1);
  perform pg_temp.check(not v_ok, 'corretor com 20 leads atrasados é bloqueado');

  perform pg_temp.check(
    (select overdue_count from public.checkin_eligibility(c1)) = 20,
    'contagem de atrasados bate');

  -- E some da roleta.
  perform pg_temp.check(
    not exists (
      select 1 from public.distribution_queue(
        (select id from public.distribution_groups where kind = 'general' limit 1))
      where profile_id = c1),
    'corretor bloqueado sai da fila da roleta');
end
$$;

-- -----------------------------------------------------------------------------
-- 6-8. Conversão, VGV e preenchimento automático de gerente/diretor
-- -----------------------------------------------------------------------------
\echo '== conversão e VGV =='

do $$
declare
  chefe uuid := '00000000-0000-0000-0000-00000000aa01';
  ger   uuid := '00000000-0000-0000-0000-00000000aa02';
  dir   uuid := '00000000-0000-0000-0000-00000000aa03';
  c1    uuid := '00000000-0000-0000-0000-00000000aa04';
  c2    uuid := '00000000-0000-0000-0000-00000000aa05';
  v_dev  uuid;
  v_lead uuid;
  v_deal public.deals;
  v_soma numeric;
begin
  insert into public.developers (name, flow) values ('Construtora Teste', 'internal')
  returning id into v_dev;

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente Convertido', '11900000020', 'in_progress', c1)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', chefe::text, 'role', 'authenticated')::text, false);

  -- Sem documento, a conversão tem que falhar.
  begin
    v_deal := public.convert_lead_to_deal(v_lead, v_dev);
    raise exception 'FALHOU: converteu lead sem documento anexado';
  exception
    when raise_exception then
      if position('documento' in sqlerrm) = 0 then raise; end if;
      raise notice '  ok  conversão sem documento é rejeitada';
  end;

  -- Com documento, passa.
  insert into public.lead_attachments
    (lead_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_lead,
          (select id from public.document_types where code = 'rg_cpf'),
          'leads/' || v_lead || '/rg.pdf', 'rg.pdf', 'rg-cliente.pdf', c1);

  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, 'Apto 101', 500000);
  perform pg_temp.check(v_deal.id is not null, 'conversão com documento funciona');

  perform pg_temp.check(
    (select status from public.leads where id = v_lead) = 'converted',
    'lead marcado como convertido');

  perform pg_temp.check(
    (select count(*) from public.deal_documents where deal_id = v_deal.id) = 1,
    'anexo do lead migrou para o negócio');

  -- Gerente e diretor entraram sozinhos.
  perform pg_temp.check(
    exists (select 1 from public.deal_participants
            where deal_id = v_deal.id and profile_id = ger and role = 'manager'),
    'gerente foi preenchido automaticamente');
  perform pg_temp.check(
    exists (select 1 from public.deal_participants
            where deal_id = v_deal.id and profile_id = dir and role = 'director'),
    'diretor foi preenchido automaticamente');

  -- Um corretor: 100%.
  perform pg_temp.check(
    (select share_pct from public.deal_participants
      where deal_id = v_deal.id and profile_id = c1 and role = 'broker') = 100,
    'corretor sozinho fica com 100% do VGV');

  -- Entra o segundo: 50/50.
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal.id, c2, 'broker');

  select sum(share_pct) into v_soma from public.deal_participants
  where deal_id = v_deal.id and role = 'broker';
  perform pg_temp.check(v_soma = 100, 'com 2 corretores o rateio ainda fecha em 100%');
  perform pg_temp.check(
    (select share_pct from public.deal_participants
      where deal_id = v_deal.id and profile_id = c1 and role = 'broker') = 50,
    'divisão igualitária: 50% para cada corretor');

  -- VGV líquido é derivado, não digitado.
  perform pg_temp.check(
    (select vgv_net from public.deals where id = v_deal.id) = 500000,
    'VGV líquido calculado sem desconto');
  update public.deals set discount_pct = 10 where id = v_deal.id;
  perform pg_temp.check(
    (select vgv_net from public.deals where id = v_deal.id) = 450000,
    'VGV líquido recalculado com 10% de desconto');

  perform set_config('request.jwt.claims', '', false);
end
$$;

-- -----------------------------------------------------------------------------
-- 9. Mês fechado trava edição
-- -----------------------------------------------------------------------------
\echo '== fechamento de mês =='

do $$
declare
  ger    uuid := '00000000-0000-0000-0000-00000000aa02';
  v_deal uuid;
begin
  select id into v_deal from public.deals limit 1;

  insert into public.closed_months (period)
  values (public.month_start(current_date))
  on conflict (period) do nothing;

  -- Gerente não consegue mexer em negócio de mês fechado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  begin
    update public.deals set notes = 'tentativa' where id = v_deal;
    raise exception 'FALHOU: gerente editou negócio de mês fechado';
  exception
    when raise_exception then
      if position('fechado' in sqlerrm) = 0 then raise; end if;
      raise notice '  ok  mês fechado bloqueia edição pelo gerente';
  end;

  -- Admin ainda consegue, para correções.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-00000000aa01', 'role', 'authenticated')::text, false);
  update public.deals set notes = 'correcao admin' where id = v_deal;
  perform pg_temp.check(
    (select notes from public.deals where id = v_deal) = 'correcao admin',
    'admin consegue corrigir negócio de mês fechado');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo ''
\echo 'regras de negócio ok'
