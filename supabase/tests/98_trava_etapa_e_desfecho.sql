-- =============================================================================
-- 0101 — Etapa pela matriz, OFF e distrato só de administrador, resto livre.
--
-- A trava de 10/09/2026 nasceu larga demais (0098 + 0100): um código novo
-- (`deals.edit_stage`) passou por cima da matriz `stage_permissions` e outro
-- (`deals.edit_status`) travou o Status 2 inteiro. Três fluxos legítimos
-- quebraram — agendar visita, aprovar o caso no CCA e encerrar o negócio — e a
-- concessão feita em Admin · Permissões → Etapas deixou de produzir efeito.
-- Nada disso tinha assert: a 0100 subiu sem teste de banco nenhum.
--
-- O que este arquivo cobra, exatamente as três regras da 0101:
--   1. ETAPA — a matriz decide, no UPDATE e no INSERT; conceder na tela volta a
--      valer; administrador e sócio passam sem linha na matriz.
--   2. DESFECHO — OFF e DISTRATO só com `deals.mark_off_distrato`.
--   3. O RESTO do Status 2 — livre, inclusive reenviar o mesmo valor.
-- Mais o buraco que a 0100 deixou aberto: o INSERT.
--
-- E a seção 5, da 0102: `outcome` — a coluna que a 0101 deixou SEM guarda, e a
-- que decide venda no placar e no VGV. Ela vem da ETAPA, não do cliente HTTP.
--
-- E a seção 6, da 0110: o efeito colateral que a 0102 abriu ao derivar `outcome`
-- no INSERT — negócio criado direto em "Fechado" nascia VENDIDO sem passar pela
-- conferência documental, porque as exigências documentais moram em
-- `deals_guard_stage`, que é `before update`. Mais `closed_at`, que continuava
-- sem guarda no UPDATE e desloca a venda na janela da temporada (0060).
--
-- E a 0111 na MESMA seção 6, porque a 0110 mirou em "Fechado" e acertou a faixa
-- inteira: criar negócio já em "Em Análise", "Aprovado" ou "Contrato" passou a
-- ser recusado até para o administrador. A seção agora separa as duas coisas —
-- o administrador cadastra na faixa do CCA, e NINGUÉM faz um negócio nascer
-- `outcome = 'won'` sem a conferência aprovada.
--
-- Prefixo 98 e não 101: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`,
-- então nome de três dígitos não é executado por ninguém.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check98(cond boolean, label text)
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
  adm uuid := '00000000-0000-0000-0000-000000000981';
  cor uuid := '00000000-0000-0000-0000-000000000982';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@trava101.test', '{"full_name":"Admin 101"}'),
    (cor, 'cor@trava101.test', '{"full_name":"Corretor 101"}');

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  -- Outro teste pode ter fechado o mês corrente; `deals_guard_closed_month`
  -- responde antes desta trava e a mensagem seria outra.
  delete from public.closed_months where period = public.month_start(current_date);

  -- A matriz do corretor, escrita à mão: o estado que o seed entrega varia
  -- (o 07 apaga linhas de propósito) e um assert que depende da ordem dos
  -- arquivos não diz qual comportamento quebrou.
  insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
  select s.id, 'broker'::app_role, m.can_enter, true
    from (values
      ('proposal',        true),
      ('visit_scheduled', true),
      ('lost',            true),
      ('lead',            false),   -- a casa que a tela vai conceder no meio do teste
      ('closed',          false)
    ) as m(stage_code, can_enter)
    join public.pipeline_stages s on s.code = m.stage_code
  on conflict (stage_id, role) do update
    set can_enter = excluded.can_enter, can_exit = true;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. Etapa: quem decide é a matriz, e a concessão da tela volta a valer
-- -----------------------------------------------------------------------------
\echo '== 1. etapa pela matriz de etapas =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000000981';
  cor uuid := '00000000-0000-0000-0000-000000000982';
  v_deal   uuid;
  v_prop   uuid;
  v_visita uuid;
  v_lead   uuid;
  v_recusou boolean;
begin
  select id into v_prop   from public.pipeline_stages where code = 'proposal';
  select id into v_visita from public.pipeline_stages where code = 'visit_scheduled';
  select id into v_lead   from public.pipeline_stages where code = 'lead';

  insert into public.deals (stage_id, created_by) values (v_prop, cor)
  returning id into v_deal;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- É o fluxo do ScheduleVisitDialog: agendar visita ADIANTA o negócio para
  -- "Visita agendada" pelo token de quem clica. Era isto que a 0100 recusava
  -- com 42501 — e, como o `updateDeal` vem antes do `scheduleVisit`, a visita
  -- também deixava de ser registrada.
  update public.deals set stage_id = v_visita where id = v_deal;

  -- Sem a casa concedida, a matriz nega.
  v_recusou := false;
  begin
    update public.deals set stage_id = v_lead where id = v_deal;
  exception when insufficient_privilege then
    v_recusou := true;
  end;
  reset role;

  perform pg_temp.check98(
    (select stage_id from public.deals where id = v_deal) = v_visita and v_recusou,
    'corretor entra na etapa que a matriz concede e é negado na que ela não concede');

  -- O admin concede a casa em Admin · Permissões → Etapas. ESTE é o defeito que
  -- a 0100 tinha: a concessão era gravada e não produzia efeito nenhum, porque
  -- `deals.edit_stage` negava antes de a matriz ser consultada.
  update public.stage_permissions sp
     set can_enter = true
    from public.pipeline_stages ps
   where ps.id = sp.stage_id and ps.code = 'lead' and sp.role = 'broker';

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set stage_id = v_lead where id = v_deal;
  reset role;

  perform pg_temp.check98(
    (select stage_id from public.deals where id = v_deal) = v_lead,
    'conceder a etapa na matriz volta a produzir efeito no banco');

  -- Administrador e sócio não dependem da matriz: `can_enter_stage` e
  -- `can_exit_stage` curto-circuitam em `is_admin()`, que desde a 0097 é
  -- admin OU sócio.
  delete from public.stage_permissions sp
   using public.pipeline_stages ps
   where ps.id = sp.stage_id and ps.code = 'proposal' and sp.role = 'admin';

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set stage_id = v_prop where id = v_deal;
  reset role;

  perform pg_temp.check98(
    (select stage_id from public.deals where id = v_deal) = v_prop,
    'administrador move sem depender de linha na matriz');
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Desfecho: OFF e distrato são de administrador; o resto do Status 2 não
-- -----------------------------------------------------------------------------
\echo '== 2. OFF e distrato só de administrador =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000000981';
  cor uuid := '00000000-0000-0000-0000-000000000982';
  v_deal  uuid;
  v_prop  uuid;
  v_label text;
  v_off   boolean;
  v_dist  boolean;
  v_motivo boolean;
begin
  select id into v_prop from public.pipeline_stages where code = 'proposal';

  insert into public.deals (stage_id, created_by) values (v_prop, cor)
  returning id into v_deal;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- O resto do Status 2 é do corretor, e "19. REPROVADO" encerra o negócio sem
  -- ser OFF nem distrato: a rodada anterior tirou dele o catálogo inteiro.
  update public.deals set status_detail = '19. REPROVADO' where id = v_deal;

  v_dist := false;
  begin
    update public.deals set status_detail = '17. DISTRATO' where id = v_deal;
  exception when insufficient_privilege then
    v_dist := true;
  end;

  v_off := false;
  begin
    -- Sem o prefixo numerado, como vem de um `status_detail` importado: a
    -- normalização do banco (`deal_status_bare`) é a mesma de `bareStatus`.
    update public.deals set status_detail = 'OFF' where id = v_deal;
  exception when insufficient_privilege then
    v_off := true;
  end;

  v_motivo := false;
  begin
    -- Só o motivo, com a concatenação que o LoseDealDialog grava — o Status 2
    -- fica onde está e o negócio sai do relatório pelo `lost_reason`.
    update public.deals set lost_reason = '17. DISTRATO — cliente desistiu'
     where id = v_deal;
  exception when insufficient_privilege then
    v_motivo := true;
  end;
  reset role;

  select status_detail into v_label from public.deals where id = v_deal;
  perform pg_temp.check98(v_label = '19. REPROVADO',
    'corretor encerra por REPROVADO: o resto do Status 2 continua livre');
  perform pg_temp.check98(v_dist and v_off and v_motivo,
    'corretor não marca DISTRATO nem OFF, nem pelo Status 2 nem pelo motivo da perda');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals
     set status_detail = '17. DISTRATO', lost_reason = '17. DISTRATO — cliente desistiu'
   where id = v_deal;
  reset role;

  select status_detail into v_label from public.deals where id = v_deal;
  perform pg_temp.check98(v_label = '17. DISTRATO',
    'administrador marca o distrato');

  -- Reenviar o MESMO valor não é escolha nova: `legacyDealFields` manda
  -- `status_detail` e `lost_reason` em todo salvamento do editor, e sem esta
  -- porta corrigir a unidade de um negócio já encerrado viraria 42501.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals
     set unit = '101', status_detail = '17. DISTRATO',
         lost_reason = '17. DISTRATO — cliente desistiu'
   where id = v_deal;
  reset role;

  perform pg_temp.check98(
    (select unit from public.deals where id = v_deal) = '101',
    'reenviar o mesmo OFF/distrato junto com outro campo continua passando');
end
$$;

-- -----------------------------------------------------------------------------
-- 3. INSERT: o buraco que a 0100 deixou aberto
-- -----------------------------------------------------------------------------
\echo '== 3. o negócio também nasce dentro das duas regras =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000000981';
  cor uuid := '00000000-0000-0000-0000-000000000982';
  v_inicial uuid;
  v_visita  uuid;
  v_closed  uuid;
  v_prop    uuid;
  v_novo    uuid;
  v_etapa   boolean;
  v_off     boolean;
begin
  select id into v_inicial from public.pipeline_stages where is_initial;
  select id into v_visita  from public.pipeline_stages where code = 'visit_scheduled';
  select id into v_closed  from public.pipeline_stages where code = 'closed';
  select id into v_prop    from public.pipeline_stages where code = 'proposal';

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- Criar negócio continua sendo do corretor: a etapa INICIAL é nascimento, não
  -- movimentação, e é a que `DealDetailModal` usa.
  insert into public.deals (stage_id, created_by) values (v_inicial, cor)
  returning id into v_novo;

  -- E a matriz continua valendo para as outras etapas — nos dois sentidos.
  insert into public.deals (stage_id, created_by) values (v_visita, cor);

  v_etapa := false;
  begin
    -- Nascer em "Fechado" era o atalho para pular o funil inteiro: o UPDATE
    -- para lá já era negado, o POST não.
    insert into public.deals (stage_id, created_by) values (v_closed, cor);
  exception when insufficient_privilege then
    v_etapa := true;
  end;

  v_off := false;
  begin
    insert into public.deals (stage_id, created_by, status_detail)
    values (v_inicial, cor, 'OFF');
  exception when insufficient_privilege then
    v_off := true;
  end;
  reset role;

  perform pg_temp.check98(v_novo is not null,
    'corretor continua criando negócio na etapa inicial do funil');
  perform pg_temp.check98(v_etapa,
    'negócio não nasce numa etapa que a matriz nega ao papel');
  perform pg_temp.check98(v_off,
    'negócio não nasce em OFF pela mão de quem não pode marcar OFF');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  -- "Proposta" perdeu a linha do admin na matriz, na seção 1: é ela que prova
  -- que administrador e sócio não dependem de concessão. A etapa "Fechado" saiu
  -- deste assert na 0110 — nascer numa etapa de desfecho VENDIDO não é possível
  -- para ninguém, admin inclusive, e é a seção 6 que cobra isso (junto com o que
  -- a 0111 devolveu ao administrador na faixa do CCA).
  insert into public.deals (stage_id, created_by, status_detail)
  values (v_prop, adm, 'OFF');
  reset role;

  perform pg_temp.check98(
    exists (select 1 from public.deals where created_by = adm and status_detail = 'OFF'),
    'administrador cria negócio em etapa sem linha na matriz, inclusive já em OFF');
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Catálogo: um código para a regra que sobrou, nenhum para a etapa
-- -----------------------------------------------------------------------------
\echo '== 4. catálogo de permissões =='

do $$
begin
  perform pg_temp.check98(
    not exists (select 1 from public.permissions where code = 'deals.edit_stage'),
    'deals.edit_stage saiu do catálogo: a autorização de etapa é a matriz');

  perform pg_temp.check98(
    not exists (select 1 from public.role_permissions where permission in ('deals.edit_stage', 'deals.edit_status')),
    'nenhuma concessão órfã sobrou dos dois códigos antigos');

  perform pg_temp.check98(
    exists (select 1 from public.permissions where code = 'deals.mark_off_distrato'),
    'deals.mark_off_distrato existe e diz, no rótulo, o que decide');

  perform pg_temp.check98(
    exists (select 1 from public.role_permissions
             where permission = 'deals.mark_off_distrato' and role = 'partner' and allowed),
    'o sócio aparece com a permissão na tela, e não só por curto-circuito');
end
$$;

-- -----------------------------------------------------------------------------
-- 5. O desfecho (`outcome`) vem da ETAPA, nunca do cliente HTTP — 0102
-- -----------------------------------------------------------------------------
-- A 0101 travou `stage_id`, `status_detail` e `lost_reason` e deixou `outcome`
-- solto. É `outcome` que decide venda em `deals_award_points` (0060) e no VGV
-- (`dealCategory`, src/components/dashboard/data.ts): um PATCH de uma chave só,
-- sem tocar na etapa, punha o negócio parado em "Proposta" contando como VENDA.
\echo '== 5. o desfecho vem da etapa =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000000981';
  cor uuid := '00000000-0000-0000-0000-000000000982';
  v_prop   uuid;
  v_visita uuid;
  v_lost   uuid;
  v_deal   uuid;
  v_mentira uuid;
  v_nasce  uuid;
  v_seed   uuid;
  v_venda  uuid;
  v_patch  boolean;
begin
  select id into v_prop   from public.pipeline_stages where code = 'proposal';
  select id into v_visita from public.pipeline_stages where code = 'visit_scheduled';
  select id into v_lost   from public.pipeline_stages where code = 'lost';

  insert into public.deals (stage_id, created_by) values (v_prop, cor)
  returning id into v_deal;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- O FURO, ao pé da letra: `outcome` (e o `closed_at` que a constraint
  -- `deals_closed_consistency` exige junto) sem mexer em `stage_id`.
  v_patch := false;
  begin
    update public.deals set outcome = 'won', closed_at = now() where id = v_deal;
  exception when insufficient_privilege then
    v_patch := true;
  end;
  reset role;

  perform pg_temp.check98(
    v_patch and (select outcome::text from public.deals where id = v_deal) = 'open',
    'corretor NÃO grava outcome=won por PATCH direto: o negócio segue open');

  -- A DERIVAÇÃO continua funcionando, e é o fluxo do LoseDealDialog inteiro:
  -- etapa + Status 2 + motivo, sem mandar `outcome` nenhum.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals
     set stage_id = v_lost, status_detail = '19. REPROVADO',
         lost_reason = '19. REPROVADO — cliente sumiu'
   where id = v_deal;
  reset role;

  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_deal) = 'lost'
      and (select closed_at from public.deals where id = v_deal) is not null,
    'encerrar pela etapa continua derivando outcome=lost e preenchendo closed_at');

  -- Etapa E `outcome` mentiroso no MESMO PATCH: `deals_guard_stage` roda antes e
  -- sobrescreve, então a derivação vence e o pedido não é recusado — é o caso
  -- que a 0100 quebrou ao cobrar o valor que o próprio banco tinha escrito.
  insert into public.deals (stage_id, created_by) values (v_prop, cor)
  returning id into v_mentira;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set stage_id = v_visita, outcome = 'won', closed_at = now()
   where id = v_mentira;

  -- INSERT: `deals_guard_stage` é `before update` e nunca viu um POST, então até
  -- a 0102 o negócio NASCIA com o desfecho que o cliente digitasse.
  insert into public.deals (stage_id, created_by, outcome, closed_at)
  values (v_prop, cor, 'won', now())
  returning id into v_nasce;
  reset role;

  perform pg_temp.check98(
    (select stage_id from public.deals where id = v_mentira) = v_visita
      and (select outcome::text from public.deals where id = v_mentira) = 'open'
      and (select closed_at from public.deals where id = v_mentira) is null,
    'mandar outcome junto com a troca de etapa não quebra: a derivação vence');

  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_nasce) = 'open'
      and (select closed_at from public.deals where id = v_nasce) is null,
    'negócio não NASCE vendido: no INSERT o outcome também sai da etapa');

  -- Admin continua podendo o que precisa: endireitar à mão uma linha torta
  -- (import antigo, correção pontual) sem mover o negócio de etapa.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set outcome = 'cancelled', closed_at = now()
   where id = v_nasce;

  -- E o negócio que NASCE numa etapa de desfecho nasce coerente, em vez de
  -- ficar `open` nela. "Perdido", e não "Fechado": desde a 0110 nascer em
  -- "Fechado" exige a conferência aprovada, que nenhum POST consegue forjar —
  -- é a seção 6. A derivação é a mesma nas duas.
  insert into public.deals (stage_id, created_by) values (v_lost, adm)
  returning id into v_venda;
  reset role;

  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_nasce) = 'cancelled',
    'administrador corrige o desfecho à mão sem trocar a etapa');
  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_venda) = 'lost'
      and (select closed_at from public.deals where id = v_venda) is not null,
    'negócio criado numa etapa de desfecho nasce com o outcome dela e com closed_at');

  -- FLUXO AUTOMÁTICO NÃO BARRADO. Sem `set role`, `current_user` é `postgres` —
  -- o mesmo escape de `service_role` que a API REST do import do Bubble
  -- (scripts/import/03-negocios.mjs) e toda função `security definer` usam.
  -- Aqui o desfecho é escolhido de propósito, inclusive divergindo da etapa.
  update public.deals set outcome = 'won', closed_at = now() where id = v_mentira;

  insert into public.deals (stage_id, created_by, outcome, closed_at)
  values (v_prop, cor, 'lost', now())
  returning id into v_seed;

  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_mentira) = 'won',
    'postgres/service_role continuam gravando outcome sem trocar etapa (seed, import, security definer)');
  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_seed) = 'lost',
    'no INSERT do seed/import o outcome escolhido NÃO é sobrescrito pela derivação');
end
$$;

-- -----------------------------------------------------------------------------
-- 6. O nascimento do negócio: conferência, desfecho e closed_at — 0110 + 0111
-- -----------------------------------------------------------------------------
-- A 0102 fez o INSERT derivar `outcome` da etapa e, sem querer, abriu o atalho:
-- criado DIRETO em "Fechado", o negócio nascia `won` + `closed_at` sem ter
-- passado pela conferência do gerente. As exigências documentais vivem em
-- `deals_guard_stage`, que é `before update` e nunca viu um POST.
--
-- A 0110 fechou o atalho cobrando a mesma função na FAIXA INTEIRA do CCA, e com
-- isso recusou também o cadastro de um negócio que já está em análise — para
-- todos, administrador inclusive. A 0111 separa as duas exigências que moravam
-- juntas: o desfecho VENDIDO não tem exceção de papel nenhuma; a faixa do CCA
-- tem, e só de administrador e sócio; e `requires_document` não é cobrado no
-- nascimento, porque documento se anexa a negócio que já existe.
\echo '== 6. o INSERT respeita a conferência, e closed_at não é campo livre =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000000981';
  cor uuid := '00000000-0000-0000-0000-000000000982';
  v_closed   uuid;
  v_analise  uuid;
  v_inicial  uuid;
  v_won_novo uuid;
  v_cadastro uuid;
  v_venda    uuid;
  v_import   uuid;
  v_antes    timestamptz;
  v_corretor_analise boolean;
  v_admin_fechado    boolean;
  v_sem_flag         boolean;
  v_etapa_nova       boolean;
  v_forjou           boolean;
  v_data_corretor    boolean;
begin
  select id into v_closed  from public.pipeline_stages where code = 'closed';
  select id into v_analise from public.pipeline_stages where code = 'under_analysis';
  select id into v_inicial from public.pipeline_stages where is_initial;

  -- (a) O CADASTRO QUE A 0110 TIROU SEM QUERER, de volta (0111): administrador
  -- cria negócio já em "Em Análise" — migrar negócio que veio de fora, corrigir
  -- cadastro torto. Nasce `open` e com a conferência em 'draft': é cadastro, não
  -- venda, e o dossiê continua tendo de ser conferido para o negócio fechar.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.deals (stage_id, created_by) values (v_analise, adm)
  returning id into v_cadastro;
  reset role;

  perform pg_temp.check98(
    (select stage_id from public.deals where id = v_cadastro) = v_analise
      and (select outcome::text from public.deals where id = v_cadastro) = 'open'
      and (select document_review_status from public.deals where id = v_cadastro) = 'draft',
    'administrador cadastra negócio já em "Em Análise", em etapa que exige documento');

  -- (b) E a exceção é DE PAPEL, não uma reabertura da faixa: mesmo com a casa
  -- concedida na matriz, o corretor continua recusado — nascer em "Em Análise"
  -- é o desvio da conferência do gerente, que é o que a 0028 guarda.
  insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
  values (v_analise, 'broker', true, true)
  on conflict (stage_id, role) do update set can_enter = true;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_corretor_analise := false;
  begin
    insert into public.deals (stage_id, created_by) values (v_analise, cor);
  exception when raise_exception then
    v_corretor_analise := true;
  end;
  reset role;

  -- Devolve a casa: a faixa do CCA não é do corretor, e esta matriz é lida
  -- pelas seções seguintes e pelos outros arquivos de teste.
  update public.stage_permissions sp set can_enter = false
   where sp.stage_id = v_analise and sp.role = 'broker';

  perform pg_temp.check98(v_corretor_analise,
    'corretor com a casa concedida ainda não cria negócio na faixa do CCA: a exceção é de administrador');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- (c) NASCER EM "FECHADO" — o atalho da 0102, fechado e sem exceção de papel.
  -- É o ADMIN quem tenta: para o corretor a matriz já negava antes (42501,
  -- seção 3), e o que este assert precisa provar é a exigência DOCUMENTAL. Por
  -- isso o sqlstate esperado é P0001, e não 42501.
  v_admin_fechado := false;
  begin
    insert into public.deals (stage_id, created_by) values (v_closed, adm);
  exception when raise_exception then
    v_admin_fechado := true;
  end;
  reset role;

  -- (d) E a recusa não pendura em dado configurável. A 0111 diz a regra pelo
  -- DESFECHO da etapa: desligar `requires_document` em "Fechado" — dois cliques
  -- em Admin · Permissões → Etapas — não abre o nascimento da venda.
  update public.pipeline_stages set requires_document = false where id = v_closed;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_sem_flag := false;
  begin
    insert into public.deals (stage_id, created_by) values (v_closed, adm);
  exception when raise_exception then
    v_sem_flag := true;
  end;
  reset role;

  update public.pipeline_stages set requires_document = true where id = v_closed;

  -- (e) NEM POR UMA ETAPA NOVA. A 0110 escrevia a regra como uma lista de quatro
  -- códigos: uma etapa de fechamento criada em Admin · Pipeline, com código fora
  -- da lista e sem `requires_document`, passava pelas duas checagens dela e o
  -- negócio nascia `won`. A 0111 pergunta pelo `outcome` da etapa, e a porta
  -- deixa de existir.
  insert into public.pipeline_stages
    (code, label, position, outcome, requires_document, is_initial)
  values ('closed_0111', 'Fechado (etapa nova)', 199, 'won', false, false)
  returning id into v_won_novo;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_etapa_nova := false;
  begin
    insert into public.deals (stage_id, created_by) values (v_won_novo, adm);
  exception when raise_exception then
    v_etapa_nova := true;
  end;

  -- (f) E não adianta forjar a aprovação no mesmo POST: a trava da conferência
  -- (0028) também era só `before update`. Sem esta metade, (c) seria teatro.
  v_forjou := false;
  begin
    insert into public.deals (stage_id, created_by, document_review_status)
    values (v_inicial, adm, 'approved');
  exception when insufficient_privilege then
    v_forjou := true;
  end;
  reset role;

  -- O `delete` é parte do assert: se (e) tivesse gravado o negócio, a FK
  -- `deals_stage_id_fkey` (on delete restrict) recusaria apagar a etapa.
  delete from public.pipeline_stages where id = v_won_novo;

  perform pg_temp.check98(v_admin_fechado,
    'negócio não NASCE em "Fechado" sem a conferência aprovada — nem pela mão do administrador');
  perform pg_temp.check98(v_sem_flag,
    'nem com requires_document desligado em "Fechado": quem recusa é o desfecho da etapa');
  perform pg_temp.check98(v_etapa_nova,
    'nem numa etapa de fechamento NOVA, de código fora da faixa do CCA: a regra é outcome=won');
  perform pg_temp.check98(v_forjou,
    'o POST não forja document_review_status: a conferência não nasce aprovada');
  perform pg_temp.check98(
    not exists (
      select 1
        from public.deals d
        join public.pipeline_stages s on s.id = d.stage_id
       where d.created_by = adm
         and (s.outcome = 'won' or d.document_review_status <> 'draft')),
    'o buraco original segue fechado: nada que o administrador criou nasceu vendido nem com a conferência forjada');

  -- (g) CRIAÇÃO NORMAL segue passando: a etapa inicial não exige documento nem
  -- conferência. É o fluxo do DealDetailModal e do `convert_lead_to_deal`, e é
  -- o que quebraria se a exigência tivesse sido escrita larga demais.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.deals (stage_id, created_by) values (v_inicial, cor);
  reset role;

  -- (h) ESCAPE INTACTO: sem `set role`, `current_user` é `postgres` — o mesmo
  -- caminho de `service_role` que o import do Bubble (0096,
  -- scripts/import/03-negocios.mjs) e os seeds usam. O negócio importado nasce
  -- fechado, com a conferência já resolvida, sem passar por nada disto.
  insert into public.deals (stage_id, created_by, document_review_status,
                            outcome, closed_at)
  values (v_closed, adm, 'approved', 'won', now() - interval '90 days')
  returning id into v_import;

  perform pg_temp.check98(
    exists (select 1 from public.deals d
             where d.created_by = cor and d.stage_id = v_inicial
               and d.document_review_status = 'draft'),
    'corretor continua criando negócio na etapa inicial, sem conferência nenhuma');
  perform pg_temp.check98(
    (select outcome::text from public.deals where id = v_import) = 'won',
    'import e seed continuam criando negócio fechado direto (escape postgres/service_role)');

  -- (i) closed_at NO UPDATE — o defeito que sobrou da 0102: a coluna que decide
  -- em qual temporada a venda conta (0060 filtra `closed_at::date` entre
  -- `period_start` e `period_end`) não tinha guarda nenhuma. O negócio abaixo já
  -- é uma venda de verdade; mover a data é torcer o ranking, não criar venda.
  insert into public.deals (stage_id, created_by, document_review_status,
                            outcome, closed_at, vgv_gross)
  values (v_closed, cor, 'approved', 'won', now(), 500000)
  returning id into v_venda;
  select closed_at into v_antes from public.deals where id = v_venda;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_data_corretor := false;
  begin
    update public.deals set closed_at = now() - interval '120 days' where id = v_venda;
  exception when insufficient_privilege then
    v_data_corretor := true;
  end;
  reset role;

  perform pg_temp.check98(
    v_data_corretor
      and (select closed_at from public.deals where id = v_venda) = v_antes,
    'corretor não desloca a data de fechamento por PATCH direto: a temporada da venda fica onde está');

  -- O administrador continua endireitando à mão, como já podia com `outcome`.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set closed_at = v_antes - interval '1 day' where id = v_venda;
  reset role;

  perform pg_temp.check98(
    (select closed_at from public.deals where id = v_venda) < v_antes,
    'administrador corrige a data de fechamento sem trocar a etapa');
end
$$;

\echo 'trava de etapa e desfecho ok'
