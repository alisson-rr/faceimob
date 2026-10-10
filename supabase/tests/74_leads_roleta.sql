-- =============================================================================
-- 0074 · Teto de voltas, bandeja "sem atendimento", encerramento do lead e
--        fila que respeita grupo desativado.
--
-- O que este arquivo cobra, e por quê:
--
--   1. Com DOIS corretores na fila o lead PARA de circular no teto. A 0056 só
--      testava a fila unitária, e era exatamente com dois ou mais que o laço
--      acontecia em homologação (7 leads com 22 prazos vencidos cada). Sem este
--      assert a suíte fica verde com a roleta girando em falso.
--   2. Estourado o teto, alguém é avisado: evento no histórico e notificação
--      para gerente/diretor/admin. Um lead parado que ninguém vê é o mesmo
--      defeito de antes com outro nome.
--   3. O botão "Distribuir" do gestor continua sendo a válvula do teto.
--   4. Grupo desativado esvazia a fila.
--   5. `close_lead` tira o lead da conta que bloqueia o check-in, exige motivo
--      e recusa quem não escreve no lead.
--   6. Ninguém limpa `next_action_at` de lead em atendimento — a fuga
--      silenciosa do bloqueio dos 20.
--   7. Os leads presos na bandeja não ocupam a janela de 50 da varredura da
--      fila. É o efeito colateral do próprio teto: como são os mais antigos,
--      sem excluí-los o cron gastaria a rodada inteira em leads que nunca vão
--      ser distribuídos, e o lead novo não sairia da fila.
--
-- Não depende de seed.sql: o cenário cria grupo, turno e presenças próprios.
-- =============================================================================

\set ON_ERROR_STOP on

