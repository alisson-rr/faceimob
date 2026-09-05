-- =============================================================================
-- Regressão da 0062 — o link público do Diário tem dono, prazo e recusa uniforme
--
-- Sete defeitos, todos exercidos aqui pelo caminho de verdade (as RPCs), não por
-- leitura de catálogo:
--
--   1. link criado pela tela nascia SEM validade (`expires_at` nunca escrito);
--   2. "Renovar PIN" num link vencido dava "PIN gerado" e o link seguia fechado;
--   3. `set_public_link_pin` com id inexistente devolvia void — falso sucesso;
--   4. `set_public_link_pin` com PIN vazio ZERAVA o hash e reabria o link — e
--      recusar só na RPC não fechava nada: o dono refazia o buraco com um
--      UPDATE direto pelo PostgREST (bloco 3b);
--   5. qualquer diretor trocava o PIN do link de qualquer outro;
--   6. PIN não numérico era aceito e trancava o link para sempre (as telas
--      públicas filtram o campo com `replace(/\D/g,'')`);
--   7. `{pin_required:true}` × `null` enumerava slug de diretoria para anônimo.
--
-- Mais as leituras que mentiam: meta literal em vez de `funnel_targets`, roster
-- sem quem saiu (enquanto o total do mês somava a produção dele), pendência
-- acusando sábado e domingo, e jsonb malformado estourando 22P02 cru numa
-- superfície que promete recusa em NULL.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check62(cond boolean, label text)
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
-- Fixtures próprias, no espaço 6a*/60620000 — os outros arquivos usam f0*, 00*
-- e 1000*, e o harness roda todos no mesmo banco.
-- -----------------------------------------------------------------------------
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  dir  uuid := '00000000-0000-0000-0000-0000000006a2';
  dir2 uuid := '00000000-0000-0000-0000-0000000006a3';
  cor  uuid := '00000000-0000-0000-0000-0000000006aa';
  ex   uuid := '00000000-0000-0000-0000-0000000006ab';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@d62.test', '{"full_name":"Admin 0062"}'),
    (dir,  'dir@d62.test', '{"full_name":"Dirceu Dono"}'),
    (dir2, 'dir2@d62.test','{"full_name":"Dirlene Intrusa"}'),
    (cor,  'cor@d62.test', '{"full_name":"Corretor Ativo 0062"}'),
    (ex,   'ex@d62.test',  '{"full_name":"Corretor Egresso 0062"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (dir, 'director'), (dir2, 'director'),
    (cor, 'broker'), (ex, 'broker')
  on conflict do nothing;

  -- Uma equipe por bloco: `create_public_link` é idempotente por (tipo, dono),
  -- então reaproveitar equipe embaralharia o estado entre os blocos.
  insert into public.teams (id, name, slug, director_id) values
    ('60620000-0000-0000-0000-000000000001', 'Equipe 0062 A', 'equipe-0062-a', dir),
    ('60620000-0000-0000-0000-000000000002', 'Equipe 0062 B', 'equipe-0062-b', dir),
    ('60620000-0000-0000-0000-000000000003', 'Equipe 0062 C', 'equipe-0062-c', dir),
    ('60620000-0000-0000-0000-000000000004', 'Equipe 0062 D', 'equipe-0062-d', dir),
    ('60620000-0000-0000-0000-000000000005', 'Equipe 0062 E', 'equipe-0062-e', dir),
    ('60620000-0000-0000-0000-000000000006', 'Equipe 0062 F', 'equipe-0062-f', dir)
  on conflict (id) do nothing;

  -- Corretor ativo na equipe A; egresso com saída registrada, para o roster.
  insert into public.team_members (team_id, profile_id) values
    ('60620000-0000-0000-0000-000000000001', cor)
  on conflict do nothing;

  insert into public.team_members (team_id, profile_id, left_at) values
    ('60620000-0000-0000-0000-000000000001', ex, now() - interval '3 days')
  on conflict do nothing;

  -- Meta DA EQUIPE A: é ela que a tela do Diário tem que passar a cobrar, em
  -- vez dos 10/40/50 literais que estavam no código.
  insert into public.funnel_targets (scope, team_id, lead_to_analysis_pct, analysis_to_approval_pct, approval_to_sale_pct, effective_from)
  values ('team', '60620000-0000-0000-0000-000000000001', 13, 46, 56, current_date - 1)
  on conflict do nothing;
end
$$;

\echo '== 1. link novo nasce com validade (era eterno) =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  team uuid := '60620000-0000-0000-0000-000000000001';
  v_out jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  v_out := public.create_public_link('daily_team', '654321', team, null);

  perform pg_temp.check62(
    (select expires_at is not null from public.public_links where id = (v_out ->> 'id')::uuid),
    'link criado pela RPC nasce com expires_at');
  perform pg_temp.check62(
    (select expires_at between now() + interval '89 days' and now() + interval '91 days'
       from public.public_links where id = (v_out ->> 'id')::uuid),
    'a validade padrão é de 90 dias');
  perform pg_temp.check62(v_out ? 'expires_at',
    'a RPC devolve a validade para a tela poder exibi-la');
  perform pg_temp.check62(
    (select pin_set_at is not null from public.public_links where id = (v_out ->> 'id')::uuid),
    'a troca do PIN fica datada em pin_set_at');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 2. PIN não numérico é recusado (senão o link fica inacessível) =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  team uuid := '60620000-0000-0000-0000-000000000002';
  v_recusou boolean;
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  -- As duas telas públicas filtram o campo com `replace(/\D/g,'')`: um PIN com
  -- letra seria gravado e NUNCA poderia ser digitado.
  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', 'abcdef', team, null);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'PIN com letra é recusado na criação');

  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', '12345678901', team, null);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'PIN maior que o campo público (10) é recusado');

  -- Link sem dono não resolve nada: recusado na criação, não na tela pública.
  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', '654321', null, null);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'link de diário sem equipe é recusado');

  v_id := (public.create_public_link('daily_team', '654321', team, null) ->> 'id')::uuid;

  v_recusou := false;
  begin
    perform public.set_public_link_pin(v_id, 'abcdef');
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'PIN com letra também é recusado na troca');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 3. set_public_link_pin não dá sucesso mudo nem reabre o link =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  team uuid := '60620000-0000-0000-0000-000000000003';
  v_id   uuid;
  v_hash text;
  v_recusou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  v_id := (public.create_public_link('daily_team', '654321', team, null) ->> 'id')::uuid;
  select pin_hash into v_hash from public.public_links where id = v_id;

  -- Era um UPDATE cego: id inexistente devolvia void e a tela dizia "PIN gerado".
  v_recusou := false;
  begin
    perform public.set_public_link_pin('60620000-0000-0000-0000-0000000000ff', '999888');
  exception when sqlstate 'P0002' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'trocar o PIN de um link inexistente falha em vez de mentir');

  -- PIN vazio ZERAVA o pin_hash e reabria o link ao público.
  v_recusou := false;
  begin
    perform public.set_public_link_pin(v_id, null);
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'PIN nulo é recusado');
  perform pg_temp.check62(
    (select pin_hash = v_hash from public.public_links where id = v_id),
    'e o PIN que existia continua lá — o link não reabriu');

  v_recusou := false;
  begin
    perform public.set_public_link_pin(v_id, '   ');
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'PIN só de espaços é recusado');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 3b. UPDATE direto não reabre o link, não apaga a validade e não troca o slug =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  team uuid := '60620000-0000-0000-0000-000000000006';
  v_id     uuid;
  v_slug   text;
  v_ate    timestamptz;
  v_recusou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  v_id := (public.create_public_link('daily_team', '654321', team, null) ->> 'id')::uuid;
  select slug, expires_at into v_slug, v_ate from public.public_links where id = v_id;

  -- Recusar PIN vazio DENTRO da RPC não fecha nada sozinho: `authenticated` tem
  -- UPDATE na tabela (grant da 0023) e a policy decide por LINHA. O dono do link
  -- reabria o link ao público com um PATCH direto no PostgREST.
  v_recusou := false;
  begin
    update public.public_links set pin_hash = null where id = v_id;
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'UPDATE direto não zera o pin_hash');
  perform pg_temp.check62(
    (select pin_hash is not null from public.public_links where id = v_id),
    'e o link continua fechado por PIN');

  -- Validade de 90 dias é o item 1 desta migration: apagá-la devolve o link
  -- eterno que a 0062 existe para acabar.
  v_recusou := false;
  begin
    update public.public_links set expires_at = null where id = v_id;
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'UPDATE direto não apaga a validade');

  v_recusou := false;
  begin
    update public.public_links set slug = 'diario-adivinhavel' where id = v_id;
  exception when sqlstate '22023' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'UPDATE direto não troca o slug sorteado');

  -- E o que a tela faz de verdade continua passando: "Renovar validade" é um
  -- PATCH em expires_at/locked_until/failed_attempts, e "Desativar" em active.
  update public.public_links
     set expires_at = now() + interval '90 days', locked_until = null, failed_attempts = 0
   where id = v_id;
  perform pg_temp.check62(
    (select expires_at > v_ate from public.public_links where id = v_id),
    'renovar a validade pela tela continua funcionando');

  update public.public_links set active = false where id = v_id;
  perform pg_temp.check62(
    (select not active from public.public_links where id = v_id),
    'desativar o link pela tela continua funcionando');
  update public.public_links set active = true where id = v_id;

  -- E a troca de PIN pela RPC atravessa o gatilho: ela grava hash, nunca nulo.
  perform public.set_public_link_pin(v_id, '987654');
  perform pg_temp.check62(
    (select slug = v_slug and pin_hash is not null and expires_at is not null
       from public.public_links where id = v_id),
    'set_public_link_pin continua trocando o PIN com o gatilho no caminho');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 4. dono do link: um diretor não assume o link de outro =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  dir  uuid := '00000000-0000-0000-0000-0000000006a2';
  dir2 uuid := '00000000-0000-0000-0000-0000000006a3';
  team uuid := '60620000-0000-0000-0000-000000000004';
  v_id uuid;
  v_recusou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_id := (public.create_public_link('daily_team', '654321', team, null) ->> 'id')::uuid;

  -- A equipe é do `dir`. O `dir2` é diretor, tem o papel — e não tem a equipe.
  perform set_config('request.jwt.claims',
    json_build_object('sub', dir2::text, 'role', 'authenticated')::text, false);

  v_recusou := false;
  begin
    perform public.set_public_link_pin(v_id, '111222');
  exception when sqlstate '42501' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'diretor sem a equipe não troca o PIN do link dela');

  v_recusou := false;
  begin
    perform public.create_public_link('daily_team', '111222',
      '60620000-0000-0000-0000-000000000005', null);
  exception when sqlstate '42501' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'nem cria link para equipe que não é sua');

  v_recusou := false;
  begin
    perform public.create_public_link('director_checkpoint', '111222', null, dir);
  exception when sqlstate '42501' then v_recusou := true;
  end;
  perform pg_temp.check62(v_recusou, 'nem cria o link de diretoria de outro diretor');

  -- O dono continua podendo — a blindagem não pode ter virado "só admin".
  perform set_config('request.jwt.claims',
    json_build_object('sub', dir::text, 'role', 'authenticated')::text, false);
  perform public.set_public_link_pin(v_id, '333444');
  perform pg_temp.check62(
    public.public_daily_team((select slug from public.public_links where id = v_id), '333444') is not null,
    'o diretor dono da equipe continua trocando o PIN do link dela');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 5. link vencido: recusa igual, e renovar o PIN revalida =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  team uuid := '60620000-0000-0000-0000-000000000001';
  v_id   uuid;
  v_slug text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  select id, slug into v_id, v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  perform set_config('request.jwt.claims', '', false);
  update public.public_links set expires_at = now() - interval '1 day' where id = v_id;

  perform pg_temp.check62(
    public.public_daily_team(v_slug, '654321') is null,
    'link vencido recusa a leitura, com o PIN certo');

  -- O falso sucesso: "PIN gerado" num link vencido, que seguia recusando.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  perform public.set_public_link_pin(v_id, '654321');
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check62(
    (select expires_at > now() from public.public_links where id = v_id),
    'renovar o PIN revalida o link vencido');
  perform pg_temp.check62(
    public.public_daily_team(v_slug, '654321') is not null,
    'e a leitura volta a abrir — o "PIN gerado" passou a ser verdade');
