-- =============================================================================
-- 0056 · Roleta, trava e escrita no lead
--
-- A roleta é o coração da operação: `assign_lead` e `claim_lead` decidem quem
-- atende, quem pontua e quem é bloqueado no check-in. O que este arquivo cobra:
--
--   1. `assign_lead` decide o dia operacional por `current_work_date()`, nunca
--      por `current_date` (o banco roda em UTC; o turno da noite passa da
--      virada).
--   2. Lead vencido não volta primeiro para quem o deixou vencer — e, com um
--      único corretor na fila, volta no máximo 3 vezes antes de ficar parado.
--   3. `claim_lead` faz nascer a próxima ação quando não há nenhuma: é ela que
--      alimenta `overdue_lead_count` e o bloqueio dos 20.
--   4. Comentar e anexar exigem `can_write_lead` (dono/gestor/admin), não
--      `can_see_lead` — sócio que enxerga o lead não escreve nele.
--   5. `existing_lead_phones` só responde a quem pode criar lead.
--
-- Não depende de seed.sql: o cenário cria grupo, turno e presenças próprios.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check56(cond boolean, label text)
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
  adm  uuid := '00000000-0000-0000-0000-000000560001';
  ger  uuid := '00000000-0000-0000-0000-000000560002';
  cora uuid := '00000000-0000-0000-0000-000000560003';
  corb uuid := '00000000-0000-0000-0000-000000560004';
  soc  uuid := '00000000-0000-0000-0000-000000560005';
  v_group uuid;
  v_shift uuid;
  v_team  uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@roleta56.test',  '{"full_name":"Admin 56"}'),
    (ger,  'ger@roleta56.test',  '{"full_name":"Gerente 56"}'),
    (cora, 'cora@roleta56.test', '{"full_name":"Corretor A 56"}'),
    (corb, 'corb@roleta56.test', '{"full_name":"Corretor B 56"}'),
    (soc,  'soc@roleta56.test',  '{"full_name":"Socio 56"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cora, 'broker'), (corb, 'broker'), (soc, 'partner')
  on conflict do nothing;

  -- O gerente lidera a equipe do corretor A: é o que faz `manages_profile(A)`
  -- responder verdadeiro, e com isso `can_write_lead` liberar o gestor.
  insert into public.teams (name, manager_id) values ('Equipe 56', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cora);

  insert into public.distribution_groups (name, slug, kind, active)
  values ('Roleta 56', 'roleta-56', 'specific', true)
  returning id into v_group;

  insert into public.distribution_group_members (group_id, profile_id, active)
  values (v_group, cora, true), (v_group, corb, true);

  -- Turno que cobre o dia inteiro: o teste não pode depender da hora do relógio.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('teste-56', 'Integral 56', '00:00', '00:00', '23:59', -56)
  returning id into v_shift;

  insert into public.checkins (profile_id, shift_id, work_date) values
    (cora, v_shift, public.current_work_date()),
    (corb, v_shift, public.current_work_date());
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. assign_lead decide o dia operacional por current_work_date =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.assign_lead(uuid, boolean)'::regprocedure);
begin
  perform pg_temp.check56(v_def not like '%current_date%',
    'assign_lead não usa current_date (UTC) para achar a presença do turno');
  perform pg_temp.check56(v_def like '%current_work_date%',
    'assign_lead incrementa leads_received pelo dia operacional de São Paulo');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. lead vencido não volta primeiro para quem o deixou vencer =='
-- -----------------------------------------------------------------------------
do $$
declare
  cora uuid := '00000000-0000-0000-0000-000000560003';
  corb uuid := '00000000-0000-0000-0000-000000560004';
  v_group uuid;
  v_lead  uuid;
  v_um    uuid;
  v_dois  uuid;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-56';

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Rodizio 56', '11900560001', v_group)
  returning id into v_lead;

  v_um := public.assign_lead(v_lead);
  perform pg_temp.check56(v_um in (cora, corb), 'o lead foi para alguém da fila');

  -- Prazo estourado: é o que `release_expired_leads` faz antes de reatribuir.
  update public.lead_assignments
     set released_at = now(), release_reason = 'timeout'
   where lead_id = v_lead and released_at is null;
  update public.leads
     set status = 'queued', assigned_to = null, assigned_at = null, attend_deadline = null
   where id = v_lead;

  v_dois := public.assign_lead(v_lead);
  perform pg_temp.check56(v_dois is not null, 'o lead vencido volta para a roleta');
  perform pg_temp.check56(v_dois <> v_um,
    'quem deixou o prazo vencer não recebe o mesmo lead de volta na sequência');

  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2b. com um corretor só, o lead volta no máximo 3 vezes =='
-- -----------------------------------------------------------------------------
do $$
declare
  cora uuid := '00000000-0000-0000-0000-000000560003';
  corb uuid := '00000000-0000-0000-0000-000000560004';
  v_group uuid;
  v_lead  uuid;
  v_alvo  uuid;
  v_status public.lead_status;
  i int;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-56';

  -- B sai do turno: sobra um único elegível, que é o cenário do laço.
  update public.checkins set checked_out_at = now() where profile_id = corb;

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Preso 56', '11900560002', v_group)
  returning id into v_lead;

  perform pg_temp.check56(public.assign_lead(v_lead) = cora,
    'com um só na fila, o lead vai para ele');

  -- Três prazos estourados seguidos. Do quarto em diante o lead fica parado.
  for i in 1..3 loop
    update public.lead_assignments
       set released_at = now(), release_reason = 'timeout'
     where lead_id = v_lead and released_at is null;
    update public.leads
       set status = 'queued', assigned_to = null, assigned_at = null, attend_deadline = null
     where id = v_lead;
    v_alvo := public.assign_lead(v_lead);
    if i < 3 then
      perform pg_temp.check56(v_alvo = cora,
        format('reentrega %s/3 continua permitida com fila de um', i));
    end if;
  end loop;

  select status into v_status from public.leads where id = v_lead;
  perform pg_temp.check56(v_alvo is null,
    'depois de 3 prazos vencidos o mesmo lead não é reentregue em laço');
  perform pg_temp.check56(v_status = 'queued',
    'o lead preso fica na fila, visível no card de saúde da roleta');

  -- A VÁLVULA. Sem ela o lead que bateu o teto não tinha saída nenhuma: o cron
  -- falhava a cada minuto e o botão "Distribuir" caía no mesmo teto, sobrando
  -- só `reassign_lead`, que fura o rodízio. `p_force` é do gestor, não do cron.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000560002'::text, 'role', 'authenticated')::text,
    false);
  perform pg_temp.check56(public.distribute_queued_lead(v_lead) = cora,
    'o lead que bateu o teto de reentregas ainda é distribuível à mão pelo gestor');
  perform set_config('request.jwt.claims', '', false);

  delete from public.leads where id = v_lead;
  update public.checkins set checked_out_at = null where profile_id = corb;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2d. distribuição pausada recusa dizendo que está pausada =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger uuid := '00000000-0000-0000-0000-000000560002';
  v_group uuid;
  v_lead  uuid;
  v_msg   text := '';
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-56';

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Pausado 56', '11900560008', v_group)
  returning id into v_lead;

  update public.automation_settings set leads_paused = true where id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  begin
    perform public.distribute_queued_lead(v_lead);
  exception when raise_exception then
    v_msg := sqlerrm;
  end;

  -- A tela repete esta frase: dizer "ninguém com check-in aberto" enquanto a
  -- roleta está pausada em Admin manda o gestor procurar o problema errado.
  perform pg_temp.check56(v_msg ilike '%pausada%',
    'com a distribuição pausada, a recusa diz que está pausada');

  update public.automation_settings set leads_paused = false where id;
  perform set_config('request.jwt.claims', '', false);
  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2e. lead sem grupo recusa dizendo que falta grupo =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger uuid := '00000000-0000-0000-0000-000000560002';
  v_lead uuid;
  v_msg  text := '';
  v_geral uuid;
