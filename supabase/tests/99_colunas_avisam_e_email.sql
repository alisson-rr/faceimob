-- =============================================================================
-- 0155 · Coluna da CCA avisa ou não o comercial; e-mail do movimento pela Brevo
--
-- O que este arquivo cobra:
--   1. toda coluna nasce avisando; o interruptor do e-mail nasce desligado; a
--      fila tem RLS e nenhuma função nova é executável por quem não deve;
--   2. coluna que avisa, interruptor desligado: aviso ao corretor e ao gerente,
--      nenhum e-mail na fila;
--   3. coluna de movimento interno: sem aviso e sem e-mail, com o histórico do
--      negócio; e coluna sem Status 2 não muda o Status 2 pelo "Mover", mesmo
--      quando o desfecho muda (antes caía no de-para por desfecho);
--   4. interruptor ligado: um e-mail por destinatário com e-mail válido — o
--      marcador `@sem-email.local` é pulado sem quebrar o movimento;
--   5. só admin lê a fila; corretor não; anon nem chega nela; ninguém escreve
--      pela API;
--   6. o cron expira o que passou de 24 h e não mexe no que esgotou tentativas;
--   7. com o interruptor desligado, o cron descarta o que ainda estava na fila.
--
-- Prefixo 99 e não 155: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`.
-- UUIDs na faixa `…-000001550001+`, exclusiva deste arquivo. Cada DO é uma
-- transação: o dedupe do aviso de devolução compara `created_at >= now()`.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check155(cond boolean, label text)
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

-- O negócio do cenário (criado no bloco "cenário").
create or replace function pg_temp.deal155()
returns uuid
language sql
as $$
  select d.id from public.deals d
    join public.developers v on v.id = d.developer_id
   where v.name = 'Construtora 155' and d.unit = '1550';
$$;

-- Move como o analista (papel `cca`), pelo token dele.
create or replace function pg_temp.move155(p_stage uuid, p_msg text)
returns void
language plpgsql
as $$
declare
  v_case uuid := (select id from public.cca_cases where deal_id = pg_temp.deal155());
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000001550004', 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case, p_stage, p_msg);
  reset role;
end;
$$;

\echo '== 0155: esquema, padrões e superfície =='

do $$
begin
  perform pg_temp.check155(
    not exists (select 1 from public.cca_stages where not notify_sales),
    'toda coluna existente continua avisando o comercial (padrão true)');
  perform pg_temp.check155(
    (select cca_move_email = false from public.automation_settings where id),
    'o e-mail das movimentações nasce desligado');
  perform pg_temp.check155(
    (select relrowsecurity from pg_class where oid = 'public.cca_move_emails'::regclass),
    'a fila tem RLS');
  perform pg_temp.check155(
    not has_function_privilege('anon', 'public.dispatch_pending_cca_emails()', 'execute')
    and not has_function_privilege('authenticated', 'public.dispatch_pending_cca_emails()', 'execute')
    and has_function_privilege('service_role', 'public.dispatch_pending_cca_emails()', 'execute')
    and not has_function_privilege('anon', 'public.move_cca_case(uuid,uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.move_cca_case(uuid,uuid,text)', 'execute'),
    'o gatilho do cron só pela service role; mover segue da tela logada');
  perform pg_temp.check155(
    not has_table_privilege('anon', 'public.cca_move_emails', 'select')
    and not has_table_privilege('authenticated', 'public.cca_move_emails', 'insert')
    and not has_table_privilege('authenticated', 'public.cca_move_emails', 'update')
    and not has_table_privilege('authenticated', 'public.cca_move_emails', 'delete'),
    'anon não chega na fila; a tela logada não escreve nela');
end
$$;

\echo '== 0155: cenário =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000001550001';
  ger  uuid := '00000000-0000-0000-0000-000001550002';
  cor  uuid := '00000000-0000-0000-0000-000001550003';
  ana  uuid := '00000000-0000-0000-0000-000001550004';
  v_team uuid;
  v_dev  uuid;
  v_lead uuid;
  v_deal public.deals;
begin
  -- O gerente fica sem e-mail: o perfil recebe o marcador `@sem-email.local`.
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@avisa155.test', '{"full_name":"Admin 155"}'),
    (ger, null,                '{"full_name":"Gerente 155"}'),
    (cor, 'cor@avisa155.test', '{"full_name":"Corretor 155"}'),
    (ana, 'ana@avisa155.test', '{"full_name":"Analista 155"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker'), (ana, 'cca')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe 155', ger) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);
  insert into public.developers (name, flow) values ('Construtora 155', 'internal') returning id into v_dev;

  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 155', '11955551550', 'in_progress', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '1550', 300000);
  perform set_config('request.jwt.claims', '', false);

  insert into public.deal_clients (deal_id, ordinal, full_name)
  values (v_deal.id, 1, 'Cliente <b>155</b>')
  on conflict (deal_id, ordinal) do update set full_name = excluded.full_name;

  -- Coluna que avisa e grava Status 2; coluna interna sem Status 2 e com outro
  -- desfecho — é a troca de desfecho que caía no de-para antigo.
  insert into public.cca_stages (id, name, color, position, status, active, deal_status_id, notify_sales) values
    ('00000000-0000-0000-0000-000001550010', 'Avisa 155', '#2563EB', 951, 'under_review', true,
     (select id from public.deal_statuses where value = '12. EM PROCESSAMENTO'), true),
    ('00000000-0000-0000-0000-000001550011', 'Interna 155', '#6366F1', 952, 'sent_to_agency', true,
     null, false);

  -- Entra em EM ANÁLISE: o primeiro movimento é que troca de coluna.
  insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
  values (v_deal.id, 'under_review',
          (select id from public.cca_stages where name = 'EM ANÁLISE' and active), now());
end
$$;

do $$
begin
  perform pg_temp.check155(
    exists (select 1 from public.deal_participants
             where deal_id = pg_temp.deal155() and role = 'broker'
               and profile_id = '00000000-0000-0000-0000-000001550003')
    and exists (select 1 from public.deal_participants
                 where deal_id = pg_temp.deal155() and role = 'manager'
                   and profile_id = '00000000-0000-0000-0000-000001550002'),
    'pré-condição: corretor e gerente participam do negócio');
end
$$;

\echo '== 0155: coluna que avisa, interruptor desligado =='

do $$
begin
  perform pg_temp.move155('00000000-0000-0000-0000-000001550010', 'Avisa sem e-mail 155');

  perform pg_temp.check155(
    (select count(distinct profile_id) from public.notifications
      where kind = 'cca_status_changed' and body like '%Avisa sem e-mail 155%'
        and profile_id in ('00000000-0000-0000-0000-000001550002', '00000000-0000-0000-0000-000001550003')) = 2,
    'corretor e gerente recebem o aviso, como antes');
  perform pg_temp.check155(
    not exists (select 1 from public.cca_move_emails where deal_id = pg_temp.deal155()),
    'desligado, nenhum e-mail entra na fila');
  perform pg_temp.check155(
    (select status_detail from public.deals where id = pg_temp.deal155()) = '12. EM PROCESSAMENTO',
    'a coluna com Status 2 grava o dela');
end
$$;

\echo '== 0155: movimento interno =='

do $$
declare
  v_avisos bigint;
begin
  update public.automation_settings set cca_move_email = true where id;

  select count(*) into v_avisos from public.notifications n
   where n.kind = 'cca_status_changed'
     and n.title like 'Crédito ' || (select code from public.deals where id = pg_temp.deal155()) || ':%'
     and n.profile_id in ('00000000-0000-0000-0000-000001550002', '00000000-0000-0000-0000-000001550003');

  perform pg_temp.move155('00000000-0000-0000-0000-000001550011', 'Conferência interna 155');

  perform pg_temp.check155(
    (select stage_id = '00000000-0000-0000-0000-000001550011' and status = 'sent_to_agency'
       from public.cca_cases where deal_id = pg_temp.deal155()),
    'o caso anda para a coluna interna');
  perform pg_temp.check155(
    exists (select 1 from public.deal_history
             where deal_id = pg_temp.deal155() and kind = 'comment'
               and to_value = 'STATUS: Interna 155 — Conferência interna 155'),
    'a mensagem fica no histórico do negócio');
  perform pg_temp.check155(
    not exists (select 1 from public.notifications where body like '%Conferência interna 155%'),
    'movimento interno não avisa ninguém com a mensagem');
  -- O aviso genérico (`notify_cca_status_changed`) nunca leva a mensagem no
  -- corpo: o que o denuncia é mais um `cca_status_changed` com o título do
  -- negócio. `v_avisos` foi contado antes do movimento.
  perform pg_temp.check155(
    (select count(*) from public.notifications n
      where n.kind = 'cca_status_changed'
        and n.title like 'Crédito ' || (select code from public.deals where id = pg_temp.deal155()) || ':%'
        and n.profile_id in ('00000000-0000-0000-0000-000001550002', '00000000-0000-0000-0000-000001550003')) = v_avisos,
    'nem o aviso genérico de status sai no movimento interno');
  perform pg_temp.check155(
    not exists (select 1 from public.cca_move_emails where deal_id = pg_temp.deal155()),
    'nem com o e-mail ligado');
  perform pg_temp.check155(
    (select status_detail from public.deals where id = pg_temp.deal155()) = '12. EM PROCESSAMENTO',
    format('coluna sem Status 2 não muda o Status 2, mesmo trocando o desfecho (veio %s)',
           (select status_detail from public.deals where id = pg_temp.deal155())));
end
$$;

\echo '== 0155: interruptor ligado =='

do $$
declare
  v_linha public.cca_move_emails;
begin
  perform pg_temp.move155('00000000-0000-0000-0000-000001550010', 'Aprovar <script>x</script>');

  perform pg_temp.check155(
    (select count(distinct profile_id) from public.notifications
      where kind = 'cca_status_changed' and body like '%Aprovar <script>%') = 2,
    'o aviso sai para os dois');
  perform pg_temp.check155(
    (select count(*) from public.cca_move_emails where deal_id = pg_temp.deal155()) = 1,
    'um e-mail só: o gerente sem e-mail é pulado e o movimento não quebra');

  select * into v_linha from public.cca_move_emails where deal_id = pg_temp.deal155();
  perform pg_temp.check155(
    v_linha.to_email = 'cor@avisa155.test'
    and v_linha.profile_id = '00000000-0000-0000-0000-000001550003'
    and v_linha.status = 'queued' and v_linha.attempts = 0
    and v_linha.stage_name = 'Avisa 155'
    and v_linha.actor_name = 'Analista 155'
    and v_linha.client_name = 'Cliente <b>155</b>'
    and v_linha.message = 'Aprovar <script>x</script>'
    and v_linha.deal_code = (select code from public.deals where id = pg_temp.deal155()),
    'a linha leva o corretor, a coluna, quem moveu, o cliente e a mensagem crua (quem escapa é a edge)');
end
$$;

\echo '== 0155: quem lê a fila =='

do $$
declare
  v_cor int;
  v_adm int;
  v_anon_negado boolean := false;
  v_insert_negado boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000001550003', 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_cor from public.cca_move_emails;
  begin
    insert into public.cca_move_emails (deal_id, to_email, stage_name, message)
    values (pg_temp.deal155(), 'x@y.test', 'Forjada', 'Forjada');
  exception when insufficient_privilege then
    v_insert_negado := true;
  end;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000001550001', 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_adm from public.cca_move_emails where deal_id = pg_temp.deal155();
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  set local role anon;
  begin
    perform 1 from public.cca_move_emails;
  exception when insufficient_privilege then
    v_anon_negado := true;
  end;
  reset role;

  perform pg_temp.check155(v_cor = 0, 'o corretor não lê a fila, nem o próprio e-mail');
  perform pg_temp.check155(v_insert_negado, 'o corretor não enfileira e-mail pela API');
  perform pg_temp.check155(v_adm = 1, 'o admin lê a fila');
  perform pg_temp.check155(v_anon_negado, 'anon não tem acesso à fila');
end
$$;

\echo '== 0155: o cron expira o velho =='

do $$
begin
  insert into public.cca_move_emails (id, deal_id, to_email, stage_name, message, status, attempts, created_at) values
    ('00000000-0000-0000-0000-000001550030', pg_temp.deal155(),
     'cor@avisa155.test', 'Velha 155', 'Velha', 'queued', 0, now() - interval '25 hours'),
    ('00000000-0000-0000-0000-000001550031', pg_temp.deal155(),
     'cor@avisa155.test', 'Esgotada 155', 'Esgotada', 'failed', 5, now() - interval '25 hours');

  -- Sem pg_net e sem cofre no harness: expira e para antes do HTTP.
  perform public.dispatch_pending_cca_emails();

  perform pg_temp.check155(
    (select status = 'expired' and last_error like '%24 h%'
       from public.cca_move_emails where id = '00000000-0000-0000-0000-000001550030'),
    'o que não saiu em 24 h vira expired, com o motivo');
  perform pg_temp.check155(
    (select status = 'failed' from public.cca_move_emails where id = '00000000-0000-0000-0000-000001550031'),
    'o que esgotou as tentativas segue failed');
  perform pg_temp.check155(
    (select status = 'queued' from public.cca_move_emails
      where deal_id = pg_temp.deal155() and stage_name = 'Avisa 155'),
    'o recente continua na fila');
end
$$;

\echo '== 0155: desligar descarta o pendente =='

do $$
begin
  -- Ligou sem credencial, a linha ficou na fila; o admin desliga. Sem isto ela
  -- sairia quando a credencial da Brevo chegasse, horas depois.
  update public.automation_settings set cca_move_email = false where id;

  perform public.dispatch_pending_cca_emails();

  perform pg_temp.check155(
    (select status = 'expired' and last_error like '%desligado%'
       from public.cca_move_emails
      where deal_id = pg_temp.deal155() and stage_name = 'Avisa 155'),
    'desligado, o que estava na fila vira expired, com o motivo');
  perform pg_temp.check155(
    (select status = 'failed' from public.cca_move_emails where id = '00000000-0000-0000-0000-000001550031'),
    'o que esgotou as tentativas segue failed, com o motivo dele');
end
$$;

-- Deixa o banco do harness como estava: interruptor desligado, colunas fora da tela.
update public.automation_settings set cca_move_email = false where id;
update public.cca_stages set active = false
 where id in ('00000000-0000-0000-0000-000001550010', '00000000-0000-0000-0000-000001550011');

\echo 'colunas que avisam e e-mail da CCA ok'