end
$$;

\echo '== 6. o Diário lê a meta da equipe, não 10/40/50 literais =='

do $$
declare
  team uuid := '60620000-0000-0000-0000-000000000001';
  v_slug text;
  v_out  jsonb;
begin
  select slug into v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  v_out := public.public_daily_team(v_slug, '654321');

  perform pg_temp.check62(v_out -> 'targets' ->> 'scope' = 'team',
    'a meta vem do escopo mais específico que existe (equipe)');
  perform pg_temp.check62(
    (v_out -> 'targets' ->> 'lead_to_analysis_pct')::numeric = 13
    and (v_out -> 'targets' ->> 'analysis_to_approval_pct')::numeric = 46
    and (v_out -> 'targets' ->> 'approval_to_sale_pct')::numeric = 56,
    'e são os números gravados em funnel_targets, não os do código');
  perform pg_temp.check62(v_out ? 'expires_at',
    'a leitura devolve a validade do link para avisar quem preenche');
end
$$;

\echo '== 7. roster mostra quem saiu MAS lançou no mês =='

do $$
declare
  team uuid := '60620000-0000-0000-0000-000000000001';
  cor  uuid := '00000000-0000-0000-0000-0000000006aa';
  ex   uuid := '00000000-0000-0000-0000-0000000006ab';
  v_slug text;
  v_rep  uuid;
  v_out  jsonb;