begin
  -- Sem grupo no lead e sem fila geral ativa: é o segundo null silencioso de
  -- `assign_lead`, que a tela também anunciava como "ninguém em check-in".
  select id into v_geral from public.distribution_groups where kind = 'general' and active limit 1;
  if v_geral is not null then
    update public.distribution_groups set active = false where id = v_geral;
  end if;

  insert into public.leads (full_name, phone) values ('Lead Sem Grupo 56', '11900560009')
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  begin
    perform public.distribute_queued_lead(v_lead);
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  perform pg_temp.check56(v_msg ilike '%grupo%',
    'lead sem grupo e sem fila geral ativa recusa dizendo que falta grupo');

  perform set_config('request.jwt.claims', '', false);
  delete from public.leads where id = v_lead;
  if v_geral is not null then
    update public.distribution_groups set active = true where id = v_geral;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2c. distribuir à mão respeita a fila e a permissão =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger  uuid := '00000000-0000-0000-0000-000000560002';
  cora uuid := '00000000-0000-0000-0000-000000560003';
  v_group uuid;
  v_lead  uuid;
  v_alvo  uuid;
  v_recusou boolean;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-56';

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Manual 56', '11900560007', v_group)
  returning id into v_lead;

  -- Corretor não distribui: `leads.view_queue` é de gerente, diretor,
  -- marketing e admin — o mesmo código que deixa enxergar lead sem dono.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  begin
    perform public.distribute_queued_lead(v_lead);
    raise exception 'FALHOU: corretor conseguiu disparar a distribuição';
  exception when insufficient_privilege then
    raise notice '  ok  distribuir à mão exige leads.view_queue';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  v_alvo := public.distribute_queued_lead(v_lead);
  perform pg_temp.check56(v_alvo in (cora, '00000000-0000-0000-0000-000000560004'::uuid),
    'o gestor empurra o lead para a roleta, e quem recebe é o primeiro da fila');

  -- Lead que já saiu da fila não é redistribuído por engano. A flag existe
  -- porque `raise_exception` é o mesmo código do `raise` deste teste: um
  -- `raise` dentro do bloco cairia no próprio handler e passaria de mentira.
  v_recusou := false;
  begin
    perform public.distribute_queued_lead(v_lead);
  exception when raise_exception then
    v_recusou := true;
  end;
  perform pg_temp.check56(v_recusou, 'lead fora da fila não é redistribuído');

  perform set_config('request.jwt.claims', '', false);
  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. Atender faz nascer a próxima ação =='
