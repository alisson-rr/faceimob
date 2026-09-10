-- =============================================================================
-- Desfaz a Fase 6 (060_demo_showcase.sql)
--
-- Remove só o que a fase 6 criou — a faixa de UUID 80000000…8f000000 — e devolve
-- o que ela alterou ao estado anterior. As fases 1-5 ficam intactas.
--
-- NÃO é executado por `supabase db reset`: rode à mão quando quiser limpar.
--   node scripts/demo.mjs showcase:limpar [--remote]
--   psql "$DATABASE_URL" -f supabase/seeds/069_demo_showcase_rollback.sql
--
-- Ordem: filhos antes dos pais. Três dependências mandam na ordem e não podem
-- ser trocadas — todas são `on delete restrict` contra `profiles`:
--   `deal_participants`, `game_events`/`game_season_results` e `daily_entries`.
-- Apagar as pessoas do cenário antes dos negócios, dos pontos e do diário faria
-- o banco recusar a exclusão.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notificações
--
-- As do cenário têm UUID fixo. As outras nasceram do trigger
-- `notify_lead_assigned`, disparado pelos INSERTs de `lead_assignments`, com id
-- aleatório — o padrão fixo não as alcança. O link é determinístico
-- (`/leads/<uuid do lead>`), então a limpeza vai por ele.
-- -----------------------------------------------------------------------------
delete from public.notifications where id::text like '8e000000-%';
delete from public.notifications where link like '/leads/83000000-%';

-- As da conferência documental (BLOCO 5b, RPCs da 0028) também têm id
-- aleatório e link '/pipeline'; o título carrega o código do negócio, que
-- ainda existe neste ponto — por isso este bloco vem antes do item 5. Cobre
-- também a aprovação feita ao vivo na demonstração.
delete from public.notifications n
 where n.kind in ('document_review_requested', 'document_review_returned', 'document_review_approved')
   and exists (select 1 from public.deals d
                where d.id::text like '85000000-%' and n.title like '%' || d.code);

-- -----------------------------------------------------------------------------
-- 2. Agenda
-- -----------------------------------------------------------------------------
delete from public.tasks  where id::text like '8c000000-%';
delete from public.visits where id::text like '8d000000-%';

-- -----------------------------------------------------------------------------
-- 3. Pontuação
--
-- Os eventos de esforço têm UUID fixo; os de venda e aprovação vieram de
-- `award_game_points`, que gera id aleatório — esses são alcançados pelo
-- `ref_id`, que aponta para os negócios do cenário.
-- -----------------------------------------------------------------------------
delete from public.game_events where id::text like '8a000000-%';
delete from public.game_events where ref_type = 'deal' and ref_id::text like '85000000-%';

-- -----------------------------------------------------------------------------
-- 4. Temporadas
--
-- Apaga a temporada da demonstração (a cascata leva os eventos e o congelamento
-- dela) e REABRE a temporada anterior, que o 060 encerrou. Reabrir importa:
-- sem nenhuma temporada aberta, `award_game_points` passa a devolver null e o
-- jogo inteiro para de pontuar — o rollback deixaria o banco pior do que achou.
--
-- O mês da temporada da demo é lido ANTES da exclusão, porque é ele que
-- identifica qual das fechadas voltar a abrir.
-- -----------------------------------------------------------------------------
do $$
declare
  v_mes date;
  v_ant uuid;
begin
  select period_start into v_mes
    from public.game_seasons where id = '89000000-0000-0000-0000-000000000001';
  v_mes := coalesce(v_mes, public.month_start(current_date));

  delete from public.game_seasons where id = '89000000-0000-0000-0000-000000000001';

  if exists (select 1 from public.game_seasons where closed_at is null) then
    raise notice '[069] já existe temporada aberta — nada a reabrir.';
    return;
  end if;

  -- `period_end = v_mes - 1` e `closed_by is null` são a assinatura do
  -- fechamento feito pelo 060: quem fecha pela tela grava `closed_by`.
  select id into v_ant from public.game_seasons
   where closed_at is not null
     and closed_by is null
     and period_end = v_mes - 1
   order by period_start desc limit 1;

  if v_ant is null then
    raise notice '[069] não achei a temporada que o 060 fechou — nenhuma foi reaberta.';
    return;
  end if;

  delete from public.game_season_results where season_id = v_ant;
  update public.game_seasons
     set closed_at = null, period_end = null, closed_by = null
   where id = v_ant;

  raise notice '[069] temporada "%" reaberta.', (select label from public.game_seasons where id = v_ant);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Negócios e leads
--
-- A cascata de `deals` leva clientes, participantes, documentos, histórico,
-- casos do CCA, envios à construtora e visitas do negócio. A de `leads` leva
-- atribuições, eventos, comentários e visitas do lead.
--
-- A conferência documental do BLOCO 5b (os três documentos de cada um dos dois
-- negócios, o `pending`/`returned` e o histórico) vai junto: as colunas moram
-- em `deals` e os anexos `88000000-…-00003x/4x` caem pela cascata.
-- -----------------------------------------------------------------------------
delete from public.deals where id::text like '85000000-%';
delete from public.leads where id::text like '83000000-%';