begin
  select slug into v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  -- Lançamento do egresso, gravado como o suporte grava (a RPC só aceita quem
  -- está com `left_at is null`).
  insert into public.daily_reports (team_id, report_date, submitted_at)
  values (team, current_date, now())
  on conflict (team_id, report_date) do update set submitted_at = now()
  returning id into v_rep;

  insert into public.daily_entries (report_id, profile_id, leads)
  values (v_rep, ex, 4)
  on conflict (report_id, profile_id) do update set leads = 4;

  v_out := public.public_daily_team(v_slug, '654321');

  perform pg_temp.check62(
    v_out -> 'roster' @> jsonb_build_array(jsonb_build_object('profile_id', cor::text, 'active', true)),
    'o corretor ativo continua no roster, marcado ativo');
  perform pg_temp.check62(
    v_out -> 'roster' @> jsonb_build_array(jsonb_build_object('profile_id', ex::text, 'active', false)),
    'e o egresso que lançou no mês aparece marcado como desligado');

  -- O motivo de tudo isso: o total do mês somava o egresso e a lista por
  -- corretor não o mostrava — duas somas diferentes na mesma tela.
  perform pg_temp.check62(
    (select count(*) from jsonb_array_elements(v_out -> 'roster')) >= 2,
    'as duas somas passam a ter as mesmas pessoas');
