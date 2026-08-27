-- =============================================================================
-- Regressão da 0033 e da 0034 — o link público não nasce mais adivinhável nem
-- aberto, e o lockout vale nos TRÊS caminhos, não só nos dois de leitura.
--
-- Quatro defeitos:
--   S02  slug derivado do nome do diretor/equipe = URL adivinhável;
--   S02  link de diretoria nascia sem PIN, e a RPC só pede PIN quando há hash;
--   S05  PIN de 6 dígitos sem lockout = 10^6 varridos por script em minutos;
--   S05  (resto, 0034) o caminho de ESCRITA sinalizava PIN errado com exceção; o
--        rollback do PostgREST apagava o contador que o resolvedor tinha acabado
--        de incrementar, e o mesmo script varria os 10^6 sem nunca travar.
--
-- O bloco 5 é o contrato que NÃO podia mudar: link antigo, com slug legível e
-- sem PIN, continua abrindo. Invalidar em massa derrubaria o Diário de todas as
-- equipes numa manhã.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check11(cond boolean, label text)
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
-- Fixtures próprias. UUIDs no espaço f0* para não colidir com os outros testes.
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000f1';
  dir uuid := '00000000-0000-0000-0000-0000000000f2';
  cor uuid := '00000000-0000-0000-0000-0000000000fa';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@link.test', '{"full_name":"Admin Link"}'),
    (dir, 'dir@link.test', '{"full_name":"Dirce Blindagem"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (dir, 'director')
  on conflict do nothing;

  -- Três equipes porque `create_public_link` é idempotente por (tipo, dono):
  -- pedir link duas vezes para a mesma equipe devolve o mesmo link, e cada
  -- bloco abaixo precisa de um link em estado limpo.
  insert into public.teams (id, name, slug, director_id)
  values
    ('f0000000-0000-0000-0000-000000000001', 'Equipe Blindagem',     'equipe-blindagem',     dir),
    ('f0000000-0000-0000-0000-000000000002', 'Equipe Blindagem II',  'equipe-blindagem-ii',  dir),
    ('f0000000-0000-0000-0000-000000000003', 'Equipe Blindagem III', 'equipe-blindagem-iii', dir),
    ('f0000000-0000-0000-0000-000000000004', 'Equipe Envio',         'equipe-envio',         dir),
    ('f0000000-0000-0000-0000-000000000005', 'Equipe Envio II',      'equipe-envio-ii',      dir)
  on conflict (id) do nothing;

  -- Corretor próprio (a equipe 4 é a única que precisa de gente: o bloco 6c
  -- testa o caminho feliz do lançamento, e sem membro `saved` seria sempre 0 e
  -- o teste passaria verde sem gravar nada). Perfil dedicado porque
  -- `team_members_one_active` só admite uma equipe ativa por corretor — reusar
  -- um perfil de outro arquivo de teste amarraria os dois.
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@link.test', '{"full_name":"Corretor Envio"}')
  on conflict do nothing;

  insert into public.team_members (team_id, profile_id)
  values ('f0000000-0000-0000-0000-000000000004', cor)
  on conflict do nothing;
end
$$;

\echo '== 1. slug sorteado, nunca derivado do nome =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  dir  uuid := '00000000-0000-0000-0000-0000000000f2';
  team uuid := 'f0000000-0000-0000-0000-000000000001';
  v_slug text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  v_slug := public.create_public_link('daily_team', '654321', team, null) ->> 'slug';

  perform pg_temp.check11(v_slug ~ '^[0-9a-f]{32}$',
    format('slug do link de equipe é um uuid sem hífen (%s)', v_slug));
  perform pg_temp.check11(v_slug !~* 'blindagem' and v_slug !~* 'equipe',
    'slug do link de equipe não carrega o nome da equipe');

  v_slug := public.create_public_link('director_checkpoint', '654321', null, dir) ->> 'slug';

  perform pg_temp.check11(v_slug ~ '^[0-9a-f]{32}$',
    format('slug do link de diretoria é um uuid sem hífen (%s)', v_slug));
  perform pg_temp.check11(v_slug !~* 'dirce' and v_slug !~* 'diretor',
    'slug do link de diretoria não carrega o nome do diretor');

  -- Mesmo um insert direto (psql de suporte, seed) cai no default sorteado.
  perform pg_temp.check11(
    (select pg_get_expr(d.adbin, d.adrelid)
       from pg_attrdef d
       join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'public.public_links'::regclass and a.attname = 'slug')
    like '%gen_random_uuid%',
    'a coluna slug tem default sorteado');
end
$$;

\echo '== 2. link novo não nasce sem PIN =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  dir  uuid := '00000000-0000-0000-0000-0000000000f2';
  team uuid := 'f0000000-0000-0000-0000-000000000001';
  v_recusou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  v_recusou := false;
  begin
    perform public.create_public_link('director_checkpoint', null, null, dir);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check11(v_recusou, 'link de diretoria sem PIN é recusado');

  v_recusou := false;
  begin
    perform public.create_public_link('director_checkpoint', '   ', null, dir);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check11(v_recusou, 'PIN só de espaços é recusado');

  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', '12', team, null);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check11(v_recusou, 'PIN curto demais é recusado');

  -- A regra vale para os dois tipos: o link de equipe também expõe operação.
  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', null, team, null);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check11(v_recusou, 'link de equipe sem PIN é recusado');

  -- Papel sem direito não cria link nem com PIN.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000000ff', 'role', 'authenticated')::text, false);
  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', '654321', team, null);
  exception when sqlstate '42501' then v_recusou := true;
  end;
  perform pg_temp.check11(v_recusou, 'quem não é admin/diretor não cria link');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 2b. insert direto saiu do contrato de authenticated =='

set role authenticated;

do $$
declare
  team uuid := 'f0000000-0000-0000-0000-000000000001';
  v_recusou boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, false);

  -- Era assim que a tela criava o link: sem PIN e com slug escolhido. Sem
  -- policy de INSERT, o RLS recusa (42501) — o grant continua uniforme porque
  -- é isso que `06_anon_surface.sql` exige da 0023.
  begin
    insert into public.public_links (kind, team_id, slug, active)
    values ('daily_team', team, 'equipe-blindagem', true);
  exception when sqlstate '42501' then v_recusou := true;
  end;

  perform pg_temp.check11(v_recusou, 'authenticated não insere direto em public_links');
