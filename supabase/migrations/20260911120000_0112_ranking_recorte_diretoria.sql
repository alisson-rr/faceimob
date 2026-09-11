-- =============================================================================
-- 0112 · O recorte do diretor no placar sai da tela e entra no banco
--
-- Regra do cliente: "diretor vê de todos q ele é diretor" — a diretoria dele,
-- não a casa. Ela já estava escrita, em React: `podioDoRanking`
-- (`src/components/PipelineTopRanking.tsx`) filtrava o pódio por
-- `broker.director_id` DEPOIS que os dados chegaram. Mas
-- `can_see_game_profile` (0060) libera o diretor por `can_read_all()` —
-- `has_any_role('admin','director','partner')` —, então `visible_game_ranking`
-- entrega o placar de TODA a empresa ao navegador dele e o JavaScript apenas
-- esconde. Abrir a aba de rede devolve pontos, VGV e vendas de quem não é dele.
-- Isso é exposição de dado, não detalhe de UI — o mesmo defeito que a 0109
-- fechou no diário, na mesma semana.
--
-- ── POR QUE AQUI, E NÃO EM `can_read_all()` ────────────────────────────────
--
-- `can_read_all()` continua intocada, pelo motivo medido na 0109: ela tem cinco
-- consumidores (negócio, meta, produto, ranking, diário) e estreitá-la tiraria
-- do diretor, no mesmo commit, o pipeline e as metas da casa — que o cliente
-- não pediu. O estreitamento vale só para o placar, e é por isso que ele mora
-- dentro de `can_see_game_profile`, a função que a 0060 criou justamente para
-- ser a FONTE ÚNICA do escopo do jogo.
--
-- Consumidores levantados antes de mexer (`grep -rn can_see_game_profile`):
--   · `visible_game_ranking(uuid)` e `(uuid,date,date)` — 0060 e 0107;
--   · policy `game_events_select`            — 0060;
--   · policy `game_season_results_select`    — 0060.
-- Os três QUEREM o aperto: são as três portas para o mesmo placar. Nenhuma
-- outra função, policy, edge function ou tela chama esta função.
--
-- ── O QUE MUDA ─────────────────────────────────────────────────────────────
--
-- `can_read_all()` vira `has_any_role('admin','partner')`. O diretor passa a
-- entrar pelo ramo que já existia, `auth_visible_profiles()`, que para ele é
-- "ele mesmo + os membros ativos das equipes que ele dirige"
-- (`auth_led_team_ids()`, 0002). Os ramos do gerente e do corretor não são
-- tocados: gerente continua vendo quem lidera e corretor os colegas de equipe
-- ativa. Sócio segue junto do administrador (0099).
--
-- As DUAS policies do jogo não precisam de edição: as duas já chamam
-- `can_see_game_profile`, então apertam junto. O `do $$` no fim cobra isso.
--
-- ── CONSEQUÊNCIAS ASSUMIDAS ────────────────────────────────────────────────
--
--   · `auth_led_team_ids()` exige `teams.active`. Diretor de equipe DESATIVADA
--     deixa de ver o placar dela — hoje ele o alcançava por `can_read_all()`.
--     É a mesma regra que o gerente vive desde a 0060 e o diário desde a 0109.
--   · Diretor sem `teams.director_id` apontando para ele fica só com a própria
--     linha. O cartão do Pipeline já tem o estado vazio explicado.
--   · `game_events_select` continua com o ramo `event_code = 'venda'` aberto a
--     toda a casa, DE PROPÓSITO: é o INSERT dessa linha que o realtime do
--     `EngagementLayer` escuta para tocar a fanfarra da venda (ata de 14/07).
--     Ele não revela placar — `visible_game_ranking` e o congelado continuam
--     recortados —, mas revela que houve uma venda e de quem. Fechar esse ramo
--     é decisão de produto separada, e o assert do 98 cobra o comportamento
--     como ele é para ninguém descobrir isso por acidente.
--   · A tela do congelado (`src/pages/Gamification.tsx`) rotula o diretor como
--     "Campeões gerais" e passa `keepUnknown: true` para ele. Com o aperto, o
--     que ele lê é a diretoria dele — o rótulo fica errado e precisa acompanhar
--     esta migration.
--
-- Idempotente: só `create or replace` e `comment`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O escopo do placar deixa de tratar diretor como administrador
-- -----------------------------------------------------------------------------
create or replace function public.can_see_game_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    -- Era a leitura ampla da casa, que inclui 'director' (ver o cabecalho desta
    -- migration). O diretor agora entra pelo ramo de baixo, recortado pelas
    -- equipes que ele dirige. O nome daquela funcao NAO pode aparecer aqui
    -- dentro: o bloco de verificacao abaixo le `pg_get_functiondef`, que devolve
    -- o corpo COM os comentarios, e citar o nome faria a guarda acusar a si
    -- mesma.
    public.has_any_role('admin', 'partner')
    or p_profile_id in (select public.auth_visible_profiles())
    or (
      public.has_role('broker')
      and exists (
        select 1
        from public.team_members mine
        join public.team_members peer on peer.team_id = mine.team_id
        join public.teams t on t.id = mine.team_id and t.active
        where mine.profile_id = auth.uid()
          and mine.left_at is null
          and peer.profile_id = p_profile_id
          and peer.left_at is null
      )
    )
  );