end
$$;

\echo '== 8. o lançamento anônimo tem teto e não estoura com jsonb torto =='

do $$
declare
  team uuid := '60620000-0000-0000-0000-000000000001';
  cor  uuid := '00000000-0000-0000-0000-0000000006aa';
  v_slug text;
  v_out  jsonb;
  v_big  jsonb;
begin
  select slug into v_slug from public.public_links
   where kind = 'daily_team' and team_id = team and active;

  -- `(v_entry ->> 'profile_id')::uuid` estourava 22P02 cru; agora é linha
  -- ignorada, o mesmo tratamento de quem não é da equipe.
  v_out := public.public_daily_submit(v_slug, '654321', jsonb_build_array(
    jsonb_build_object('profile_id', 'nao-e-uuid', 'leads', 1),
    jsonb_build_object('profile_id', cor::text, 'leads', 'muitos', 'calls', 2)));

  perform pg_temp.check62((v_out ->> 'saved')::int = 1,
    'profile_id malformado é ignorado sem exceção');
  perform pg_temp.check62(
    (select e.leads = 0 and e.calls = 2
       from public.daily_entries e
       join public.daily_reports r on r.id = e.report_id
      where r.team_id = team and r.report_date = current_date and e.profile_id = cor),
    'métrica não numérica vira 0 em vez de 22P02');

  -- Teto do laço: um POST anônimo com dezenas de milhares de elementos rodava
  -- inteiro. A recusa é a mesma NULL do resto do contrato.
  select jsonb_agg(jsonb_build_object('profile_id', cor::text, 'leads', 1))
    into v_big from generate_series(1, 201);
  perform pg_temp.check62(public.public_daily_submit(v_slug, '654321', v_big) is null,
    'lançamento acima de 200 linhas é recusado');
  perform pg_temp.check62(public.public_daily_submit(v_slug, '654321', '{}'::jsonb) is null,
    'p_entries que não é lista é recusado');