end
$$;

reset role;

\echo '== 3. lockout depois de 5 PINs errados =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  team uuid := 'f0000000-0000-0000-0000-000000000002';
  v_slug text;
  v_id   uuid;
  v_falhas int;
  v_lock timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_slug := public.create_public_link('daily_team', '654321', team, null) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  select id into v_id from public.public_links where slug = v_slug;

  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') ->> 'team_name' = 'Equipe Blindagem II',
    'PIN correto abre o Diário antes de qualquer erro');

  for _i in 1..5 loop
    perform pg_temp.check11(public.public_daily_team(v_slug, '000000') is null,
      format('PIN errado #%s não devolve dado', _i));
  end loop;

  select failed_attempts, locked_until into v_falhas, v_lock
    from public.public_links where id = v_id;

  perform pg_temp.check11(v_lock is not null and v_lock > now(),
    'o quinto erro trava o link');
  perform pg_temp.check11(v_lock <= now() + interval '15 minutes',
    'a trava é de ~15 minutos, não indefinida');
  perform pg_temp.check11(v_falhas = 0,
    'a contagem zera ao disparar a trava (a próxima janela recomeça em 1)');

  -- O ponto do lockout: nem quem sabe o PIN passa durante a punição.
  perform pg_temp.check11(public.public_daily_team(v_slug, '654321') is null,
    'PIN correto é recusado enquanto a trava está de pé');

  -- Vale para as três RPCs, porque a trava mora no resolvedor comum. Até a 0033
  -- esta levantava 42501; desde a 0034 devolve null como as outras duas, e é
  -- por isso que ela passou a conseguir DISPARAR a trava — bloco 6.
  perform pg_temp.check11(
    public.public_daily_submit(v_slug, '654321', '[]'::jsonb) is null,
    'o lançamento do Diário também é recusado durante a trava');

  -- 3b. destrava quando a janela vence.
  update public.public_links set locked_until = now() - interval '1 second' where id = v_id;

  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') ->> 'team_name' = 'Equipe Blindagem II',
    'passada a janela, o PIN correto abre de novo');

  select failed_attempts, locked_until into v_falhas, v_lock
    from public.public_links where id = v_id;
  perform pg_temp.check11(v_falhas = 0 and v_lock is null,
    'o acerto limpa contagem e trava');
end
$$;