-- Os cenários abaixo atribuem leads com data retroativa; o recomeço da 0187
-- (gravado quando a migration roda) os esconderia do corretor e da contagem
-- de atrasados. Sem recomeço, vale a regra de sempre.
update public.automation_settings set leads_recomeco_em = null;
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check74(cond boolean, label text)
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
  adm  uuid := '00000000-0000-0000-0000-000000740001';
  ger  uuid := '00000000-0000-0000-0000-000000740002';
  cora uuid := '00000000-0000-0000-0000-000000740003';
  corb uuid := '00000000-0000-0000-0000-000000740004';
  soc  uuid := '00000000-0000-0000-0000-000000740005';
  v_group uuid;
  v_shift uuid;
  v_team  uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@roleta74.test',  '{"full_name":"Admin 74"}'),
    (ger,  'ger@roleta74.test',  '{"full_name":"Gerente 74"}'),
    (cora, 'cora@roleta74.test', '{"full_name":"Corretor A 74"}'),
    (corb, 'corb@roleta74.test', '{"full_name":"Corretor B 74"}'),
    (soc,  'soc@roleta74.test',  '{"full_name":"Socio 74"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cora, 'broker'), (corb, 'broker'), (soc, 'partner')
  on conflict do nothing;

  -- O gerente lidera a equipe dos dois corretores: é o que faz
  -- `manages_profile` responder verdadeiro e `can_write_lead` liberar o gestor.
  insert into public.teams (name, manager_id) values ('Equipe 74', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cora), (v_team, corb);

  insert into public.distribution_groups (name, slug, kind, active)
  values ('Roleta 74', 'roleta-74', 'specific', true)
  returning id into v_group;

  insert into public.distribution_group_members (group_id, profile_id, active)
  values (v_group, cora, true), (v_group, corb, true);

  -- Turno que cobre o dia inteiro: o teste não pode depender da hora do relógio.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('teste-74', 'Integral 74', '00:00', '00:00', '23:59:59.999999', -74)
  returning id into v_shift;

  insert into public.checkins (profile_id, shift_id, work_date) values
    (cora, v_shift, public.current_work_date()),
    (corb, v_shift, public.current_work_date());
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. sem teto (0212): o lead gira até alguém atender, sem aviso =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_group uuid;
  v_lead  uuid;
  v_alvo  uuid;
  v_anterior uuid;
  v_status public.lead_status;
  v_misses int;
  i int;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-74';
  perform pg_temp.check74(
    (select roulette_max_rounds from public.automation_settings where id) = 0,
    'o teto de voltas está desligado (0 = sem teto)');

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Laco 74', '11900740001', v_group)
  returning id into v_lead;

  v_alvo := public.assign_lead(v_lead);
  perform pg_temp.check74(v_alvo is not null,
    'o lead entra na roleta com dois corretores na fila');

  -- Cada volta é o que `release_expired_leads` faz: fecha a atribuição por
  -- prazo, devolve o lead à fila e reatribui. 8 voltas passam do antigo teto 5.
  for i in 1..8 loop
    v_anterior := v_alvo;
    -- clock_timestamp: dentro do mesmo bloco now() não anda, e "quem deixou
    -- vencer por último" precisa de horários diferentes.
    update public.lead_assignments
       set released_at = clock_timestamp(), release_reason = 'timeout'
     where lead_id = v_lead and released_at is null;
    update public.leads
       set status = 'queued', assigned_to = null, assigned_at = null, attend_deadline = null
     where id = v_lead;
    v_alvo := public.assign_lead(v_lead);
    perform pg_temp.check74(v_alvo is not null,
      format('volta %s ainda é entregue a alguém', i));
    perform pg_temp.check74(v_alvo <> v_anterior,
      format('volta %s: quem deixou vencer não recebe de novo havendo outro na fila', i));
  end loop;

  select status, roulette_misses into v_status, v_misses
    from public.leads where id = v_lead;
  perform pg_temp.check74(v_status = 'assigned', 'depois de 8 voltas o lead segue com um corretor');
  perform pg_temp.check74(v_misses = 8, 'o contador de voltas do lead bate com os prazos vencidos');

  perform pg_temp.check74(
    not exists (select 1 from public.lead_events e
                 where e.lead_id = v_lead and e.kind = 'unattended'),
    'nenhum "saiu da roleta" no histórico');
  perform pg_temp.check74(
    not exists (select 1 from public.notifications n
                 where n.kind = 'lead_unattended' and n.link = '/leads?lead=' || v_lead),
    'ninguém recebe o aviso de lead sem atendimento');

  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. grupo desativado esvazia a fila =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_group uuid;
  v_antes int;
  v_depois int;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-74';

  select count(*)::int into v_antes from public.distribution_queue(v_group);
  perform pg_temp.check74(v_antes = 2, 'os dois corretores estão na fila do grupo ativo');

  update public.distribution_groups set active = false where id = v_group;
  select count(*)::int into v_depois from public.distribution_queue(v_group);
  perform pg_temp.check74(v_depois = 0,
    'desativar o grupo em Admin tira todo mundo da fila dele');

  update public.distribution_groups set active = true where id = v_group;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 5. encerrar o lead é a saída da conta dos atrasados =='
-- -----------------------------------------------------------------------------
do $$
declare
  cora uuid := '00000000-0000-0000-0000-000000740003';
  corb uuid := '00000000-0000-0000-0000-000000740004';
  soc  uuid := '00000000-0000-0000-0000-000000740005';
  v_group uuid;
  v_lead  uuid;
  v_msg   text := '';
  v_antes int;
  v_depois int;
  v_row   public.leads;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-74';

  insert into public.leads
    (full_name, phone, distribution_group_id, status, assigned_to, assigned_at, next_action_at)
  values ('Lead Perdido 74', '11900740002', v_group, 'in_progress', cora,
          now() - interval '2 days', now() - interval '1 day')
  returning id into v_lead;

  -- Atribuição em aberto: encerrar o lead precisa fechá-la, senão a roleta
  -- continua contando a vez do corretor num lead que acabou.
  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  values (v_lead, cora, v_group, 1, now() + interval '5 minutes');

  v_antes := public.overdue_lead_count(cora);
  perform pg_temp.check74(v_antes >= 1, 'o lead com prazo vencido conta como atrasado');

  -- Motivo é obrigatório: sem ele o "perdido" vira lixo de relatório.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  begin
    perform public.close_lead(v_lead, 'lost', '   ');
    raise exception 'FALHOU: encerrou o lead sem motivo';
  exception when raise_exception then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    raise notice '  ok  encerrar o lead exige motivo';
  end;

  -- Quem não escreve no lead não encerra. O sócio deixou de ser essa
  -- testemunha em 10/09/2026: por decisão do cliente ele é administrador
  -- (0097 em `is_admin()`, 0099 em `has_any_role('admin', …)`), e `close_lead`
  -- cobra `can_write_lead`, que passa por `is_admin()`. O assert virou de lado
  -- — agora afirma que o sócio escreve — e a recusa passa a ser provada pelo
  -- corretor de fora, que continua sem direito de escrita no lead alheio.
  perform set_config('request.jwt.claims',
    json_build_object('sub', soc::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check74(public.can_write_lead(v_lead),
    'sócio escreve no lead: encerrar deixou de ser recusa para ele (regra de 10/09/2026)');

  perform set_config('request.jwt.claims',
    json_build_object('sub', corb::text, 'role', 'authenticated')::text, false);
  begin
    perform public.close_lead(v_lead, 'lost', 'Sem interesse');
    raise exception 'FALHOU: corretor de fora encerrou lead de outro corretor';
  exception when insufficient_privilege then
    raise notice '  ok  quem não escreve no lead não o encerra';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  v_row := public.close_lead(v_lead, 'lost', 'Sem interesse');
  perform set_config('request.jwt.claims', '', false);

  v_depois := public.overdue_lead_count(cora);
  perform pg_temp.check74(v_row.status = 'lost', 'o lead encerrado fica como perdido');
  perform pg_temp.check74(v_row.lost_reason = 'Sem interesse',
    'o motivo do encerramento fica gravado no lead');
  perform pg_temp.check74(v_row.lost_at is not null, 'a data do encerramento fica gravada');
  perform pg_temp.check74(v_depois = v_antes - 1,
    'encerrar o lead tira uma unidade da conta que bloqueia o check-in');
  -- CONTA, não `exists`: o gatilho `leads_log_changes` (0005) já grava o
  -- `status_changed` de toda mudança de status. Enquanto `close_lead` gravava o
  -- seu, o histórico saía duplicado e o relatório de motivo de perda contava em
  -- dobro — e um `exists` passava sem enxergar nada disso.
  perform pg_temp.check74(
    (select count(*) from public.lead_events e
      where e.lead_id = v_lead and e.kind = 'status_changed'
        and e.to_value = 'lost') = 1,
    'a perda entra no histórico UMA vez, só pelo gatilho');
  perform pg_temp.check74(
    exists (select 1 from public.lead_events e
             where e.lead_id = v_lead and e.kind = 'closed'
               and e.to_value = 'lost'
               and e.detail ->> 'reason' = 'Sem interesse'),
    'o motivo do encerramento fica num evento próprio, com o texto escolhido');
  perform pg_temp.check74(
    not exists (select 1 from public.lead_assignments la
                 where la.lead_id = v_lead and la.released_at is null),
    'encerrar o lead fecha a atribuição aberta');

  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 6. ninguém apaga a próxima ação de um lead em atendimento =='
-- -----------------------------------------------------------------------------
do $$
declare
  cora uuid := '00000000-0000-0000-0000-000000740003';
  v_lead uuid;
begin
  insert into public.leads (full_name, phone, status, assigned_to, next_action_at)
  values ('Lead Prazo 74', '11900740003', 'in_progress', cora, now() + interval '1 day')
  returning id into v_lead;

  begin
    update public.leads set next_action_at = null where id = v_lead;
    raise exception 'FALHOU: limpar a próxima ação de lead em atendimento passou';
  exception when raise_exception then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    raise notice '  ok  limpar a próxima ação de lead em atendimento é recusado';
  end;

  -- Mudar a data continua livre: a trava é contra apagar, não contra reagendar.
  update public.leads set next_action_at = now() + interval '3 days' where id = v_lead;
  perform pg_temp.check74(
    (select next_action_at from public.leads where id = v_lead) > now(),
    'reagendar a próxima ação continua permitido');

  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 7. o lead parado na antiga bandeja volta a girar =='
--
-- Sem teto (0212), o lead que tinha ficado parado na bandeja "sem atendimento"
-- volta a girar na próxima varredura do cron.
--
-- Em transação própria porque a varredura é global (mexe em qualquer lead em
-- `queued`, inclusive os do catálogo) e o teste não pode deixar rastro.
-- -----------------------------------------------------------------------------
begin;

do $$
declare
  v_group uuid;
  v_preso uuid;
  v_status public.lead_status;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-74';

  insert into public.leads
    (full_name, phone, distribution_group_id, status, roulette_misses, created_at)
  values ('Lead Preso 74', '11900741001', v_group, 'queued', 5, timestamptz '2000-01-01')
  returning id into v_preso;

  perform public.assign_queued_leads();

  select status into v_status from public.leads where id = v_preso;
  perform pg_temp.check74(v_status = 'assigned',
    'o lead que estava parado depois de 5 voltas volta a ser entregue');
end
$$;

rollback;

-- -----------------------------------------------------------------------------
-- Limpeza: o turno "Integral 74" cobre o dia inteiro e ganharia de
-- `current_shift` para qualquer teste posterior. As presenças saem junto.
-- -----------------------------------------------------------------------------
do $$
begin
  delete from public.checkins
   where shift_id in (select id from public.work_shifts where code = 'teste-74');
  update public.work_shifts set active = false where code = 'teste-74';
  update public.distribution_groups set active = false where slug = 'roleta-74';
end
$$;

\echo 'teto de voltas, bandeja, encerramento e fila ok'