-- -----------------------------------------------------------------------------
do $$
declare
  cora uuid := '00000000-0000-0000-0000-000000560003';
  v_lead  uuid;
  v_marcado uuid;
  v_next  timestamptz;
  v_horas int;
  v_futuro timestamptz := now() + interval '10 days';
begin
  select s.no_response_hours into v_horas from public.automation_settings s where s.id;

  insert into public.leads (full_name, phone, status, assigned_to, attend_deadline, next_action_at)
  values ('Lead Sem Proxima Acao 56', '11900560003', 'assigned', cora, now() + interval '5 minutes', null)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.claim_lead(v_lead);
  reset role;

  select next_action_at into v_next from public.leads where id = v_lead;
  perform pg_temp.check56(v_next is not null,
    'Atender sem próxima ação definida faz nascer uma — é ela que sustenta o bloqueio dos 20');
  perform pg_temp.check56(
    v_next between now() + make_interval(hours => coalesce(v_horas, 24)) - interval '2 minutes'
              and now() + make_interval(hours => coalesce(v_horas, 24)) + interval '2 minutes',
    'a próxima ação padrão é o prazo de "sem resposta" configurado na automação');

  -- Quem já marcou a próxima ação não é sobrescrito.
  insert into public.leads (full_name, phone, status, assigned_to, attend_deadline, next_action_at)
  values ('Lead Com Proxima Acao 56', '11900560004', 'assigned', cora, now() + interval '5 minutes', v_futuro)
  returning id into v_marcado;

  set local role authenticated;
  perform public.claim_lead(v_marcado);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select next_action_at into v_next from public.leads where id = v_marcado;
  perform pg_temp.check56(v_next = v_futuro,
    'a próxima ação já marcada pelo corretor é preservada');

  delete from public.leads where id in (v_lead, v_marcado);
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3b. concluir a tarefa não apaga a próxima ação do lead =='
-- -----------------------------------------------------------------------------
do $$
declare
  cora uuid := '00000000-0000-0000-0000-000000560003';
  v_lead uuid;
  v_task uuid;
  v_due  timestamptz := date_trunc('minute', now() + interval '3 days');
  v_next timestamptz;
begin
  -- O gatilho `tasks_sync_lead_deadline` (0011) tinha o mesmo campo que
  -- `claim_lead` e o diálogo da tela — e o zerava quando não sobrava tarefa
  -- aberta. Bastava o corretor criar e concluir uma tarefa para o lead sair da
  -- conta de atrasados e o bloqueio dos 20 virar opcional de novo.
  insert into public.leads (full_name, phone, status, assigned_to, next_action_at)
  values ('Lead Prazo Manual 56', '11900560010', 'attending', cora, now() + interval '1 day')
  returning id into v_lead;

  insert into public.tasks (title, assigned_to, due_at, ref_type, ref_id)
  values ('Ligar para o cliente', cora, v_due, 'lead', v_lead)
  returning id into v_task;

  select next_action_at into v_next from public.leads where id = v_lead;
  perform pg_temp.check56(v_next = v_due,
    'tarefa aberta com data manda na próxima ação do lead');

  update public.tasks set status = 'done', completed_at = now() where id = v_task;

  select next_action_at into v_next from public.leads where id = v_lead;
  perform pg_temp.check56(v_next is not null,
    'concluir a última tarefa não apaga a próxima ação — o lead continua cobrando retorno');

  delete from public.tasks where id = v_task;
  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. escrever no lead exige dono, gestor ou admin =='