\echo '== 4. a contagem zera no acerto =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  team uuid := 'f0000000-0000-0000-0000-000000000003';
  v_slug text;
  v_falhas int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_slug := public.create_public_link('daily_team', '654321', team, null) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  perform public.public_daily_team(v_slug, '111111');
  perform public.public_daily_team(v_slug, '222222');

  select failed_attempts into v_falhas from public.public_links where slug = v_slug;
  perform pg_temp.check11(v_falhas = 2, 'dois erros contam dois');

  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') ->> 'team_name' = 'Equipe Blindagem III',
    'o gerente que errou duas vezes ainda entra na terceira');

  select failed_attempts into v_falhas from public.public_links where slug = v_slug;
  perform pg_temp.check11(v_falhas = 0, 'o acerto zera a contagem');

  -- Quatro erros depois do acerto ainda não travam: a dívida não se acumula.
  perform public.public_daily_team(v_slug, '111111');
  perform public.public_daily_team(v_slug, '222222');
  perform public.public_daily_team(v_slug, '333333');
  perform public.public_daily_team(v_slug, '444444');

  perform pg_temp.check11(
    (select locked_until from public.public_links where slug = v_slug) is null,
    'quatro erros na janela nova não travam');
  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') ->> 'team_name' = 'Equipe Blindagem III',
    'e o PIN correto continua abrindo');
end
$$;

\echo '== 4b. sondagem sem PIN não conta como erro =='

-- A regressão que este bloco existe para pegar: `DailyReport.tsx` chama
-- `public_daily_team(slug, null)` ao montar e de novo a cada tecla digitada no
-- campo do PIN (o efeito depende de `loadMonth`, que depende de `pin`). Se cada
-- uma dessas contasse, o link travava no quinto caractere e nem o PIN correto
-- abria — o Diário ficava inacessível para toda equipe com PIN.
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  team uuid := 'f0000000-0000-0000-0000-000000000003';
  v_slug text;
begin
  select slug into v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  for _i in 1..8 loop
    perform public.public_daily_team(v_slug, null);
    perform public.public_daily_team(v_slug, '');
    perform public.public_daily_team(v_slug, '   ');
  end loop;

  perform pg_temp.check11(
    (select failed_attempts from public.public_links where slug = v_slug) = 0
    and (select locked_until from public.public_links where slug = v_slug) is null,
    '24 sondagens sem PIN não movem a contagem nem travam');

  perform pg_temp.check11(
    public.public_daily_team(v_slug, null) is null,
    'a sondagem continua não devolvendo dado (só serve para a tela saber que há PIN)');

  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') ->> 'team_name' = 'Equipe Blindagem III',
    'depois de 24 sondagens o PIN correto ainda abre');
end
$$;

\echo '== 4c. renovar o PIN destrava =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  team uuid := 'f0000000-0000-0000-0000-000000000003';
  v_slug text;
  v_id   uuid;
begin
  select id, slug into v_id, v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  for _i in 1..5 loop
    perform public.public_daily_team(v_slug, '000000');
  end loop;
  perform pg_temp.check11(
    (select locked_until > now() from public.public_links where id = v_id),
    'link travado para o teste do destravamento');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  perform public.set_public_link_pin(v_id, '999888');
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check11(
    (select locked_until is null and failed_attempts = 0
       from public.public_links where id = v_id),
    'PIN novo limpa trava e contagem');
  perform pg_temp.check11(
    public.public_daily_team(v_slug, '999888') ->> 'team_name' = 'Equipe Blindagem III',
    'e o PIN novo abre na hora, sem esperar os 15 minutos');
end
$$;

\echo '== 4d. criar link duas vezes não duplica =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  dir  uuid := '00000000-0000-0000-0000-0000000000f2';
  v_um  jsonb;
  v_dois jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  -- Dois cliques no botão "Criar link": a tabela não tem unicidade por dono, e
  -- sem a idempotência ficariam duas URLs válidas — a segunda invisível na tela.
  v_um   := public.create_public_link('director_checkpoint', '654321', null, dir);
  v_dois := public.create_public_link('director_checkpoint', '111222', null, dir);

  perform pg_temp.check11(v_um ->> 'id' = v_dois ->> 'id',
    'o segundo pedido devolve o mesmo link, não um novo');
  perform pg_temp.check11(v_um ->> 'slug' = v_dois ->> 'slug',
    'e o mesmo slug — a URL já entregue continua valendo');
  perform pg_temp.check11(
    (select count(*) from public.public_links
      where kind = 'director_checkpoint' and director_id = dir and active) = 1,
    'só existe um link ativo para o diretor');
  perform pg_temp.check11(
    public.public_director_checkpoint(v_dois ->> 'slug', current_date, '111222') is not null
    and public.public_director_checkpoint(v_dois ->> 'slug', current_date, '654321') is null,
    'o PIN válido é o do último pedido');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 5. link antigo continua valendo =='