-- -----------------------------------------------------------------------------
-- 6. Metas, marketing, diário, presença e consolidado
-- -----------------------------------------------------------------------------
delete from public.goals                 where id::text like '8b000000-%';
delete from public.marketing_investments where id::text like '8f000000-%';
delete from public.ad_campaigns          where id::text like '8f000000-%';
delete from public.annual_results        where id::text like '8f000000-%';
-- As entradas do diário vão pelo id próprio: quando a equipe já tinha relatório
-- do dia, o 060 gravou dentro DELE, e apagar só os relatórios `8f000000-%`
-- deixaria essas linhas para trás — o que trava a exclusão das pessoas do
-- cenário logo abaixo (`daily_entries.profile_id` é `on delete restrict`).
delete from public.daily_entries         where id::text like '8f000000-%';
delete from public.daily_reports         where id::text like '8f000000-%';   -- cascata: entradas restantes
delete from public.checkins              where id::text like '8f000000-%';

-- -----------------------------------------------------------------------------
-- 7. Usuário da demonstração volta ao estado anterior
--
-- Vem ANTES de apagar as pessoas do cenário porque as duas marcas que autorizam
-- este desfazer morrem junto com elas: o vínculo de equipe de UUID fixo e o
-- `user_roles.granted_by` apontando para o diretor do cenário (`on delete set
-- null`). Apagar as pessoas primeiro apagaria a prova.
--
-- Sem o vínculo de equipe do cenário, nada aqui é tocado — foi outra pessoa que
-- preparou este usuário. E o papel `broker` só sai se tiver sido ESTA fase a
-- conceder: todo usuário criado pelo Auth já nasce corretor, então tirar sem
-- olhar a marca cassaria um papel que já era dele.
--
-- ponytail: a saída da fila geral não tem marca própria (a tabela tem chave
-- composta, sem coluna de origem). Se o usuário já estivesse na fila antes, o
-- 060 não o inseriu, mas este bloco o remove. Recolocar é um clique em
-- Automação de leads; evoluir quando alguém precisar da distinção.
-- -----------------------------------------------------------------------------
do $$
declare v_demo uuid;
begin
  select p.id into v_demo from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'admin')
  order by
    (p.id::text not like '10000000-%' and p.email <> 'dev.alisson.rosa@gmail.com') desc,
    (p.email = 'dev.alisson.rosa@gmail.com') desc,
    p.created_at desc
  limit 1;

  if not exists (
    select 1 from public.team_members
     where id = '81000000-0000-0000-0000-000000000099' and profile_id = v_demo
  ) then
    raise notice '[069] o usuário % não foi preparado por esta fase — nada a devolver.',
      (select full_name from public.profiles where id = v_demo);
    return;
  end if;

  -- `profiles_guard_admin_columns` exige `is_admin()` para mexer em
  -- `bypass_ip_check`. Num psql não há JWT, então o bloco assume a identidade do
  -- próprio usuário (que É admin) em vez de desligar a trava — desligar a
  -- removeria para todo mundo enquanto o script roda.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_demo::text, 'role', 'authenticated')::text, true);
  update public.profiles set bypass_ip_check = false where id = v_demo;

  delete from public.user_roles
   where profile_id = v_demo and role = 'broker'
     and granted_by = '80000000-0000-0000-0000-000000000010';

  delete from public.distribution_group_members
   where profile_id = v_demo
     and group_id in (select id from public.distribution_groups where kind = 'general');

  raise notice '[069] usuário da demonstração devolvido ao estado anterior: %',
    (select full_name from public.profiles where id = v_demo);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Equipes e pessoas do cenário
--
-- Apagar `auth.users` cascateia para `profiles` e daí para papéis, presença,
-- notificações, tarefas, metas e vínculos de equipe e de fila.
-- -----------------------------------------------------------------------------
delete from public.team_members where id::text like '81000000-%';
delete from public.teams        where id::text like '82000000-%';

delete from auth.identities where user_id::text like '80000000-%';
delete from auth.users      where id::text like '80000000-%';

-- -----------------------------------------------------------------------------
-- 9. Foto de perfil: só as URLs que o 060 escreveu
-- -----------------------------------------------------------------------------
update public.profiles
   set avatar_url = null
 where avatar_url like 'https://api.dicebear.com/9.x/initials/svg?seed=%';

do $$
begin
  raise notice '';
  raise notice '[069] Cenário de demonstração removido. Fases 1-5 preservadas.';
  raise notice '[069] Restaram do cenário: % leads · % negócios · % pessoas · % eventos de jogo',
    (select count(*) from public.leads   where id::text like '83000000-%'),
    (select count(*) from public.deals   where id::text like '85000000-%'),
    (select count(*) from public.profiles where id::text like '80000000-%'),
    (select count(*) from public.game_events where id::text like '8a000000-%');
end $$;
