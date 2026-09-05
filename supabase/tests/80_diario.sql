-- =============================================================================
-- Regressão da 0080 — a guarda anônima, o PIN sem rastro e o aviso que não chega
--
-- Cinco defeitos, exercidos pelo caminho de verdade (catálogo de privilégios,
-- gatilho e as funções), não por leitura do texto da migration:
--
--   1. sete funções nascidas nas migrations 0059+ eram executáveis por `anon`,
--      e o tripwire de `tests/06` não disparou porque o harness precisa de
--      Docker e nunca rodou contra o banco remoto;
--   2. `pin_hash` e `slug` dependiam só da RLS — `anon` e `authenticated` têm
--      grant de TABELA em `public_links`;
--   3. o gatilho de coluna não olhava o PIN NOVO: um PATCH direto gravava PIN
--      em claro (que nenhuma RPC sabe conferir) e `pin_set_at` mentia;
--   4. trocar o PIN não deixava rastro nenhum para quem usa o link;
--   5. `notify_expiring_public_links` nunca avisava o GERENTE — exatamente quem
--      abre o Diário todo dia — e mandava todo mundo para uma rota que só
--      admin e diretor podem abrir.
--
--   6. o erro de ontem ficava congelado: `public_daily_submit` gravava sempre
--      em `current_date` e não existe tela de administração que edite daily
--      passado.
--
-- Mais as duas leituras: o checkpoint da diretoria não dizia quando o link
-- vence, e a pendência da semana era limpa por um relatório SEM lançamento.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check80(cond boolean, label text)
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
-- Fixtures no espaço 8a*/80800000 — os outros arquivos usam f0*, 00*, 1000* e
-- 6a*, e o harness roda todos no mesmo banco.
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000000008a1';
  dir uuid := '00000000-0000-0000-0000-0000000008a2';
  ger uuid := '00000000-0000-0000-0000-0000000008a3';
  cor uuid := '00000000-0000-0000-0000-0000000008a4';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@d80.test', '{"full_name":"Admin 0080"}'),
    (dir, 'dir@d80.test', '{"full_name":"Diretor 0080"}'),
    (ger, 'ger@d80.test', '{"full_name":"Gerente 0080"}'),
    (cor, 'cor@d80.test', '{"full_name":"Corretor 0080"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (dir, 'director'), (ger, 'manager'), (cor, 'broker')
  on conflict do nothing;

  insert into public.teams (id, name, slug, director_id, manager_id) values
    ('80800000-0000-0000-0000-000000000001', 'Equipe 0080 A', 'equipe-0080-a', dir, ger),
    ('80800000-0000-0000-0000-000000000002', 'Equipe 0080 B', 'equipe-0080-b', dir, ger)
  on conflict (id) do nothing;

  insert into public.team_members (team_id, profile_id) values
    ('80800000-0000-0000-0000-000000000001', cor)
  on conflict do nothing;
end
$$;

\echo '== 1. a superfície anônima voltou a ser exatamente três RPCs =='

do $$
declare
  extras text;
  n int;
begin
  -- O mesmo tripwire de `tests/06`, repetido aqui porque é ESTA migration que
  -- fecha o buraco: sem o laço de revoke a homologação tinha dez funções
  -- executáveis por anon, e `deal_id_of_object(text)` era chamável por
  -- POST /rest/v1/rpc/ sem nenhuma sessão.
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into extras, n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in
      ('public_daily_team', 'public_daily_submit', 'public_director_checkpoint');

  perform pg_temp.check80(n = 0,
    format('nenhuma função além das 3 RPCs é executável por anon (sobraram: %s)',
           coalesce(extras, 'nenhuma')));

  -- Revogar demais fecharia o Diário público, que é o oposto do objetivo.
  perform pg_temp.check80(
    has_function_privilege('anon', 'public.public_daily_team(text,text)', 'execute')
    and has_function_privilege('anon', 'public.public_daily_submit(text,text,jsonb,text,text)', 'execute')
    and has_function_privilege('anon', 'public.public_director_checkpoint(text,date,text)', 'execute'),
    'as 3 RPCs do Diário seguem executáveis por anon');

  -- As sete de 0059+ pelo nome: é o que a auditoria encontrou.
  perform pg_temp.check80(
    not has_function_privilege('anon', 'public.deal_id_of_object(text)', 'execute'),
    'deal_id_of_object deixou de ser chamável sem sessão');

  -- `authenticated` NÃO pode ter sido levado junto: o storage do CCA chama
  -- `deal_id_of_object` de dentro da policy, como o usuário logado.
  perform pg_temp.check80(
    has_function_privilege('authenticated', 'public.deal_id_of_object(text)', 'execute'),
    'e authenticated continua podendo chamá-la (policy do storage do CCA)');
end
$$;

\echo '== 2. anon sai de public_links (só a RLS separava o bcrypt do PIN) =='

do $$
begin
  -- `anon` não tem uma única policy em `public_links` (as três da 0062 são
  -- `to authenticated`): o grant de tabela existia sem caminho de uso, e era a
  -- RLS sozinha segurando o `pin_hash` e o `slug`.
  perform pg_temp.check80(
    not has_table_privilege('anon', 'public.public_links', 'select')
    and not has_table_privilege('anon', 'public.public_links', 'update')
    and not has_table_privilege('anon', 'public.public_links', 'insert')
    and not has_table_privilege('anon', 'public.public_links', 'delete'),
    'anon não tem mais privilégio nenhum em public_links');

  -- E as três RPCs continuam abrindo o link sem sessão: são SECURITY DEFINER e
  -- não dependem do privilégio de quem chama. Se dependessem, o revoke acima
  -- teria fechado o Diário público inteiro.
  perform pg_temp.check80(
    (select prosecdef from pg_proc where oid = 'public.public_daily_team(text,text)'::regprocedure)
    and (select prosecdef from pg_proc where oid = 'public.public_daily_submit(text,text,jsonb,text,text)'::regprocedure)
    and (select prosecdef from pg_proc where oid = 'public.public_director_checkpoint(text,date,text)'::regprocedure),
    'as 3 RPCs seguem SECURITY DEFINER — o revoke em anon não as alcança');

  -- `authenticated` mantém o grant de TABELA de propósito: separar por COLUNA
  -- reprovaria `tests/06_anon_surface.sql`, que exige SELECT+INSERT de tabela
  -- em toda tabela de `public` (regressão da 0023, "banco novo tem que abrir").
  -- Para o logado quem separa é a RLS de dono (0062) e o gatilho do bloco 3.
  perform pg_temp.check80(
    has_table_privilege('authenticated', 'public.public_links', 'select'),
    'authenticated continua com o grant de tabela que a 0023 exige');
end
$$;

\echo '== 3. o gatilho olha o PIN NOVO, não só o PIN apagado =='

do $$
declare
  adm   uuid := '00000000-0000-0000-0000-0000000008a1';
  team  uuid := '80800000-0000-0000-0000-000000000001';
  v_id  uuid;
  v_recusou boolean;
  v_antes timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_id := (public.create_public_link('daily_team', '654321', team, null) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', '', false);

  -- PIN em claro no `pin_hash` não "quase funciona": as três RPCs comparam com
  -- `crypt()`, então o link ficaria fechado para todo mundo sem erro nenhum.
  v_recusou := false;
  begin
    update public.public_links set pin_hash = '123456' where id = v_id;
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check80(v_recusou, 'PIN em claro gravado por UPDATE direto é recusado');

  -- `pin_set_at` mentia: era escrito só pelas duas RPCs.
  update public.public_links set pin_set_at = now() - interval '200 days' where id = v_id;
  select pin_set_at into v_antes from public.public_links where id = v_id;
  perform pg_temp.check80(v_antes < now() - interval '100 days', 'carimbo antigo gravado para o teste');

  update public.public_links
     set pin_hash = extensions.crypt('777888', extensions.gen_salt('bf', 10))
   where id = v_id;

  perform pg_temp.check80(
    (select pin_set_at > now() - interval '1 minute' from public.public_links where id = v_id),
    'trocar o hash por fora da RPC carimba pin_set_at do lado do banco');

  -- O gatilho da 0062 era `before update`: um INSERT direto com PIN em claro
  -- entrava sem erro nenhum e produzia o link fechado para todo mundo em
  -- silêncio. Insert direto é caminho de verdade — é o que o seed e os E2E
  -- fazem.
  v_recusou := false;
  begin
    insert into public.public_links (kind, team_id, slug, pin_hash, active)
    values ('daily_team', team, 'd80-insert-claro', '123456', true);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check80(v_recusou, 'INSERT direto com PIN em claro também é recusado');

  -- E o INSERT legítimo continua passando, já carimbado.
  insert into public.public_links (kind, team_id, slug, pin_hash, active)
  values ('daily_team', team, 'd80-insert-hash',
          extensions.crypt('654321', extensions.gen_salt('bf', 6)), true);
  perform pg_temp.check80(
    (select pin_set_at > now() - interval '1 minute'
       from public.public_links where slug = 'd80-insert-hash'),
    'e o INSERT com bcrypt nasce com pin_set_at carimbado');

  -- Link SEM PIN continua sendo estado legítimo (0033) e não pode ganhar
  -- carimbo de PIN nenhum: a tela diria "PIN trocado em <hoje>" sobre um
  -- código que nunca existiu.
  insert into public.public_links (kind, team_id, slug, active)
  values ('daily_team', team, 'd80-insert-sem-pin', true);
  perform pg_temp.check80(
    (select pin_hash is null and pin_set_at is null
       from public.public_links where slug = 'd80-insert-sem-pin'),
    'link sem PIN entra sem erro e sem carimbo');
end
$$;

\echo '== 4. a troca do PIN deixa rastro — e o rastro não carrega o PIN =='

do $$
declare
  dir uuid := '00000000-0000-0000-0000-0000000008a2';
  ger uuid := '00000000-0000-0000-0000-0000000008a3';
begin
  -- O UPDATE do bloco 3 é a troca de PIN: o gerente e o diretor da equipe
  -- precisam saber que existe código novo, senão descobrem quando o link para
  -- de aceitar o antigo.
  perform pg_temp.check80(
    exists (select 1 from public.notifications
            where profile_id = ger and kind = 'public_link_pin_rotated'),
    'o gerente da equipe é avisado de que o PIN mudou');
  perform pg_temp.check80(
    exists (select 1 from public.notifications
            where profile_id = dir and kind = 'public_link_pin_rotated'),
    'o diretor da equipe também');

  -- O PIN em claro não pode existir no banco (0062). O rastro é do FATO.
  perform pg_temp.check80(
    not exists (select 1 from public.notifications
                where kind = 'public_link_pin_rotated' and body like '%777888%'),
    'e o aviso não carrega o PIN em claro');

  -- `menu.admin_daily_teams` é de admin e diretor: mandar o gerente para lá
  -- seria um clique em "acesso não liberado".
  perform pg_temp.check80(
    (select link is null from public.notifications
      where profile_id = ger and kind = 'public_link_pin_rotated'
      order by created_at desc limit 1),
    'o aviso do gerente não linka a rota que ele não pode abrir');
  perform pg_temp.check80(
    (select link = '/admin/daily-teams' from public.notifications
      where profile_id = dir and kind = 'public_link_pin_rotated'
      order by created_at desc limit 1),
    'e o do diretor linka a tela onde ele resolve');
end
$$;

\echo '== 5. o aviso de vencimento chega a quem usa o link =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000008a1';
  dir  uuid := '00000000-0000-0000-0000-0000000008a2';
  ger  uuid := '00000000-0000-0000-0000-0000000008a3';
  team uuid := '80800000-0000-0000-0000-000000000002';
  v_id uuid;
  v_n  integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_id := (public.create_public_link('daily_team', '654321', team, null) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', '', false);

  -- Link longe do vencimento: nada a avisar. O job roda todo dia e não pode
  -- virar ruído.
  v_n := public.notify_expiring_public_links();
  perform pg_temp.check80(
    not exists (select 1 from public.notifications
                where profile_id = ger and kind = 'public_link_expiring'),
    'link com 90 dias de validade não gera aviso nenhum');

  -- Entra na janela dos 7 dias.
  update public.public_links set expires_at = now() + interval '3 days' where id = v_id;

  v_n := public.notify_expiring_public_links();
  perform pg_temp.check80(v_n >= 3, 'o aviso sai para admin, diretor e gerente');
  perform pg_temp.check80(
    exists (select 1 from public.notifications
            where profile_id = ger and kind = 'public_link_expiring'),
    'o GERENTE da equipe é avisado — era o único que nunca era');
  perform pg_temp.check80(
    exists (select 1 from public.notifications
            where profile_id = dir and kind = 'public_link_expiring'),
    'o diretor dono continua avisado');
  perform pg_temp.check80(
    exists (select 1 from public.notifications
            where profile_id = adm and kind = 'public_link_expiring'),
    'e o admin também');

  -- O gerente não administra link: o aviso dele pede a renovação em vez de
  -- linkar uma rota que ele não abre.
  perform pg_temp.check80(
    (select link is null and body like '%peça a renovação%'
       from public.notifications
      where profile_id = ger and kind = 'public_link_expiring'
      order by created_at desc limit 1),
    'o aviso do gerente diz o que fazer, sem link para rota barrada');

  -- Idempotência: o job roda diariamente e o aviso é um por link.
  select count(*) into v_n from public.notifications
   where profile_id = ger and kind = 'public_link_expiring';
  perform public.notify_expiring_public_links();
  perform pg_temp.check80(
    (select count(*) from public.notifications
      where profile_id = ger and kind = 'public_link_expiring') = v_n,
    'rodar o job de novo no mesmo dia não duplica o aviso');
end
$$;

\echo '== 6. checkpoint da diretoria: validade do link e dia preenchido =='

do $$
declare
  adm      uuid := '00000000-0000-0000-0000-0000000008a1';
  dir      uuid := '00000000-0000-0000-0000-0000000008a2';
  cor      uuid := '00000000-0000-0000-0000-0000000008a4';
  team     uuid := '80800000-0000-0000-0000-000000000001';
  v_slug    text;
  v_out     jsonb;
  v_terca   date := (date_trunc('week', current_date)::date - 7) + 1;
  v_report  uuid;
  v_missing jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_slug := public.create_public_link('director_checkpoint', '654321', null, dir) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  -- Relatório SEM NENHUMA ENTRADA: é o que sobra quando o envio não casa
  -- nenhum corretor da equipe. Limpava a cobrança sem registrar nada.
  insert into public.daily_reports (team_id, report_date, submitted_at)
  values (team, v_terca, now())
  on conflict (team_id, report_date) do update set submitted_at = now()
  returning id into v_report;

  v_out := public.public_director_checkpoint(v_slug, v_terca - 1, '654321');
  perform pg_temp.check80(v_out is not null, 'o PIN correto abre o checkpoint');

  perform pg_temp.check80(v_out ? 'expires_at',
    'a RPC devolve a validade do link — o diretor não tinha aviso nenhum');
  perform pg_temp.check80(
    (v_out ->> 'expires_at') is not null,
    'e a validade vem preenchida para o link criado pela RPC');

  -- A pendência é lida DA EQUIPE do relatório: a outra equipe do mesmo diretor
  -- não lançou nada nesse dia e faria a asserção passar por acidente.
  select elem -> 'missing_days' into v_missing
  from jsonb_array_elements(v_out -> 'teams') elem
  where elem ->> 'team_id' = team::text;

  perform pg_temp.check80(
    v_missing @> jsonb_build_array(v_terca::text),
    'dia com relatório mas SEM lançamento continua sendo pendência');

  -- Com lançamento, o dia sai da cobrança.
  insert into public.daily_entries (report_id, profile_id, leads)
  values (v_report, cor, 3)
  on conflict (report_id, profile_id) do update set leads = 3;

  v_out := public.public_director_checkpoint(v_slug, v_terca - 1, '654321');
  select elem -> 'missing_days' into v_missing
  from jsonb_array_elements(v_out -> 'teams') elem
  where elem ->> 'team_id' = team::text;

  perform pg_temp.check80(
    not (v_missing @> jsonb_build_array(v_terca::text)),
    'e some da cobrança quando existe lançamento');

  -- Âncora do mês (0071, reposta na 0080). Único recorte que separa a fórmula
  -- certa da que ancora no primeiro dia da SEMANA: nos primeiros dias de todo
  -- mês que não começa numa segunda, a semana corrente começa no mês ANTERIOR —
  -- e o cartão "Resumo do mês" passava a somar agosto enquanto o funil da
  -- semana, logo acima, mostrava setembro. Os outros blocos navegam para a
  -- semana ANTERIOR, onde as duas fórmulas coincidem.
  v_out := public.public_director_checkpoint(v_slug, date_trunc('week', current_date)::date, '654321');
  perform pg_temp.check80(
    (v_out -> 'month' ->> 'start')::date = date_trunc('month', current_date)::date,
    'na semana em que HOJE está, o mês é o de hoje — não o do começo da semana');
  perform pg_temp.check80(
    (v_out -> 'month' ->> 'end')::date = current_date,
    'e o mês corrente vai do dia 1 até hoje, a mesma régua do Diário');

  -- E fora da semana corrente nada muda: a semana navegada traz o mês dela.
  v_out := public.public_director_checkpoint(v_slug, v_terca - 1, '654321');
  perform pg_temp.check80(
    (v_out -> 'month' ->> 'start')::date = date_trunc('month', v_terca - 1)::date,
    'semana passada continua trazendo o mês dela');
end
$$;

\echo '== 7. correção de até 2 dias pelo próprio link =='

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-0000000008a1';
  cor    uuid := '00000000-0000-0000-0000-0000000008a4';
  team   uuid := '80800000-0000-0000-0000-000000000001';
  v_slug text;
  v_out  jsonb;
  v_ontem date := current_date - 1;
  v_velho date := current_date - 3;
  v_entradas jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  -- Reaproveita o link ativo da equipe e repõe um PIN conhecido.
  v_slug := public.create_public_link('daily_team', '654321', team, null) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  v_entradas := jsonb_build_array(jsonb_build_object('profile_id', cor::text, 'leads', 9));

  -- ONTEM: o caso que não existia. O gerente que errou dependia da
  -- administração, e não há tela de administração que edite daily passado.
  v_out := public.public_daily_submit(v_slug, '654321', v_entradas, 'ontem', 'Gerente 0080', v_ontem);
  perform pg_temp.check80(v_out ? 'report_id', 'o lançamento de ontem é aceito');
  perform pg_temp.check80((v_out ->> 'saved')::int = 1, 'e grava a linha do corretor');
  perform pg_temp.check80((v_out ->> 'report_date')::date = v_ontem,
    'a RPC diz em que dia gravou — não presume "hoje"');
  perform pg_temp.check80(
    exists (select 1 from public.daily_reports r
             where r.team_id = team and r.report_date = v_ontem
               and r.filled_by_name = 'Gerente 0080'),
    'o relatório de ONTEM existe no banco, com o gerente que assinou');
  perform pg_temp.check80(
    (select e.leads from public.daily_entries e
       join public.daily_reports r on r.id = e.report_id
      where r.team_id = team and r.report_date = v_ontem and e.profile_id = cor) = 9,
    'e a entrada foi para o dia de ontem, não para o de hoje');

  -- TRÊS dias atrás: fora da janela. A resposta NÃO pode ser o NULL da recusa
  -- de acesso, senão a tela acusa "PIN incorreto" de quem acertou o PIN.
  v_out := public.public_daily_submit(v_slug, '654321', v_entradas, null, 'Gerente 0080', v_velho);
  perform pg_temp.check80(v_out is not null, 'data fora da janela não vira recusa de acesso');
  perform pg_temp.check80(v_out ->> 'error' = 'date_out_of_window',
    'a recusa por data diz o motivo');
  perform pg_temp.check80(
    not exists (select 1 from public.daily_reports r
                 where r.team_id = team and r.report_date = v_velho),
    'e nada foi gravado no dia velho');

  -- Futuro: mesmo tratamento.
  v_out := public.public_daily_submit(v_slug, '654321', v_entradas, null, 'Gerente 0080', current_date + 1);
  perform pg_temp.check80(v_out ->> 'error' = 'date_out_of_window', 'dia futuro é recusado');

  -- PIN errado continua sendo NULL, com ou sem data: a recusa de acesso não
  -- pode virar mensagem própria (0033/0034).
  v_out := public.public_daily_submit(v_slug, '000000', v_entradas, null, null, v_ontem);
  perform pg_temp.check80(v_out is null, 'PIN errado segue devolvendo NULL, mesmo com data');

  -- A assinatura de 5 argumentos (0038) continua valendo e grava HOJE: é a que
  -- `tests/06` cobra e a que o harness chama.
  v_out := public.public_daily_submit(v_slug, '654321', v_entradas, 'hoje', 'Gerente 0080');
  perform pg_temp.check80((v_out ->> 'report_date')::date = current_date,
    'a assinatura antiga grava hoje, como sempre gravou');
end
$$;

\echo '== 8. suspender o link (vencer agora) é reversível; desativar não é =='

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-0000000008a1';
  team   uuid := '80800000-0000-0000-0000-000000000001';
  v_slug text;
  v_id   uuid;
  v_link jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_link := public.create_public_link('daily_team', '654321', team, null);
  v_slug := v_link ->> 'slug';
  v_id   := (v_link ->> 'id')::uuid;

  perform pg_temp.check80(
    public.public_daily_team(v_slug, '654321') is not null,
    'o link abre antes da suspensão');

  -- "Vencer agora": a tela de admin grava `expires_at` no passado. O gatilho de
  -- coluna (que recusa `expires_at → null`) não pode barrar isto — senão o
  -- único jeito de fechar um link seria aposentá-lo de vez, obrigando a
  -- distribuir slug novo e PIN novo por causa de uma suspensão temporária.
  update public.public_links set expires_at = now() - interval '1 minute' where id = v_id;

  perform pg_temp.check80(
    public.public_daily_team(v_slug, '654321') is null,
    'link vencido para de abrir na hora, com o PIN certo');
  -- E fecha para ESCRITA também: um link suspenso que ainda aceitasse
  -- lançamento seria uma suspensão só de fachada.
  perform pg_temp.check80(
    public.public_daily_submit(v_slug, '654321', '[]'::jsonb, null, null, current_date) is null,
    'e o lançamento pelo link suspenso também é recusado');

  -- Reversível pelo MESMO caminho: é o que separa suspender de desativar.
  update public.public_links
     set expires_at = now() + interval '90 days', locked_until = null, failed_attempts = 0
   where id = v_id;

  perform pg_temp.check80(
    public.public_daily_team(v_slug, '654321') is not null,
    'renovar a validade reabre o link com o MESMO slug e o MESMO PIN');

  -- E a regra da 0062 continua de pé: prazo pode encurtar, some não.
  begin
    update public.public_links set expires_at = null where id = v_id;
    perform pg_temp.check80(false, 'apagar a validade deveria ter sido recusado');
  exception when sqlstate '22023' then
    perform pg_temp.check80(true, 'apagar a validade continua recusado — link não volta a ser eterno');
  end;

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 0080 ok =='