end
$$;

\echo '== 9. diretoria: slug desconhecido responde igual a slug conhecido =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-0000000006a1';
  dir  uuid := '00000000-0000-0000-0000-0000000006a2';
  v_slug text;
  v_out  jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  v_slug := public.create_public_link('director_checkpoint', '654321', null, dir) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  -- O oráculo: antes, slug existente pedia PIN e slug inexistente devolvia
  -- null. De fora, isso confirma quais links existem.
  perform pg_temp.check62(
    (public.public_director_checkpoint(v_slug, null, null) ->> 'pin_required') = 'true',
    'slug existente pede PIN sem entregar dado');
  perform pg_temp.check62(
    (public.public_director_checkpoint('slug-que-nao-existe-0062', null, null) ->> 'pin_required') = 'true',
    'slug inexistente responde exatamente a mesma coisa');
  perform pg_temp.check62(
    public.public_director_checkpoint('slug-que-nao-existe-0062', null, null) -> 'director' is null,
    'e nenhum dos dois vaza diretor, equipe ou total');

  -- Com o PIN certo abre, com o errado recusa: o contrato não regrediu.
  v_out := public.public_director_checkpoint(v_slug, current_date, '654321');
  perform pg_temp.check62(v_out ->> 'director' = 'Dirceu Dono',
    'com o PIN certo o checkpoint abre');
  perform pg_temp.check62(
    public.public_director_checkpoint(v_slug, current_date, '000000') is null,
    'com o PIN errado a recusa continua em NULL');
end
$$;

\echo '== 10. pendência só em dia útil, e meta por equipe na diretoria =='

do $$
declare
  dir   uuid := '00000000-0000-0000-0000-0000000006a2';
  v_slug text;
  v_out  jsonb;
  v_team jsonb;
  v_dias jsonb;
begin
  select slug into v_slug from public.public_links
   where kind = 'director_checkpoint' and director_id = dir and active;

  -- Semana inteira no passado: todos os dias entram no recorte de cobrança.
  v_out := public.public_director_checkpoint(
    v_slug, (date_trunc('week', current_date)::date - 7), '654321');

  select value into v_team
    from jsonb_array_elements(v_out -> 'teams')
   where value ->> 'team_name' = 'Equipe 0062 A';

  perform pg_temp.check62(v_team is not null, 'a equipe do diretor aparece no checkpoint');

  v_dias := v_team -> 'missing_days';
  perform pg_temp.check62(
    not exists (
      select 1 from jsonb_array_elements_text(v_dias) d
      where extract(isodow from d::date) >= 6
    ),
    'sábado e domingo não entram na cobrança de checkpoint');
  perform pg_temp.check62(
    (select count(*) from jsonb_array_elements_text(v_dias)) = 5,
    'a semana inteira sem checkpoint acusa 5 dias úteis, não 7');

  -- `funnel_targets.team_id` estava no banco, populado, e ninguém lia.
  perform pg_temp.check62(v_team -> 'targets' ->> 'scope' = 'team',
    'a meta da equipe é usada quando existe');
  perform pg_temp.check62(
    (v_team -> 'targets' ->> 'lead_to_analysis_pct')::numeric = 13,
    'e é a meta gravada para aquela equipe, não a do diretor');
  perform pg_temp.check62(v_out -> 'month' ? 'inactive_teams',
    'o mês diz quantas equipes desativadas ainda contribuíram para o total');
end
$$;

\echo 'diário 0062 ok'
