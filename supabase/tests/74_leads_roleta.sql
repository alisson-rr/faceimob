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
  values ('teste-74', 'Integral 74', '00:00', '00:00', '23:59', -74)
  returning id into v_shift;

  insert into public.checkins (profile_id, shift_id, work_date) values
    (cora, v_shift, public.current_work_date()),
    (corb, v_shift, public.current_work_date());
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. com DOIS corretores na fila o lead para de circular no teto =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_group uuid;
  v_lead  uuid;
  v_alvo  uuid;
  v_max   int;
  v_status public.lead_status;
  v_misses int;
  i int;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-74';
  select roulette_max_rounds into v_max from public.automation_settings where id;
  perform pg_temp.check74(coalesce(v_max, 0) > 0, 'existe teto de voltas configurado');

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Laco 74', '11900740001', v_group)
  returning id into v_lead;

  perform pg_temp.check74(public.assign_lead(v_lead) is not null,
    'o lead entra na roleta com dois corretores na fila');

  -- Cada volta é o que `release_expired_leads` faz: fecha a atribuição por
  -- prazo, devolve o lead à fila e reatribui.
  for i in 1..v_max loop
    update public.lead_assignments
       set released_at = now(), release_reason = 'timeout'
     where lead_id = v_lead and released_at is null;
    update public.leads
       set status = 'queued', assigned_to = null, assigned_at = null, attend_deadline = null
     where id = v_lead;
    v_alvo := public.assign_lead(v_lead);
    if i < v_max then
      perform pg_temp.check74(v_alvo is not null,
        format('volta %s/%s ainda é entregue a alguém', i, v_max));
    end if;
  end loop;

  select status, roulette_misses into v_status, v_misses
    from public.leads where id = v_lead;

  perform pg_temp.check74(v_alvo is null,
    format('no teto de %s voltas o lead sai da roleta em vez de circular', v_max));
  perform pg_temp.check74(v_misses = v_max,
    'o contador de voltas do lead bate com os prazos vencidos');
  perform pg_temp.check74(v_status = 'queued',
    'o lead sem atendimento espera na bandeja, não some da fila');

  -- 2. Alguém precisa ser avisado — era isto que faltava: o lead parava e o
  -- gestor só descobria abrindo o card de saúde da roleta.
  perform pg_temp.check74(
    exists (select 1 from public.lead_events e
             where e.lead_id = v_lead and e.kind = 'unattended'),
    'o lead sem atendimento entra no histórico do próprio lead');
  perform pg_temp.check74(
    exists (select 1 from public.notifications n
             where n.profile_id = '00000000-0000-0000-0000-000000740002'
               and n.kind = 'lead_unattended'),
    'o gerente é notificado quando o lead estoura o teto de voltas');

  -- Um aviso por travessia: o cron chama `assign_lead` a cada minuto e não
  -- pode encher a caixa do gestor com o mesmo lead.
  perform public.assign_lead(v_lead);
  perform public.assign_lead(v_lead);
  perform pg_temp.check74(
    (select count(*) from public.lead_events e
      where e.lead_id = v_lead and e.kind = 'unattended') = 1,
    'o cron insistindo não repete o aviso do mesmo lead');

  -- 3. A válvula: o gestor ainda distribui à mão.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000740002'::text,
                      'role', 'authenticated')::text, false);
  perform pg_temp.check74(public.distribute_queued_lead(v_lead) is not null,
    'o botão Distribuir do gestor ignora o teto e tira o lead da bandeja');
  perform set_config('request.jwt.claims', '', false);

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

  -- Quem não escreve no lead não encerra: o sócio enxerga e não decide.
  perform set_config('request.jwt.claims',
    json_build_object('sub', soc::text, 'role', 'authenticated')::text, false);
  begin
    perform public.close_lead(v_lead, 'lost', 'Sem interesse');
    raise exception 'FALHOU: sócio encerrou lead de outro corretor';
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
\echo '== 7. a bandeja não trava a janela de 50 da varredura da fila =='
--
-- `assign_queued_leads()` olha 50 leads por rodada, ordenados por `created_at`.
-- Os leads que estouraram o teto ficam em `queued` para sempre e são os MAIS
-- ANTIGOS: sem excluí-los, eles ocupam a janela inteira e o lead novo nunca é
-- alcançado — o cron roda a cada minuto sem distribuir nada.
--
-- Em transação própria porque a varredura é global (mexe em qualquer lead em
-- `queued`, inclusive os do catálogo) e o teste não pode deixar rastro.
-- -----------------------------------------------------------------------------
begin;

do $$
declare
  v_group uuid;
  v_max   int;
  v_novo  uuid;
  v_preso uuid;
  v_status public.lead_status;
  i int;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-74';
  select coalesce(roulette_max_rounds, 5) into v_max from public.automation_settings where id;

  -- 50 leads presos na bandeja, os mais antigos da base inteira.
  for i in 1..50 loop
    insert into public.leads
      (full_name, phone, distribution_group_id, status, roulette_misses, created_at)
    values (format('Lead Preso 74 #%s', i), format('1190074%s', 1000 + i), v_group,
            'queued', v_max, timestamptz '2000-01-01' + (i || ' seconds')::interval)
    returning id into v_preso;
  end loop;

  -- O 51º da ordem: novo na operação, velho no relógio, para caber na janela
  -- assim que os presos saírem dela.
  insert into public.leads
    (full_name, phone, distribution_group_id, status, created_at)
  values ('Lead Novo 74', '11900741999', v_group, 'queued', timestamptz '2000-01-02')
  returning id into v_novo;

  perform public.assign_queued_leads();

  select status into v_status from public.leads where id = v_novo;
  perform pg_temp.check74(v_status <> 'queued',
    'a varredura alcança o lead novo mesmo com 50 leads presos na bandeja à frente');

  select status into v_status from public.leads where id = v_preso;
  perform pg_temp.check74(v_status = 'queued',
    'o lead que estourou o teto continua na bandeja, não volta a circular');
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