$$;

comment on function public.can_see_game_profile(uuid) is
  'Escopo do placar: admin/sócio veem todos; diretor vê as equipes ATIVAS que '
  'dirige; gerente vê quem lidera; corretor vê os colegas de equipe ativa e a '
  'si mesmo. Fonte única — visible_game_ranking e as policies de '
  'game_events/game_season_results usam esta. Diretor NÃO passa mais por '
  'can_read_all() (0112).';

comment on table public.game_season_results is
  'Ranking congelado da temporada. Mesmo escopo do ranking vivo '
  '(can_see_game_profile): desde a 0112 o diretor lê o congelado da diretoria '
  'dele, e só admin e sócio leem o da casa inteira.';

-- Verificação executável barata, no mesmo espírito da 0109: se um
-- `create or replace` futuro reintroduzir `can_read_all()` aqui, ou tirar
-- `can_see_game_profile` de uma das policies do jogo, a migration falha em vez
-- de devolver o placar da casa ao navegador do diretor. A prova de
-- COMPORTAMENTO (quem lê o quê, com `set local role authenticated`) está em
-- `supabase/tests/98_ranking_recorte_diretoria.sql`.
do $$
declare
  faltou text;
begin
  if pg_get_functiondef('public.can_see_game_profile(uuid)'::regprocedure) like '%can_read_all%' then
    raise exception '0112: can_see_game_profile voltou a passar por can_read_all()';
  end if;

  -- As duas têm de existir E sair da fonte única. Contar só as que divergem
  -- deixaria passar o caso pior: a policy apagada, que devolve zero linhas aqui
  -- e a tabela inteira lá.
  select string_agg(esperada, ', ')
    into faltou
    from unnest(array['game_events_select', 'game_season_results_select']) as esperada
   where not exists (
     select 1 from pg_policies
      where schemaname = 'public'
        and policyname = esperada
        and qual like '%can_see_game_profile%'
   );

  if faltou is not null then
    raise exception '0112: policy do jogo ausente ou fora da fonte única de escopo: %', faltou;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Na linha semanal, o VGV passa a ancorar no MESMO fato que a venda
