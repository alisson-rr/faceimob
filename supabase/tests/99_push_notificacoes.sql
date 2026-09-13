-- =============================================================================
-- 99 · Notificações push (migrations 0143 e 0144)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`.
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. `push_category` classifica todo kind que os produtores gravam. Kind de
--      lead que caísse em 'outros' sairia DESLIGADO por padrão e o corretor
--      nunca veria o aviso no celular, sem erro nenhum.
--   2. Aparelho: o endpoint é para onde o servidor faz POST — só https de
--      serviço de push conhecido e chaves no tamanho certo; ninguém escreve
--      direto na tabela; outro usuário não lê nem apaga; o mesmo navegador que
--      troca de conta passa a ser de quem entrou; teto de 10 aparelhos;
--      preferência é só da própria pessoa.
--   3. `send_test_push` respeita 30 s por pessoa, mesmo apagando o aviso do sino;
--      o destinatário só escreve `read_at`; só a RPC grava `push_test`.
--   4. O gatilho não quebra o INSERT em notifications sem pg_net (o aviso de
--      lead faz parte da transação da roleta); acorda a edge só para quem tem
--      aparelho e categoria ligada, uma vez por comando; a reivindicação impede
--      o mesmo lote em dobro; 5 tentativas e 15 min encerram o push.
--   5. Atividade de lead feita por OUTRA pessoa avisa o dono; quem fez não é
--      avisado; sem sessão (importação) não avisa; lead que o autor não enxerga
--      não avisa o dono e o nome do cliente só vai para o dono; WhatsApp no
--      máximo 1 por lead a cada 10 min; a devolução do CCA não sai em dobro.
--   6. 0144: execução do agendador em andamento não é falha.
--   7. O job de nova tentativa está agendado.
--
-- UUIDs na faixa `…-000001430001+`, exclusiva deste arquivo. Não depende de seed.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check143(cond boolean, label text)
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

create or replace function pg_temp.assert_eq143(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % (obtido %, esperado %)', label, got, want;
  end if;
  raise notice '  ok  %', label;
end;
$$;

/** Assume a identidade de alguém logado, como o PostgREST faria; null = sem sessão. */
create or replace function pg_temp.become143(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    case when user_id is null then ''
         else json_build_object('sub', user_id::text, 'role', 'authenticated')::text
    end,
    true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário
-- -----------------------------------------------------------------------------
do $$
declare
  cor_a uuid := '00000000-0000-0000-0000-000001430001';
  cor_b uuid := '00000000-0000-0000-0000-000001430002';
  ger   uuid := '00000000-0000-0000-0000-000001430003';
  cca   uuid := '00000000-0000-0000-0000-000001430004';
  adm   uuid := '00000000-0000-0000-0000-000001430005';
  v_team uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor_a, 'corretor.a@f143.test', '{"full_name":"Corretor A 0143"}'),
    (cor_b, 'corretor.b@f143.test', '{"full_name":"Corretor B 0143"}'),
    (ger,   'gerente@f143.test',    '{"full_name":"Gerente 0143"}'),
    (cca,   'cca@f143.test',        '{"full_name":"Analista CCA 0143"}'),
    (adm,   'admin@f143.test',      '{"full_name":"Admin 0143"}')
  on conflict do nothing;

  -- `handle_new_auth_user` dá `broker` a todo mundo; gerente, CCA e admin
  -- precisam do papel exato.
  delete from public.user_roles where profile_id in (ger, cca, adm);
  insert into public.user_roles (profile_id, role) values
    (ger, 'manager'), (cca, 'cca'), (adm, 'admin')
  on conflict do nothing;

  -- O gerente enxerga o lead de A pela equipe: atividade e visita só usam lead
  -- que o autor enxerga (0143 §8). B fica fora da equipe de propósito.
  if not exists (select 1 from public.teams where name = 'Equipe 0143') then
    insert into public.teams (name, manager_id) values ('Equipe 0143', ger)
    returning id into v_team;
    insert into public.team_members (team_id, profile_id) values (v_team, cor_a);
  end if;
end
$$;

\echo '== 1. push_category classifica todo kind conhecido =='

do $$
declare
  -- Mapa da 0143. Kind novo entra aqui junto com a sua categoria.
  esperado constant jsonb := '{
    "lead_assigned": "lead_recebido",
    "lead_lost_timeout": "lead_prazo",
    "lead_no_response": "lead_prazo",
    "lead_unattended": "lead_prazo",
    "task_due": "lead_prazo",
    "lead_comment": "lead_atividade",
    "task_assigned": "lead_atividade",
    "visit_scheduled": "lead_atividade",
    "whatsapp_human_turn": "lead_atividade",
    "whatsapp_unmatched": "lead_atividade",
    "cca_pending": "credito",
    "cca_status_changed": "credito",
    "document_review_requested": "credito",
    "document_review_approved": "credito",
    "document_review_returned": "credito",
    "submission_failed": "credito",
    "push_test": "outros",
    "cron_failure": "outros",
    "outbound_expired": "outros",
    "game_paused": "outros",
    "public_link_expiring": "outros",
    "public_link_pin_rotated": "outros",
    "meta_sync_falhou": "outros",
    "meta_resumo_diario": "outros"
  }';
  v_kind       text;
  v_fora_mapa  text;
begin
  for v_kind in select jsonb_object_keys(esperado) loop
    perform pg_temp.assert_eq143(public.push_category(v_kind), esperado ->> v_kind,
      format('push_category(%s)', v_kind));
  end loop;

  -- Varredura dos produtores: literal sozinho numa linha terminada em vírgula,
  -- dentro de função que grava em notifications, é o kind. Medido na
  -- homologação em 12/09/2026: 16 literais, 16 kinds, nenhum falso positivo.
  -- Produtor novo com kind fora do mapa reprova aqui, antes de o aviso sair
  -- pela categoria errada.
  select string_agg(distinct m[1], ', ') into v_fora_mapa
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
         regexp_matches(p.prosrc, '^[ \t]*''([a-z]+(?:_[a-z]+)+)'',[ \t\r]*$', 'gn') m
   where n.nspname = 'public'
     and p.prosrc ~* 'insert\s+into\s+public\.notifications'
     and not esperado ? m[1];
  perform pg_temp.check143(v_fora_mapa is null,
    format('todo kind gravado pelos produtores está no mapa (fora dele: %s)', v_fora_mapa));

  perform pg_temp.assert_eq143(public.push_category('lead_kind_novo_0143'), 'lead_atividade',
    'kind novo de lead sem classificação não nasce em outros, que vem desligada');
  perform pg_temp.assert_eq143(public.push_category('document_review_novo_0143'), 'credito',
    'kind novo de conferência documental cai em crédito');
  perform pg_temp.assert_eq143(public.push_category('meta_alerta_novo_0143'), 'outros',
    'alerta de marketing cai em outros');
end
$$;

\echo '== 2. aparelho: validação na fronteira, RLS e troca de conta =='

do $$
declare
  cor_a uuid := '00000000-0000-0000-0000-000001430001';
  cor_b uuid := '00000000-0000-0000-0000-000001430002';
  p256  constant text := 'B' || repeat('A', 86);
  aut   constant text := repeat('A', 22);
  ep_a  constant text := 'https://fcm.googleapis.com/fcm/send/rls-0143-a';
  v_id             uuid;
  v_id_b           uuid;
  v_entrada        record;
  v_recusas        integer := 0;
  v_insert_barrado boolean := false;
  v_update_barrado boolean := false;
  v_pref_barrada   boolean := false;
  v_a_ve           bigint;
  v_b_ve           bigint;
  v_b_apagou       bigint;
  v_b_ve_pref      bigint;
begin
  perform pg_temp.become143(cor_a);
  set local role authenticated;

  v_id := public.register_push_subscription(ep_a, p256, aut, 'Chrome 0143');

  for v_entrada in
    select * from (values
      ('http://fcm.googleapis.com/fcm/send/x',             p256,                    aut),
      ('https://evil.example.com/fcm/send/x',              p256,                    aut),
      ('https://fcm.googleapis.com.evil.example/x',        p256,                    aut),
      ('https://fcm.googleapis.com@evil.example/x',        p256,                    aut),
      ('https://fcm.googleapis.com:8443/fcm/send/x',       p256,                    aut),
      ('https://push.apple.com.evil.example/x',            p256,                    aut),
      ('https://fcm.googleapis.com/fcm/send/ x',           p256,                    aut),
      ('https://fcm.googleapis.com/' || repeat('x', 2050), p256,                    aut),
      ('https://fcm.googleapis.com/fcm/send/y',            left(p256, 86),          aut),
      ('https://fcm.googleapis.com/fcm/send/y',            'A' || repeat('A', 86),  aut),
      ('https://fcm.googleapis.com/fcm/send/y',            p256 || '=',             aut),
      ('https://fcm.googleapis.com/fcm/send/y',            p256,                    left(aut, 21)),
      ('https://fcm.googleapis.com/fcm/send/y',            p256,                    left(aut, 21) || '=')
    ) as t(endpoint, chave, segredo)
  loop
    begin
      perform public.register_push_subscription(v_entrada.endpoint, v_entrada.chave, v_entrada.segredo);
    exception when sqlstate '22023' then
      v_recusas := v_recusas + 1;
    end;
  end loop;

  -- Os quatro serviços de push que os navegadores usam de fato.
  perform public.register_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/gAAAA-0143', p256, aut);
  perform public.register_push_subscription('https://web.push.apple.com/QO-0143', p256, aut);
  perform public.register_push_subscription('https://api.push.apple.com/3/device/0143', p256, aut);
  perform public.register_push_subscription('https://wns2-bl2p.notify.windows.com/w/?token=BQYAAA%2b0143', p256, aut);

  begin
    insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
    values (cor_a, 'https://evil.example.com/direto', p256, aut);
  exception when insufficient_privilege then
    v_insert_barrado := true;
  end;

  begin
    update public.push_subscriptions set endpoint = 'https://evil.example.com/trocado' where id = v_id;
  exception when insufficient_privilege then
    v_update_barrado := true;
  end;

  insert into public.push_preferences (profile_id, category, enabled) values (cor_a, 'lead_prazo', false);
  select count(*) into v_a_ve from public.push_subscriptions;
  reset role;

  perform pg_temp.become143(cor_b);
  set local role authenticated;
  select count(*) into v_b_ve from public.push_subscriptions where profile_id = cor_a;
  delete from public.push_subscriptions where id = v_id;
  get diagnostics v_b_apagou = row_count;
  perform public.unregister_push_subscription(ep_a);
  select count(*) into v_b_ve_pref from public.push_preferences where profile_id = cor_a;
  begin
    insert into public.push_preferences (profile_id, category, enabled) values (cor_a, 'outros', true);
  exception when insufficient_privilege then
    v_pref_barrada := true;
  end;
  reset role;
  perform pg_temp.become143(null);

  perform pg_temp.check143(v_id is not null, 'endpoint https do FCM com chaves no tamanho certo é aceito');
  perform pg_temp.assert_eq143(v_recusas, 13,
    'recusa http, host fora da lista, sufixo/usuário/porta enganosos, espaço, endpoint gigante e chaves fora do tamanho');
  perform pg_temp.assert_eq143(v_a_ve, 5::bigint,
    'Mozilla, Apple (web e subdomínio) e Windows também são aceitos, e o dono lê os próprios aparelhos');
  perform pg_temp.check143(
    (select profile_id = cor_a and user_agent = 'Chrome 0143' from public.push_subscriptions where id = v_id),
    'o aparelho fica amarrado a quem registrou, não a um id vindo do navegador');
  perform pg_temp.check143(v_insert_barrado, 'ninguém insere aparelho direto na tabela: só pela RPC que valida');
  perform pg_temp.check143(v_update_barrado, 'ninguém troca o endpoint validado por UPDATE direto');
  perform pg_temp.assert_eq143(v_b_ve, 0::bigint, 'outro usuário não lê o aparelho de ninguém');
  perform pg_temp.assert_eq143(v_b_apagou, 0::bigint, 'outro usuário não apaga o aparelho de ninguém');
  perform pg_temp.check143(
    exists (select 1 from public.push_subscriptions where id = v_id and profile_id = cor_a),
    'nem pelo DELETE direto nem pela RPC de logout: o aparelho de A continua lá');
  perform pg_temp.assert_eq143(v_b_ve_pref, 0::bigint, 'outro usuário não lê a preferência de ninguém');
  perform pg_temp.check143(v_pref_barrada, 'outro usuário não grava preferência em nome de ninguém');

  -- Mesmo navegador, outra conta: o aparelho passa a receber os avisos de quem
  -- entrou. Sem isto o corretor que saiu continuaria recebendo lead ali.
  update public.push_subscriptions set failures = 3 where id = v_id;
  perform pg_temp.become143(cor_b);
  v_id_b := public.register_push_subscription(ep_a, p256, aut, 'Chrome 0143 outra conta');
  perform pg_temp.become143(null);
  perform pg_temp.check143(
    v_id_b = v_id
    and (select profile_id = cor_b and failures = 0 from public.push_subscriptions where id = v_id),
    'o mesmo endpoint registrado por outra conta muda de dono e zera as falhas');

  -- Logout: a própria pessoa apaga o aparelho dela.
  perform pg_temp.become143(cor_a);
  set local role authenticated;
  perform public.unregister_push_subscription('https://web.push.apple.com/QO-0143');
  reset role;
  perform pg_temp.become143(null);
  perform pg_temp.check143(
    not exists (select 1 from public.push_subscriptions where endpoint = 'https://web.push.apple.com/QO-0143'),
    'no logout o dono tira o próprio aparelho');

  perform pg_temp.become143(cor_a);
  for i in 1..12 loop
    perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/teto-0143-' || i, p256, aut);
  end loop;
  perform pg_temp.become143(null);
  perform pg_temp.assert_eq143(
    (select count(*) from public.push_subscriptions where profile_id = cor_a), 10::bigint,
    'no máximo 10 aparelhos por pessoa');
  perform pg_temp.check143(
    exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/teto-0143-12'),
    'o teto nunca descarta o aparelho que acabou de ser registrado');

  delete from public.push_subscriptions where profile_id in (cor_a, cor_b);
  delete from public.push_preferences where profile_id in (cor_a, cor_b);
end
$$;

\echo '== 3. send_test_push respeita o intervalo; destinatário só escreve read_at =='

do $$
declare
  cor_a         uuid := '00000000-0000-0000-0000-000001430001';
  cor_b         uuid := '00000000-0000-0000-0000-000001430002';
  ger           uuid := '00000000-0000-0000-0000-000001430003';
  v_primeiro    uuid;
  v_segundo     uuid;
  v_conteudo    boolean;
  v_qtd         bigint;
  v_barrado     text;
  v_apos_apagar text;
  v_colunas     integer := 0;
  v_lidas       bigint;
  v_falso_teste boolean := false;
begin
  perform pg_temp.become143(cor_a);
  set local role authenticated;
  v_primeiro := public.send_test_push();
  begin
    perform public.send_test_push();
  exception when others then
    v_barrado := sqlerrm;
  end;
  select profile_id = cor_a and kind = 'push_test' and channel = 'in_app'
         and title = 'Notificações ativadas'
         and body = 'É assim que os avisos de lead chegam neste aparelho.'
         and link = '/leads'
    into v_conteudo
    from public.notifications where id = v_primeiro;
  select count(*) into v_qtd from public.notifications where kind = 'push_test';

  -- Reescrever a própria linha furava o intervalo e furava a fila de push.
  begin
    update public.notifications set created_at = now() - interval '1 hour' where id = v_primeiro;
  exception when insufficient_privilege then
    v_colunas := v_colunas + 1;
  end;
  begin
    update public.notifications set kind = 'lead_assigned' where id = v_primeiro;
  exception when insufficient_privilege then
    v_colunas := v_colunas + 1;
  end;
  begin
    update public.notifications set push_sent_at = null, push_attempts = 0, push_claimed_at = null
     where id = v_primeiro;
  exception when insufficient_privilege then
    v_colunas := v_colunas + 1;
  end;
  update public.notifications set read_at = now() where id = v_primeiro;
  get diagnostics v_lidas = row_count;

  -- Apagar o aviso de teste do sino não libera outro teste.
  delete from public.notifications where id = v_primeiro;
  begin
    perform public.send_test_push();
  exception when others then
    v_apos_apagar := sqlerrm;
  end;
  reset role;

  -- Gerente grava aviso manual (0012), mas não `push_test`, que ignora a preferência.
  perform pg_temp.become143(ger);
  set local role authenticated;
  begin
    insert into public.notifications (profile_id, kind, title, channel)
    values (cor_b, 'push_test', 'Falso teste 0143', 'in_app');
  exception when insufficient_privilege then
    v_falso_teste := true;
  end;
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_b, 'lead_comment', 'Aviso manual 0143', 'in_app');
  reset role;
  perform pg_temp.become143(null);

  perform pg_temp.check143(v_conteudo, 'o teste grava o aviso do contrato no sino de quem pediu');
  perform pg_temp.check143(v_barrado like '%30 segundos%',
    'segundo teste antes de 30 s é recusado com o motivo');
  perform pg_temp.assert_eq143(v_qtd, 1::bigint, 'o clique repetido não grava segundo aviso');
  perform pg_temp.assert_eq143(v_colunas, 3,
    'o destinatário não reescreve created_at, kind nem as colunas de push da própria linha');
  perform pg_temp.assert_eq143(v_lidas, 1::bigint, 'marcar como lida continua funcionando');
  perform pg_temp.check143(v_apos_apagar like '%30 segundos%',
    'apagar o aviso de teste do sino não libera outro teste antes de 30 s');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where profile_id = cor_a and kind = 'push_test'),
    'e a tentativa recusada não grava nada');
  perform pg_temp.check143(v_falso_teste,
    'gerente não grava push_test para outra pessoa: só a RPC grava esse kind');
  perform pg_temp.check143(
    exists (select 1 from public.notifications where profile_id = cor_b and title = 'Aviso manual 0143'),
    'o aviso manual do gerente continua permitido');

  update private.push_test_throttle set last_at = now() - interval '31 seconds' where profile_id = cor_a;
  perform pg_temp.become143(cor_a);
  v_segundo := public.send_test_push();
  perform pg_temp.become143(null);
  perform pg_temp.check143(v_segundo is not null and v_segundo <> v_primeiro,
    'passados 30 s o teste sai de novo');

  delete from public.notifications
   where profile_id in (cor_a, cor_b) and (kind = 'push_test' or title = 'Aviso manual 0143');
  delete from private.push_test_throttle where profile_id = cor_a;
end
$$;

\echo '== 4. gatilho e cron acordam a edge só quando há o que entregar =='

-- O aviso de lead faz parte da transação da roleta: sem pg_net (harness, projeto
-- novo antes da extensão) o INSERT não pode falhar.
do $$
declare
  cor_a      uuid := '00000000-0000-0000-0000-000001430001';
  v_id       uuid;
  v_renomeou boolean := false;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    if to_regclass('net.chamadas') is null then
      raise notice '  -- pg_net real instalado; ausência de pg_net não simulada aqui';
      return;
    end if;
    -- Dublê do 65: sai do caminho só dentro desta transação.
    alter function net.http_post(text, jsonb, jsonb, jsonb, integer) rename to http_post_fora_0143;
    v_renomeou := true;
  end if;

  perform pg_temp.become143(cor_a);
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/sem-pgnet-0143',
    'B' || repeat('A', 86), repeat('A', 22));
  perform pg_temp.become143(null);

  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_a, 'lead_assigned', 'Sem pg_net 0143', 'in_app')
  returning id into v_id;

  perform pg_temp.check143(v_id is not null,
    'sem pg_net, a notificação de quem tem aparelho continua sendo gravada');
  perform pg_temp.check143(public.push_kick() = false,
    'sem pg_net, acionar o push volta false em vez de erro');

  if v_renomeou then
    alter function net.http_post_fora_0143(text, jsonb, jsonb, jsonb, integer) rename to http_post;
  end if;
  delete from public.notifications where id = v_id;
  delete from public.push_subscriptions where profile_id = cor_a;
end
$$;

do $$
declare
  cor_a uuid := '00000000-0000-0000-0000-000001430001';
  cor_b uuid := '00000000-0000-0000-0000-000001430002';
begin
  if to_regclass('net.chamadas') is null then
    raise notice '  -- sem dublê de pg_net (o 65 o cria); chamadas à edge não verificadas aqui';
    return;
  end if;

  insert into private.integration_credentials (provider, label, secret) values
    ('supabase', 'functions_url',    'https://exemplo.invalid/functions/v1'),
    ('supabase', 'service_role_key', 'chave-de-teste')
  on conflict (provider, label) do update set secret = excluded.secret, active = true;

  perform pg_temp.become143(cor_a);
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/disparo-0143',
    'B' || repeat('A', 86), repeat('A', 22));
  perform pg_temp.become143(null);

  delete from net.chamadas;
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_a, 'lead_assigned', 'Novo lead 0143', 'in_app');
  perform pg_temp.check143(
    (select count(*) = 1 and bool_and(url = 'https://exemplo.invalid/functions/v1/push-dispatch') from net.chamadas),
    'lead novo de quem tem aparelho acorda a push-dispatch na hora');

  delete from net.chamadas;
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_b, 'lead_assigned', 'Sem aparelho 0143', 'in_app');
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 0::bigint,
    'quem não ativou push não acorda a edge');

  delete from net.chamadas;
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_a, 'lead_assigned', 'Fila de WhatsApp 0143', 'whatsapp');
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 0::bigint,
    'a linha da fila de WhatsApp não é push: o push viaja na in_app');

  delete from net.chamadas;
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_a, 'cron_failure', 'Outros 0143', 'in_app');
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 0::bigint,
    'categoria outros vem desligada');

  insert into public.push_preferences (profile_id, category, enabled) values (cor_a, 'lead_recebido', false);
  delete from net.chamadas;
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor_a, 'lead_assigned', 'Desligado 0143', 'in_app');
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 0::bigint,
    'categoria que a pessoa desligou não acorda a edge');

  insert into public.push_preferences (profile_id, category, enabled) values (cor_a, 'outros', false);
  delete from net.chamadas;
  perform pg_temp.become143(cor_a);
  perform public.send_test_push();
  perform pg_temp.become143(null);
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 1::bigint,
    'o teste de push sai mesmo com as categorias desligadas');

  delete from net.chamadas;
  insert into public.notifications (profile_id, kind, title, channel)
  select cor_a, 'task_due', 'Lote 0143 #' || g, 'in_app' from generate_series(1, 3) g;
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 1::bigint,
    'um comando com várias linhas acorda a edge uma vez só');

  delete from net.chamadas;
  perform pg_temp.check143(public.dispatch_pending_push(), 'o cron vê a pendência recente');
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 1::bigint,
    'e aciona a edge uma vez');

  -- Tudo reivindicado: nada pendente para o cron.
  perform count(*) from public.claim_push_batch(50);
  delete from net.chamadas;
  perform pg_temp.check143(not public.dispatch_pending_push(),
    'com o lote reivindicado o cron não chama a edge à toa');
  perform pg_temp.assert_eq143((select count(*) from net.chamadas), 0::bigint,
    'nenhuma requisição HTTP sem pendência');

  delete from public.notifications where profile_id in (cor_a, cor_b);
  delete from public.push_subscriptions where profile_id in (cor_a, cor_b);
  delete from public.push_preferences where profile_id in (cor_a, cor_b);
end
$$;

-- A reivindicação não depende do pg_net: roda em qualquer banco.
do $$
declare
  cor_a    uuid := '00000000-0000-0000-0000-000001430001';
  cor_b    uuid := '00000000-0000-0000-0000-000001430002';
  v_ids    uuid[];
  v_lote   bigint;
  v_cat_ok boolean;
  v_denovo bigint;
  v_vencida bigint;
  v_feitos  boolean;
begin
  perform pg_temp.become143(cor_a);
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/lote-0143',
    'B' || repeat('A', 86), repeat('A', 22));
  perform pg_temp.become143(null);
  insert into public.push_preferences (profile_id, category, enabled) values (cor_a, 'lead_recebido', false);

  insert into public.notifications (profile_id, kind, title, channel) values
    (cor_a, 'lead_assigned', 'Categoria desligada 0143', 'in_app'),
    (cor_a, 'push_test',     'Teste 0143',               'in_app'),
    (cor_a, 'task_due',      'Prazo 0143 #1',            'in_app'),
    (cor_a, 'task_due',      'Prazo 0143 #2',            'in_app'),
    (cor_a, 'lead_assigned', 'WhatsApp 0143',            'whatsapp'),
    (cor_b, 'task_due',      'Sem aparelho 0143',        'in_app');

  select count(*),
         array_agg(c.id),
         bool_and((c.kind = 'push_test' and c.category = 'outros')
               or (c.kind = 'task_due' and c.category = 'lead_prazo'))
    into v_lote, v_ids, v_cat_ok
    from public.claim_push_batch(50) c
   where c.profile_id in (cor_a, cor_b);

  perform pg_temp.assert_eq143(v_lote, 3::bigint,
    'o lote leva só o que deve sair: in_app, de quem tem aparelho, com categoria ligada (push_test ignora)');
  perform pg_temp.check143(v_cat_ok,
    'o lote devolve a categoria de cada aviso, que a edge usa para prazo e urgência');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications
                 where id = any(v_ids) and (push_attempts <> 1 or push_claimed_at is null)),
    'reivindicar marca a linha e conta a tentativa');

  select count(*) into v_denovo from public.claim_push_batch(50) c where c.profile_id = cor_a;
  perform pg_temp.assert_eq143(v_denovo, 0::bigint,
    'uma segunda execução ao mesmo tempo não pega o lote de novo: nada de aviso em dobro');

  -- A edge não solta a reivindicação na falha: o vencimento é o intervalo entre
  -- tentativas, e a nova tentativa leva junto os aparelhos já tratados.
  update public.notifications
     set push_claimed_at = now() - interval '3 minutes',
         push_done_subs  = array['00000000-0000-0000-0000-000001439999'::uuid]
   where id = any(v_ids);
  select count(*), bool_and(c.push_done_subs = array['00000000-0000-0000-0000-000001439999'::uuid])
    into v_vencida, v_feitos
    from public.claim_push_batch(50) c where c.profile_id = cor_a;
  perform pg_temp.assert_eq143(v_vencida, 3::bigint,
    'reivindicação vencida (falha de entrega ou edge que morreu no meio) volta a sair');
  perform pg_temp.check143(v_feitos,
    'a nova tentativa recebe os aparelhos já tratados, para a edge não repetir o aviso neles');

  update public.notifications set push_claimed_at = null, push_attempts = 5 where id = any(v_ids);
  perform pg_temp.check143(
    not exists (select 1 from public.push_pendentes(50) as x(id) where x.id = any(v_ids)),
    'na quinta tentativa o push desiste; o aviso continua no sino');

  update public.notifications set push_attempts = 0, created_at = now() - interval '16 minutes'
   where id = any(v_ids);
  perform pg_temp.check143(
    not exists (select 1 from public.push_pendentes(50) as x(id) where x.id = any(v_ids)),
    'aviso com mais de 15 min não sai por push: lead velho no celular é ruído');

  delete from public.notifications where profile_id in (cor_a, cor_b);
  delete from public.push_subscriptions where profile_id in (cor_a, cor_b);
  delete from public.push_preferences where profile_id in (cor_a, cor_b);
end
$$;

\echo '== 5. atividade de lead feita por outra pessoa avisa o dono =='

do $$
declare
  cor_a      uuid := '00000000-0000-0000-0000-000001430001';
  cor_b      uuid := '00000000-0000-0000-0000-000001430002';
  ger        uuid := '00000000-0000-0000-0000-000001430003';
  v_lead     uuid;
  v_perdido  uuid;
  v_assumido uuid;
  v_conv     uuid;
  v_link     text;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Push 0143', '11900143001', 'assigned', cor_a)
  returning id into v_lead;
  v_link := '/leads?lead=' || v_lead::text;

  -- Comentário
  perform pg_temp.become143(ger);
  insert into public.lead_comments (lead_id, author_id, body)
  values (v_lead, ger, 'Cliente pediu retorno amanhã cedo.');
  perform pg_temp.become143(cor_a);
  insert into public.lead_comments (lead_id, author_id, body)
  values (v_lead, cor_a, 'Anotação do próprio dono.');
  perform pg_temp.become143(null);
  insert into public.lead_comments (lead_id, author_id, body)
  values (v_lead, ger, 'Comentário vindo da importação.');

  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = cor_a and kind = 'lead_comment' and channel = 'in_app'
               and link = v_link and title like 'Comentário no seu lead:%'
               and body like '%comentou: Cliente pediu retorno amanhã cedo.'),
    'o dono do lead é avisado do comentário de outra pessoa, com o link do lead');
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications where profile_id = cor_a and kind = 'lead_comment'), 1::bigint,
    'comentário do próprio dono e comentário gravado sem sessão (importação) não viram aviso');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where profile_id = ger and kind = 'lead_comment'),
    'quem comentou não é avisado');

  -- Atividade
  perform pg_temp.become143(ger);
  insert into public.tasks (title, assigned_to, created_by, due_at, ref_type, ref_id)
  values ('Ligar para confirmar visita 0143', ger, ger, now() + interval '1 day', 'lead', v_lead);
  insert into public.tasks (title, assigned_to, created_by, ref_type, ref_id)
  values ('Enviar simulação 0143', cor_a, ger, 'lead', v_lead);
  perform pg_temp.become143(cor_a);
  insert into public.tasks (title, assigned_to, created_by, ref_type, ref_id)
  values ('Minha própria 0143', cor_a, cor_a, 'lead', v_lead);
  perform pg_temp.become143(null);

  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = cor_a and kind = 'task_assigned' and link = v_link
               and title = 'Atividade no seu lead: Ligar para confirmar visita 0143'
               and body like '% no lead Lead Push 0143, com prazo %'),
    'o dono do lead é avisado da atividade que outra pessoa criou no lead dele, com o nome do cliente');
  perform pg_temp.check143(
    (select count(*) = 1 and bool_and(title = 'Nova atividade para você: Enviar simulação 0143')
       from public.notifications
      where profile_id = cor_a and kind = 'task_assigned' and title like '%Enviar simulação 0143'),
    'responsável e dono do lead são a mesma pessoa: um aviso só');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where profile_id = ger and kind = 'task_assigned'),
    'quem criou a atividade não é avisado');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where title like '%Minha própria 0143'),
    'atividade que a pessoa cria para si mesma não vira aviso');

  -- O nome do cliente só vai para o dono do lead, e quem não enxerga o lead não
  -- o usa para avisar ninguém. Desde a 0146 a `tasks_write` já recusa atividade
  -- para quem o autor não enxerga; este bloco roda como dono das tabelas (sem
  -- RLS) de propósito, para provar a segunda trava, a do próprio gatilho.
  perform pg_temp.become143(ger);
  insert into public.tasks (title, assigned_to, created_by, ref_type, ref_id)
  values ('Apoio de colega 0143', cor_b, ger, 'lead', v_lead);
  perform pg_temp.become143(cor_b);
  insert into public.tasks (title, assigned_to, created_by, ref_type, ref_id)
  values ('Tarefa de fora 0143', ger, cor_b, 'lead', v_lead);
  perform pg_temp.become143(null);

  perform pg_temp.check143(
    (select count(*) = 1 and bool_and(body not like '%Lead Push 0143%')
       from public.notifications
      where profile_id = cor_b and title = 'Nova atividade para você: Apoio de colega 0143'),
    'o responsável que não é dono do lead recebe a atividade sem o nome do cliente');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where profile_id = cor_a and title like '%Tarefa de fora 0143'),
    'atividade apontada para um lead que o autor não enxerga não avisa o dono');
  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = ger and title = 'Nova atividade para você: Tarefa de fora 0143'
               and body not like '%Lead Push 0143%' and link = '/atividades'),
    'e o responsável recebe o aviso sem o nome nem o link do lead');

  -- Visita
  perform pg_temp.become143(ger);
  insert into public.visits (lead_id, broker_id, scheduled_at) values (v_lead, cor_a, now() + interval '2 days');
  insert into public.visits (lead_id, broker_id, scheduled_at) values (v_lead, ger, now() + interval '3 days');
  perform pg_temp.become143(cor_a);
  insert into public.visits (lead_id, broker_id, scheduled_at) values (v_lead, cor_a, now() + interval '4 days');
  perform pg_temp.become143(cor_b);
  insert into public.visits (lead_id, broker_id, scheduled_at) values (v_lead, cor_b, now() + interval '5 days');
  perform pg_temp.become143(null);

  perform pg_temp.check143(
    (select count(*) = 2
            and bool_or(title like 'Visita agendada para você:%')
            and bool_or(title like 'Visita no seu lead:%')
            and bool_and(link = v_link)
       from public.notifications where profile_id = cor_a and kind = 'visit_scheduled'),
    'visita agendada por outra pessoa avisa o corretor da visita e o dono do lead; a que ele mesmo agenda e a de quem não enxerga o lead, não');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where profile_id = ger and kind = 'visit_scheduled'),
    'quem agendou a visita não é avisado');

  -- WhatsApp do lead (o webhook grava com a service role: sem sessão)
  insert into public.sdr_conversations (lead_id, status, handed_off_at, handed_off_to)
  values (v_lead, 'handed_off', now(), cor_a)
  returning id into v_conv;

  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0143.1', '5511900143001', 'Oi, ainda tem unidade?', v_lead, v_conv, 'human_turn');
  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = cor_a and kind = 'whatsapp_human_turn' and link = v_link),
    'mensagem do lead no WhatsApp avisa o dono do lead');

  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0143.2', '5511900143001', 'Alô?', v_lead, v_conv, 'sdr_turn');
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications
      where profile_id = cor_a and kind = 'whatsapp_human_turn' and link = v_link), 1::bigint,
    'no máximo um aviso por lead a cada 10 min');

  update public.notifications set created_at = now() - interval '11 minutes'
   where profile_id = cor_a and kind = 'whatsapp_human_turn' and link = v_link;

  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome, detail, media_type)
  values ('wamid.0143.3', '5511900143001', '[áudio]', v_lead, v_conv, 'sdr_turn', 'áudio em processamento', 'audio');
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications
      where profile_id = cor_a and kind = 'whatsapp_human_turn' and link = v_link), 1::bigint,
    'a reserva do áudio ainda não é desfecho e não avisa');

  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0143.4', '5511900143001', 'Vou passar aí amanhã', v_lead, v_conv, 'sdr_turn');
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications
      where profile_id = cor_a and kind = 'whatsapp_human_turn' and link = v_link), 2::bigint,
    'passados 10 min a nova mensagem avisa de novo, mesmo com o robô respondendo');

  insert into public.leads (full_name, phone, status, assigned_to, lost_reason, lost_at)
  values ('Lead Perdido 0143', '11900143002', 'lost', cor_a, 'teste 0143', now())
  returning id into v_perdido;
  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, outcome)
  values ('wamid.0143.5', '5511900143002', 'Oi', v_perdido, 'sdr_turn');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where link = '/leads?lead=' || v_perdido::text),
    'lead perdido com dono antigo escrevendo não avisa ninguém');

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Assumido 0143', '11900143003', 'assigned', cor_a)
  returning id into v_assumido;
  insert into public.sdr_conversations (lead_id, status, assumed_by, assumed_at)
  values (v_assumido, 'human', cor_a, now())
  returning id into v_conv;
  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0143.6', '5511900143003', 'Pode me ligar?', v_assumido, v_conv, 'human_turn');
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications where profile_id = cor_a and body like '5511900143003%'), 1::bigint,
    'corretor que assumiu a conversa recebe o aviso de dono da conversa, e não um segundo de dono do lead');

  -- O aviso ao grupo de SDR/admin sai para perfis de outros arquivos de teste.
  delete from public.notifications where body like '55119001430%';
  delete from public.whatsapp_inbound_messages where provider_message_id like 'wamid.0143.%';
end
$$;

do $$
declare
  cor_a  uuid := '00000000-0000-0000-0000-000001430001';
  cca    uuid := '00000000-0000-0000-0000-000001430004';
  v_stg  uuid;
  v_dev  uuid;
  v_deal uuid;
  v_code text;
  v_case uuid;
begin
  select id into v_stg from public.pipeline_stages
   order by is_initial desc nulls last, position limit 1;
  if v_stg is null then
    raise notice '  -- pipeline sem estágio; aviso de crédito não verificado';
    return;
  end if;

  insert into public.developers (name, flow, submission_email)
  values ('Construtora 0143', 'external', 'construtora0143@exemplo.invalid')
  returning id into v_dev;
  insert into public.deals (developer_id, stage_id) values (v_dev, v_stg)
  returning id, code into v_deal, v_code;
  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, cor_a, 'broker', 100);
  insert into public.cca_cases (deal_id, status) values (v_deal, 'under_review')
  returning id into v_case;

  -- `cca_cases_decision_consistency`: aprovado ou reprovado exige `decided_at`,
  -- como a tela do CCA grava.
  perform pg_temp.become143(cca);
  update public.cca_cases set status = 'approved', decided_at = now() where id = v_case;
  perform pg_temp.become143(null);

  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = cor_a and kind = 'cca_status_changed' and link = '/pipeline'
               and title = 'Crédito ' || v_code || ': Aprovado'
               and body like '%de "Em análise" para "Aprovado".'),
    'o corretor do negócio é avisado da mudança de status do crédito, com os rótulos da tela');
  perform pg_temp.check143(
    not exists (select 1 from public.notifications where profile_id = cca and kind = 'cca_status_changed'),
    'quem mudou o status não é avisado');

  -- Devolução com a conferência aprovada: quem avisa é o gatilho da esteira.
  update public.deals set document_review_status = 'approved' where id = v_deal;
  perform pg_temp.become143(cca);
  update public.cca_cases set status = 'pending_documents' where id = v_case;
  perform pg_temp.become143(null);

  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = cor_a and kind = 'document_review_returned'
               and title = 'CCA devolveu o dossiê: ' || v_code),
    'a devolução do CCA avisa pelo gatilho da esteira');
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications where profile_id = cor_a and kind = 'cca_status_changed'), 1::bigint,
    'e o mesmo fato não sai num segundo aviso de mudança de status');

  update public.cca_cases set status = 'under_review' where id = v_case;
  perform pg_temp.assert_eq143(
    (select count(*) from public.notifications where profile_id = cor_a and kind = 'cca_status_changed'), 1::bigint,
    'mudança feita sem sessão (sistema, importação) não avisa');

  delete from public.notifications
   where profile_id in (select id from public.profiles where email::text like '%@f143.test')
      or (kind = 'cca_pending' and body like '%' || v_code || '%');
end
$$;

\echo '== 6. 0144: execução em andamento não é falha =='

do $$
declare
  adm     uuid := '00000000-0000-0000-0000-000001430005';
  v_jobid bigint;
begin
  if to_regclass('cron.job_run_details') is null then
    raise notice '  -- sem cron.job_run_details; aviso de falha não verificado';
    return;
  end if;

  select jobid into v_jobid from cron.job where jobname = 'faceimob-push-dispatch';
  if v_jobid is null then
    raise notice '  -- job faceimob-push-dispatch ausente; aviso de falha não verificado';
    return;
  end if;

  -- `runid` explícito: no pg_cron real quem não é dono não usa `runid_seq`, e o
  -- teste precisa rodar igual no harness e num banco Supabase.
  insert into cron.job_run_details (runid, jobid, status, start_time, return_message) values
    (-1430001, v_jobid, 'starting', now(),                       'em andamento 0143'),
    (-1430002, v_jobid, 'running',  now() - interval '1 minute', 'em andamento 0143');
  perform public.notify_cron_failures();
  perform pg_temp.check143(
    not exists (select 1 from public.notifications
                 where kind = 'cron_failure' and title = 'Automação com falha: faceimob-push-dispatch'),
    'execução em andamento não vira aviso de falha (os 12 avisos falsos de 12/09 às 21:15)');

  insert into cron.job_run_details (runid, jobid, status, start_time, return_message)
  values (-1430003, v_jobid, 'failed', now() - interval '2 minutes', 'erro simulado 0143');
  perform public.notify_cron_failures();
  perform pg_temp.check143(
    exists (select 1 from public.notifications
             where profile_id = adm and kind = 'cron_failure'
               and title = 'Automação com falha: faceimob-push-dispatch'
               and body like '1 execução(ões)%'),
    'execução terminada com falha continua avisando, e a contagem é só das falhas');

  delete from public.notifications
   where kind = 'cron_failure' and title = 'Automação com falha: faceimob-push-dispatch';
  delete from cron.job_run_details where return_message in ('em andamento 0143', 'erro simulado 0143');
end
$$;

\echo '== 7. o job de nova tentativa está agendado =='

do $$
declare
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  if to_regclass('cron.job') is null then
    raise notice '  -- sem cron.job; agendamento não verificado';
    return;
  end if;

  select j.schedule, j.command, j.active into v_schedule, v_command, v_active
    from cron.job j where j.jobname = 'faceimob-push-dispatch';
  perform pg_temp.assert_eq143(v_schedule, '* * * * *', 'faceimob-push-dispatch roda a cada minuto');
  perform pg_temp.check143(v_command like '%dispatch_pending_push()%',
    'o job chama dispatch_pending_push(), que só faz HTTP com pendência');
  perform pg_temp.check143(v_active, 'faceimob-push-dispatch está ativo');
end
$$;

\echo '0143 ok'