do $$
declare
  team uuid := 'f0000000-0000-0000-0000-000000000001';
  dir  uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  -- Inserção direta como superusuário é o caminho do seed e do suporte: não
  -- passa por grant nem por RLS, e é assim que os links de hoje entraram.
  insert into public.public_links (kind, team_id, slug, pin_hash, active)
  values ('daily_team', team, 'legado-equipe-blindagem',
          extensions.crypt('654321', extensions.gen_salt('bf', 6)), true);

  insert into public.public_links (kind, director_id, slug, active)
  values ('director_checkpoint', dir, 'legado-diretor-dirce', true);

  perform pg_temp.check11(
    public.public_daily_team('legado-equipe-blindagem', '654321') ->> 'team_name' = 'Equipe Blindagem',
    'link antigo de equipe, com slug legível, continua abrindo');

  perform pg_temp.check11(
    public.public_director_checkpoint('legado-diretor-dirce', current_date, null) ->> 'director'
      = 'Dirce Blindagem',
    'link antigo de diretoria sem PIN continua abrindo (nada foi invalidado em massa)');

  perform pg_temp.check11(
    (select p.provolatile = 'v'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'resolve_public_link'),
    'resolve_public_link é VOLATILE — sem isso o lockout não conseguiria gravar');
end
$$;

\echo '== 6. o ENVIO do diário também alimenta o lockout (0034) =='

-- O buraco que a 0034 fecha. Até ela, `public_daily_submit` sinalizava PIN
-- errado com `raise … errcode = '42501'`. PL/pgSQL não tem transação autônoma:
-- a exceção aborta a transação que o PostgREST abriu e leva junto o `update` do
-- contador que `resolve_public_link` tinha acabado de fazer. Resultado: um
-- script anônimo varria os 10^6 PINs por esta RPC sem NUNCA travar, com resposta
-- de oráculo perfeito (403 no errado, 200 no certo).
--
-- Este bloco reproduz a produção de propósito SEM `exception when` em volta da
-- chamada: um handler em PL/pgSQL é um SAVEPOINT e desfaria o incremento do
-- mesmo jeito, mascarando exatamente o defeito. Se a função voltar a levantar,
-- o DO inteiro aborta e o harness quebra na hora — que é o que se quer.
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  team uuid := 'f0000000-0000-0000-0000-000000000004';
  v_slug   text;
  v_id     uuid;
  v_falhas int;
  v_lock   timestamptz;
  v_out    jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_slug := public.create_public_link('daily_team', '654321', team, null) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  select id into v_id from public.public_links where slug = v_slug;

  for _i in 1..5 loop
    perform pg_temp.check11(
      public.public_daily_submit(v_slug, '000000', '[]'::jsonb) is null,
      format('envio #%s com PIN errado é recusado com null, sem levantar', _i));
  end loop;

  select failed_attempts, locked_until into v_falhas, v_lock
    from public.public_links where id = v_id;

  perform pg_temp.check11(v_lock is not null and v_lock > now(),
    'o quinto envio com PIN errado TRAVA o link (era isto que o rollback apagava)');
  perform pg_temp.check11(v_lock <= now() + interval '15 minutes',
    'a trava disparada pelo envio é de ~15 minutos, não indefinida');
  perform pg_temp.check11(v_falhas = 0,
    'a contagem zera ao disparar a trava, igual ao caminho de leitura');

  -- O ponto do lockout, agora também na escrita: a 6ª com o PIN CERTO é negada.
  perform pg_temp.check11(
    public.public_daily_submit(v_slug, '654321', '[]'::jsonb) is null,
    'a 6ª tentativa, com o PIN correto, é recusada dentro da janela');
  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') is null,
    'e a leitura fica travada junto — a trava é do link, não de uma RPC só');

  -- Recusa não pode ter gravado nada: se tivesse, o "null" seria mentira.
  perform pg_temp.check11(
    not exists (select 1 from public.daily_reports r where r.team_id = team),
    'nenhuma das 6 recusas criou relatório do dia');

  -- 6a. passada a janela, o PIN certo volta a gravar e a contagem zera.
  update public.public_links set locked_until = now() - interval '1 second' where id = v_id;

  v_out := public.public_daily_submit(v_slug, '654321', '[]'::jsonb);
  perform pg_temp.check11(v_out is not null and v_out ->> 'report_id' is not null,
    'passada a janela, o envio com o PIN correto grava de novo');

  select failed_attempts, locked_until into v_falhas, v_lock
    from public.public_links where id = v_id;
  perform pg_temp.check11(v_falhas = 0 and v_lock is null,
    'o acerto pelo caminho de escrita limpa contagem e trava');
end
$$;

\echo '== 6b. nenhuma das três RPCs anônimas levanta na recusa =='