-- -----------------------------------------------------------------------------
-- A 0107 recorta "vendas" por `game_events.occurred_at` e "vgv" por
-- `deals.closed_at`. São datas diferentes por construção: `occurred_at` é o
-- instante em que o gatilho pontuou (`now()` em `deals_award_points`, ou o
-- momento em que o corretor entrou no rateio de um negócio já ganho), enquanto
-- `closed_at` é a data de fechamento que o usuário digita. Um negócio fechado
-- na sexta e lançado na segunda cai em duas semanas — e a MESMA linha da tabela
-- semanal mostrava Vendas = 1 com VGV = 0, que qualquer um lê como bug de conta.
--
-- Alinhar é escolher UMA âncora, e a âncora do jogo é o EVENTO: é ele que paga
-- o prêmio da semana, é por ele que "vendas" e todos os outros códigos já são
-- contados. Então, quando há intervalo, o VGV soma os negócios cuja VENDA
-- pontuou dentro do intervalo. Vendas > 0 com VGV = 0 volta a significar o que
-- diz: negócio sem VGV, ou ponto lançado à mão pelo admin (sem `ref_id` de
-- negócio, o único caso que sobra — e aí não há valor para somar mesmo).
--
-- Sem intervalo (temporada inteira) NADA muda: continua sendo a soma por
-- `closed_at` dentro dos limites da temporada. Mexer nisso reescreveria o VGV
-- de temporada já fechada, que é exatamente o que a 0107 recusou fazer.
create or replace function public.visible_game_ranking(
  p_season_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  season_id uuid,
  profile_id uuid,
  full_name text,
  avatar_url text,
  active boolean,
  points int,
  sales int,
  vgv numeric,
  breakdown jsonb,
  team_id uuid,
  team_name text,
  manager_id uuid,
  manager_name text,
  director_id uuid,
  director_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with visible_brokers as (
    select p.id
    from public.profiles p
    where exists (
      select 1 from public.user_roles ur
      where ur.profile_id = p.id and ur.role = 'broker'
    )
      and public.can_see_game_profile(p.id)
  ),
  code_totals as (
    select
      e.profile_id,
      e.event_code,
      sum(e.points)::int as code_points,
      count(*) filter (where e.event_code = 'venda')::int as code_sales
    from public.game_events e
    where e.season_id = p_season_id
      -- Intervalo nulo = temporada inteira: é assim que a assinatura antiga
      -- continua devolvendo exatamente o que devolvia.
      and (p_from is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to   is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date <= p_to)
    group by e.profile_id, e.event_code
  ),
  scores as (
    select
      c.profile_id,
      sum(c.code_points)::int as points,
      sum(c.code_sales)::int as sales,
      jsonb_object_agg(c.event_code, c.code_points) as breakdown
    from code_totals c
    group by c.profile_id
  )
  select
    p_season_id,
    p.id,
    p.full_name,
    p.avatar_url,
    p.status = 'active',
    coalesce(s.points, 0),
    coalesce(s.sales, 0),
    coalesce(v.vgv, 0),
    coalesce(s.breakdown, '{}'::jsonb),
    team.id,
    team.name,
    team.manager_id,
    manager.full_name,
    team.director_id,
    director.full_name
  from visible_brokers vb
  join public.profiles p on p.id = vb.id
  left join scores s on s.profile_id = p.id
  left join lateral (
    select t.id, t.name, t.manager_id, t.director_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id and t.active
    where tm.profile_id = p.id and tm.left_at is null
    order by tm.joined_at, t.name
    limit 1
  ) team on true
  left join public.profiles manager on manager.id = team.manager_id
  left join public.profiles director on director.id = team.director_id
  left join lateral (
    select sum(d.vgv_net * dp.share_pct / 100) as vgv
    from public.deal_participants dp
    join public.deals d on d.id = dp.deal_id
    join public.game_seasons gs on gs.id = p_season_id
    where dp.profile_id = p.id
      and dp.role = 'broker'
      and d.outcome = 'won'
      and d.closed_at::date >= gs.period_start
      and d.closed_at::date <= coalesce(gs.period_end, current_date)
      and (
        (p_from is null and p_to is null)
        -- Com intervalo, quem manda é a data do PONTO da venda — a mesma que
        -- conta a coluna "vendas" ao lado. Ver o bloco acima.
        or exists (
          select 1
          from public.game_events e
          where e.season_id = p_season_id
            and e.profile_id = p.id
            and e.event_code = 'venda'
            and e.ref_type = 'deal'
            and e.ref_id = d.id
            and (p_from is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date >= p_from)
            and (p_to   is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date <= p_to)
        )
      )
  ) v on true;
$$;

comment on function public.visible_game_ranking(uuid, date, date) is
  'Ranking da temporada recortado por um intervalo de dias (America/Sao_Paulo). '
  'Intervalo nulo = temporada inteira, somando VGV por deals.closed_at. Com '
  'intervalo, pontos E VGV ancoram no mesmo fato: o evento de venda em '
  'game_events (0112). A visibilidade por papel continua sendo '
  'can_see_game_profile.';
