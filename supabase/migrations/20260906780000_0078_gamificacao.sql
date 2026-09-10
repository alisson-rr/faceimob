-- =============================================================================
-- 0078 · Gamificação: a esteira volta a pontuar, e o ponto descartado avisa
--        quem perdeu
--
-- O inventário de 06/09 mediu a pontuação automática em 81% e achou duas
-- coisas, ambas da mesma família dos defeitos que a 0060 corrigiu para `deals`:
--
-- 1. **A regra `esteira` (140 pts) NUNCA disparou pelo caminho real.**
--    `cca_award_points` é `after update` desde a 0010, e
--    `submit_deal_for_analysis` (0028) cria o caso com
--
--        insert into public.cca_cases (deal_id, status, submitted_at)
--        values (p_deal_id, 'under_review', now())
--        on conflict (deal_id) do update set status = 'under_review', …
--
--    A PRIMEIRA submissão de um negócio é um INSERT — o gatilho não roda, e o
--    corretor que mandou o dossiê para a esteira ganha zero. Só a resubmissão
--    (a que cai no `do update`) pontuava, o que é o avesso do que a regra diz.
--    Medido no remoto antes desta migration: 12 casos em `cca_cases`, 19
--    eventos `esteira` e apenas 2 `ref_id` distintos — e esses dois são semente.
--    O comentário do seed 060 já registrava o sintoma ("`cca_award_points` é
--    `after update`, então INSERT direto não…") sem que ninguém tivesse
--    corrigido a causa.
--
--    É EXATAMENTE o item 3 da 0060 (`deals_award_points` era AFTER UPDATE e o
--    negócio que nascia ganho nunca pontuava), deixado aberto para `cca_cases`.
--    O conserto é o mesmo: `after insert or update`, com a guarda de `tg_op`
--    que `deals_award_points` já usa — em PL/pgSQL `OLD` não está atribuído num
--    gatilho de INSERT, e `and`/`or` não garantem curto-circuito, então a
--    decisão sai de um `if` de STATEMENT e não de uma expressão só.
--
--    Não repontua o passado: os 10 casos que entraram na esteira sem evento
--    continuam sem ele. Reescrever placar de temporada encerrada é o que
--    `game_season_results` existe para impedir, e na temporada aberta um evento
--    retroativo apareceria como ponto de um fato que ninguém viu acontecer.
--
--    **Consequência para os SEEDS, que inserem `cca_cases` direto.** O gatilho
--    passa a pontuar esses INSERTs, e três lugares contam com o contrário:
--      · `seeds/060_demo_showcase.sql:608-612` — o cabeçalho do BLOCO 6 afirma
--        "`cca_award_points` é `after update`, então INSERT direto não pontua";
--        com esta migration a frase fica falsa e o BLOCO 6 (3 `under_review` +
--        6 `approved`) pontua ANTES do BLOCO 7, na mesma temporada — a de
--        `seed.sql:130` já está aberta e o BLOCO 7 não encerra nada;
--      · `seeds/030_commercial_operation.sql:288` + `040_…:95` — o caso
--        `approved` do negócio 5000…0001 gera `aprovado` com
--        `ref_type='deal'`, e a linha manual do 040 grava o MESMO `aprovado`
--        com `ref_type='cca_case'`: `game_events_dedupe_idx` não colapsa os
--        dois, e o corretor 1000…0005 fica com 250 pontos em dobro.
--    Nada disso duplica em reaplicação (`on conflict do nothing` + o índice de
--    dedupe), e nada disso é defeito DESTA função — é o seed que precisa
--    escolher a fonte única dos pontos de `esteira`/`aprovado`. Registrado como
--    pendência para o dono de `supabase/seeds/` em 06/09; até lá, o número do
--    placar da demonstração fica diferente do que o comentário do seed promete.
--
-- 2. **Ponto perdido com o jogo parado só ia para o log do Postgres.** A 0060
--    trocou o silêncio por `raise warning`, que é auditável DEPOIS e por quem
--    tem acesso ao log do banco — não pelo corretor que acabou de fechar a
--    venda. A tela da Gamificação avisa "Jogo parado", mas quem está no
--    Pipeline não passa por ela.
--
--    Decisão de 06/09, seguindo a recomendação do inventário: **o ponto
--    continua descartado** (recuperar retroativamente encheria a temporada nova
--    de pontos de fatos que ninguém viu) e o aviso passa a existir na hora, no
--    sino — que é o canal que já alcança o corretor em QUALQUER tela, sem
--    depender de a venda ter sido fechada pelo Pipeline, pela importação de
--    planilha ou pela correção do admin. Um aviso NÃO LIDO por pessoa: repetir
--    a mesma frase a cada documento anexado viraria ruído, e a frase é sempre a
--    mesma ("não há temporada aberta").
--
-- Idempotente: `create or replace`, `drop trigger … if exists`, nenhuma escrita
-- de dado. Aplicar duas vezes não muda nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A esteira pontua na entrada do dossiê, não só na resubmissão
-- -----------------------------------------------------------------------------
create or replace function public.cca_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker   uuid;
  v_aprovado boolean := false;
  v_esteira  boolean := false;
begin
  -- Mesmo desenho de `deals_award_points` (0060): `OLD` não existe no INSERT,
  -- então o `if` é de statement. No INSERT o estado já É a transição — o caso
  -- nasce direto em `under_review` quando `submit_deal_for_analysis` roda pela
  -- primeira vez.
  if tg_op = 'INSERT' then
    v_aprovado := (new.status = 'approved');
    v_esteira  := (new.status = 'under_review');
  else
    v_aprovado := (new.status = 'approved'     and old.status is distinct from 'approved');
    v_esteira  := (new.status = 'under_review' and old.status is distinct from 'under_review');
  end if;

  if v_aprovado then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.deal_id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'aprovado', 'deal', new.deal_id, now());
    end loop;
  end if;

  if v_esteira then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.deal_id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'esteira', 'deal', new.deal_id, now());
    end loop;
  end if;

  return null;