-- A causa é compartilhada e NÃO tem conserto no ponto comum: o incremento mora
-- dentro de `resolve_public_link`, e qualquer bloco `exception` que tentasse
-- proteger o chamador é um SAVEPOINT — desfaria o incremento igual. Sem
-- transação autônoma (dblink/pg_background não estão neste projeto), a única
-- garantia é que NENHUM chamador do resolvedor sinalize recusa com exceção.
-- Este bloco é o tripwire: chamador novo (ou volta ao `raise`) quebra aqui.
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  dir  uuid := '00000000-0000-0000-0000-0000000000f2';
  team uuid := 'f0000000-0000-0000-0000-000000000005';
  v_team_slug text;
  v_dir_slug  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_team_slug := public.create_public_link('daily_team', '654321', team, null) ->> 'slug';
  v_dir_slug  := public.create_public_link('director_checkpoint', '654321', null, dir) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  -- Leitura de equipe.
  perform pg_temp.check11(public.public_daily_team(v_team_slug, '000000') is null,
    'public_daily_team recusa com null');
  perform pg_temp.check11(
    (select failed_attempts from public.public_links where slug = v_team_slug) = 1,
    'public_daily_team contou a tentativa');

  -- Escrita, no MESMO link: o contador tem que continuar de onde parou.
  perform pg_temp.check11(public.public_daily_submit(v_team_slug, '000000', '[]'::jsonb) is null,
    'public_daily_submit recusa com null');
  perform pg_temp.check11(
    (select failed_attempts from public.public_links where slug = v_team_slug) = 2,
    'public_daily_submit contou a tentativa (o contador é do link, não da RPC)');

  -- Leitura de diretoria.
  perform pg_temp.check11(
    public.public_director_checkpoint(v_dir_slug, current_date, '000000') is null,
    'public_director_checkpoint recusa com null');
  perform pg_temp.check11(
    (select failed_attempts from public.public_links where slug = v_dir_slug) = 1,
    'public_director_checkpoint contou a tentativa');
end
$$;

\echo '== 6c. caminho feliz: com o PIN certo o lançamento grava =='

-- A correção troca `raise` por `return null`. Se algo aqui falhar, ela trocou um
-- buraco por uma regressão: o Diário pararia de gravar e a tela diria que sim.
do $$
declare
  team uuid := 'f0000000-0000-0000-0000-000000000004';
  cor  uuid := '00000000-0000-0000-0000-0000000000fa';
  adm  uuid := '00000000-0000-0000-0000-0000000000f1';
  v_slug text;
  v_out  jsonb;
begin
  select slug into v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  v_out := public.public_daily_submit(v_slug, '654321', jsonb_build_array(
    jsonb_build_object('profile_id', cor::text,
                       'leads', 7, 'calls', 3, 'visits_done', 2, 'sales', 1)));

  perform pg_temp.check11((v_out ->> 'saved')::int = 1,
    'o lançamento com o PIN correto grava a linha do corretor da equipe');
  perform pg_temp.check11(
    (select e.leads = 7 and e.calls = 3 and e.visits_done = 2 and e.sales = 1
       from public.daily_entries e
       join public.daily_reports r on r.id = e.report_id
      where r.team_id = team and r.report_date = current_date and e.profile_id = cor),
    'os números chegaram inteiros ao daily_entries');

  -- Upsert: "o gerente corrige ao longo do dia" (contrato da 0009).
  v_out := public.public_daily_submit(v_slug, '654321', jsonb_build_array(
    jsonb_build_object('profile_id', cor::text, 'leads', 9)));
  perform pg_temp.check11(
    (select count(*) = 1 and max(e.leads) = 9 and max(e.calls) = 0
       from public.daily_entries e
       join public.daily_reports r on r.id = e.report_id
      where r.team_id = team and e.profile_id = cor),
    'reenviar corrige a linha em vez de duplicar');

  -- Corretor de fora da equipe do link continua sendo ignorado em silêncio.
  v_out := public.public_daily_submit(v_slug, '654321', jsonb_build_array(
    jsonb_build_object('profile_id', adm::text, 'leads', 5)));
  perform pg_temp.check11((v_out ->> 'saved')::int = 0,
    'corretor fora da equipe do link é ignorado');

  -- E a leitura devolve o que a escrita gravou — é o que a tela mostra ao abrir.
  perform pg_temp.check11(
    public.public_daily_team(v_slug, '654321') -> 'today' @> jsonb_build_array(
      jsonb_build_object('profile_id', cor::text, 'leads', 9)),
    'a leitura do dia enxerga o lançamento');
end
$$;

\echo 'endurecimento de link público ok'