-- -----------------------------------------------------------------------------
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000560001';
  ger  uuid := '00000000-0000-0000-0000-000000560002';
  cora uuid := '00000000-0000-0000-0000-000000560003';
  corb uuid := '00000000-0000-0000-0000-000000560004';
  soc  uuid := '00000000-0000-0000-0000-000000560005';
  v_lead uuid;
  v_pode boolean;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Escrita 56', '11900560005', 'attending', cora)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check56(public.can_write_lead(v_lead), 'o dono do lead escreve nele');

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check56(public.can_write_lead(v_lead), 'o gestor do dono escreve no lead');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check56(public.can_write_lead(v_lead), 'o admin escreve em qualquer lead');

  perform set_config('request.jwt.claims',
    json_build_object('sub', corb::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check56(not public.can_write_lead(v_lead),
    'corretor de fora não escreve no lead de outro');

  -- O sócio ENXERGA o lead (`can_see_lead`) e é justamente isso que a policy de
  -- insert usava antes: leitura liberando escrita.
  perform set_config('request.jwt.claims',
    json_build_object('sub', soc::text, 'role', 'authenticated')::text, false);
  perform pg_temp.check56(public.can_see_lead(v_lead), 'cenário: o sócio enxerga o lead');
  perform pg_temp.check56(not public.can_write_lead(v_lead), 'o sócio não escreve no lead alheio');

  begin
    set local role authenticated;
    insert into public.lead_comments (lead_id, author_id, body)
    values (v_lead, soc, 'comentário do sócio');
    reset role;
    raise exception 'FALHOU: a policy deixou o sócio comentar em lead alheio';
  exception when insufficient_privilege then
    reset role;
    raise notice '  ok  lead_comments recusa comentário de quem não escreve no lead';
  end;

  begin
    set local role authenticated;
    insert into public.lead_attachments (lead_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_lead, format('%s/x.pdf', v_lead), 'x.pdf', 'x.pdf', soc);
    reset role;
    raise exception 'FALHOU: a policy deixou o sócio anexar em lead alheio';
  exception when insufficient_privilege then
    reset role;
    raise notice '  ok  lead_attachments recusa anexo de quem não escreve no lead';
  end;

  -- Contraprova: o dono continua comentando.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.lead_comments (lead_id, author_id, body)
  values (v_lead, cora, 'comentário do dono');
  reset role;

  select exists (select 1 from public.lead_comments where lead_id = v_lead and author_id = cora)
    into v_pode;
  perform pg_temp.check56(v_pode, 'o dono do lead continua comentando');

  perform set_config('request.jwt.claims', '', false);
  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 5. existing_lead_phones só responde a quem pode criar lead =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger  uuid := '00000000-0000-0000-0000-000000560002';
  cora uuid := '00000000-0000-0000-0000-000000560003';
  v_lead uuid;
  v_hit  int;
begin
  -- Gravado com máscara: o gatilho de `leads` normaliza para E.164 com DDI
  -- (`5511900560006`), e é por isso que a comparação não pode ser dígito a
  -- dígito com o que veio da planilha.
  insert into public.leads (full_name, phone)
  values ('Lead Duplicado 56', '(11) 90056-0006')
  returning id into v_lead;

  perform pg_temp.check56(
    (select phone from public.leads where id = v_lead) = '5511900560006',
    'cenário: o telefone do lead é gravado normalizado, com DDI');

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);

  -- Por pertinência, não por contagem: o catálogo do seed tem telefones
  -- próprios, e contar linhas amarraria o teste ao que já existe no banco.
  select count(*)::int into v_hit
  from public.existing_lead_phones(array['11900560006', '19000000056'])
  where phone_digits = '11900560006';
  perform pg_temp.check56(v_hit = 1,
    'o telefone já cadastrado é devolvido, mesmo tendo sido gravado com máscara');

  perform pg_temp.check56(
    not exists (select 1 from public.existing_lead_phones(array['19000000056'])),
    'telefone que não existe não vira duplicata');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cora::text, 'role', 'authenticated')::text, false);
  begin
    perform * from public.existing_lead_phones(array['11900560006']);
    raise exception 'FALHOU: corretor conseguiu sondar telefones de lead';
  exception when insufficient_privilege then
    raise notice '  ok  quem não importa lead não sonda telefone';
  end;

  perform set_config('request.jwt.claims', '', false);
  delete from public.leads where id = v_lead;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 6. as policies de insert olham a escrita, não a leitura =='
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check56(
    (select count(*) from pg_policies
      where schemaname = 'public'
        and policyname in ('lead_comments_insert', 'lead_attachments_insert')
        and with_check like '%can_write_lead%') = 2,
    'lead_comments_insert e lead_attachments_insert exigem can_write_lead');
end
$$;

-- -----------------------------------------------------------------------------
-- Limpeza: o turno "Integral 56" cobre o dia inteiro e ganharia de `current_shift`
-- para qualquer teste posterior. As presenças saem junto.
-- -----------------------------------------------------------------------------
do $$
begin
  delete from public.checkins
   where shift_id in (select id from public.work_shifts where code = 'teste-56');
  update public.work_shifts set active = false where code = 'teste-56';
end
$$;

\echo 'roleta, trava e escrita no lead ok'