end;
$$;

comment on function public.cca_award_points() is
  'Pontua esteira (entrada no CCA) e aprovado (decisão do analista). INSERT ou '
  'UPDATE desde a 0078: submit_deal_for_analysis CRIA o caso já em under_review, '
  'e o gatilho só de UPDATE deixava a primeira submissão — o caminho real — sem '
  'pontuar. Idempotente por negócio pelo game_events_dedupe_idx.';

-- O grant default do Supabase dá EXECUTE a `anon` em toda função nova de
-- `public`, inclusive em função de gatilho. É o tripwire do 06_anon_surface.sql.
revoke all on function public.cca_award_points() from public, anon, authenticated;

drop trigger if exists cca_award_points on public.cca_cases;
create trigger cca_award_points
  after insert or update on public.cca_cases
  for each row execute function public.cca_award_points();

-- -----------------------------------------------------------------------------
-- 2. Jogo parado: o ponto continua descartado, mas quem perdeu fica sabendo
-- -----------------------------------------------------------------------------
-- Corpo idêntico ao da 0060 — só o ramo `v_season is null` ganhou o aviso. O
-- `raise warning` fica: ele é o rastro auditável de quem opera o banco, e o
-- sino é o aviso de quem opera o produto.
--
-- Por que o sino, e não um toast no Pipeline: `award_game_points` é chamada por
-- CINCO gatilhos (venda, distrato, esteira, aprovado, incompleto_com_doc) e por
-- caminhos que nem passam por tela (importação de planilha, seed, correção
-- direta). Avisar em cada chamador seria a quinta cópia da mesma regra; aqui é
-- uma só, no ponto por onde todos passam.
create or replace function public.award_game_points(
  p_profile_id uuid,
  p_event_code text,
  p_ref_type   text default null,
  p_ref_id     uuid default null,
  p_occurred   timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid := public.current_game_season();
  v_points int;
  v_id     uuid;
  v_label  text;
begin
  if v_season is null then
    raise warning 'award_game_points: jogo parado, ponto descartado (perfil=%, evento=%, ref=%)',
      p_profile_id, p_event_code, p_ref_id;

    -- Um aviso NÃO LIDO por pessoa. Sem esta guarda, anexar cinco documentos
    -- com o jogo parado enchia o sino com a mesma frase cinco vezes — e a
    -- frase não depende do evento: o que aconteceu é que não há temporada.
    if p_profile_id is not null and not exists (
      select 1 from public.notifications n
      where n.profile_id = p_profile_id
        and n.kind = 'game_paused'
        and n.read_at is null
    ) then
      -- O rótulo sai da regra, como em toda a tela: `scoring_points` prefere a
      -- regra da temporada sobre a padrão, e aqui não há temporada — então só
      -- a padrão (`season_id is null`) faz sentido. Sem regra cadastrada, o
      -- próprio código do evento.
      select r.label into v_label
      from public.game_scoring_rules r
      where r.event_code = p_event_code and r.season_id is null
      limit 1;

      insert into public.notifications (profile_id, kind, title, body, link, channel)
      values (
        p_profile_id,
        'game_paused',
        'Jogo parado: este movimento não pontuou',
        format(
          '%s aconteceu sem temporada aberta e não entrou no placar. O ponto não é recuperado quando a próxima temporada abrir — peça ao administrador para abrir o jogo.',
          coalesce(v_label, p_event_code)
        ),
        '/gamification',
        'in_app'
      );
    end if;

    return null;
  end if;

  v_points := public.scoring_points(v_season, p_event_code);
  if v_points is null then
    raise warning 'award_game_points: evento sem regra ativa, ponto descartado (evento=%, ref=%)',
      p_event_code, p_ref_id;
    return null;
  end if;

  insert into public.game_events (season_id, profile_id, event_code, points,
                                  ref_type, ref_id, occurred_at)
  values (v_season, p_profile_id, p_event_code, v_points, p_ref_type, p_ref_id, p_occurred)
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.award_game_points is
  'Pontua um evento na temporada aberta. Sem temporada, o ponto é DESCARTADO '
  '(decisão de 06/09: não há recuperação retroativa) e o corretor recebe um '
  'aviso no sino — um não lido por pessoa, kind game_paused.';
