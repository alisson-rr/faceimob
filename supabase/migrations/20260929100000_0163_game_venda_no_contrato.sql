-- =============================================================================
-- 0163 — game: venda pontua no contrato, e a aba Game sai do corretor
--
-- Pedidos do cliente em 29/09/2026:
--
-- 1. "A pontuação do game já deve acontecer após virar contrato, depois do
--    virou negócio — não precisa fechar a venda para contar."
--
--    Até aqui a venda do jogo nascia só do DESFECHO (`outcome = 'won'`, etapa
--    Fechado). Agora ela nasce também quando o Status 1 do negócio vira VENDA
--    — "04. EM CONTRATO", "03. ASSINADO", "02. ASS. BANCO", "01. RC EMITIDA",
--    todos do grupo VENDA (0149). O resto da regra da 0142 fica igual:
--      · uma venda por corretor e negócio (dedupe de `award_game_points`):
--        contrato e depois Fechado não pontuam duas vezes;
--      · perder/cancelar depois de pontuar é distrato, e voltar a ganhar
--        desfaz o distrato da temporada aberta.
--    O "Vendas" do placar conta eventos `venda` (visible_game_ranking), então
--    passa a contar no contrato também. O resto do app (Dashboard, rankings do
--    Pipeline) segue contando venda pelo desfecho — não foi pedido mudar.
--
-- 2. "Corretores não devem ter acesso à aba de game; veem o game só com a
--    pontuação no popup do pipeline." `menu.gamification` sai do corretor. O
--    popup do Pipeline não depende dessa permissão (lê `visible_game_ranking`,
--    com o mesmo recorte de sempre).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O que conta como venda para o jogo
-- -----------------------------------------------------------------------------
create or replace function public.deal_counts_as_game_sale(p_outcome public.deal_outcome, p_status_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_outcome = 'won'
      or (p_outcome = 'open' and exists (
            select 1 from public.deal_status_groups g
             where g.id = p_status_group_id and g.code = 'VENDA'));
$$;

comment on function public.deal_counts_as_game_sale(public.deal_outcome, uuid) is
  'Para o jogo, é venda: desfecho ganho, ou negócio aberto com Status 1 VENDA (contrato, assinado…) (0163).';

revoke all on function public.deal_counts_as_game_sale(public.deal_outcome, uuid) from public, anon;
grant execute on function public.deal_counts_as_game_sale(public.deal_outcome, uuid) to authenticated, service_role;

create or replace function public.deals_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_broker uuid;
  v_points int;
  v_era    boolean;
  v_agora  boolean;
begin
  v_agora := public.deal_counts_as_game_sale(new.outcome, new.status_group_id);

  -- Negócio que nasce vendido pontua quem já estiver no rateio — em geral
  -- ninguém: o rateio entra depois e quem pontua é
  -- `deal_participants_award_points`. Nascer perdido não é distrato.
  if tg_op = 'INSERT' then
    if v_agora then
      for v_broker in
        select profile_id from public.deal_participants
        where deal_id = new.id and role = 'broker'
      loop
        perform public.award_game_points(v_broker, 'venda', 'deal', new.id, now());
      end loop;
    end if;
    return null;
  end if;

  -- O update mais comum não mexe em desfecho nem em Status 1: sai antes de ler o log.
  if new.outcome is not distinct from old.outcome
     and new.status_group_id is not distinct from old.status_group_id then
    return null;
  end if;

  v_era := public.deal_counts_as_game_sale(old.outcome, old.status_group_id);
  v_season := public.current_game_season();

  if v_agora and not v_era then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.id and role = 'broker'
    loop
      -- Venda já paga (nesta ou em temporada fechada) é recusada dentro de
      -- `award_game_points` — contrato e depois Fechado pontuam uma vez só.
      perform public.award_game_points(v_broker, 'venda', 'deal', new.id, now());

      -- Voltar a vender desfaz o distrato desta temporada (0142, item b).
      v_points := null;
      delete from public.game_events
       where season_id = v_season
         and profile_id = v_broker
         and event_code = 'distrato'
         and ref_type = 'deal'
         and ref_id = new.id
      returning points into v_points;

      if v_points is not null then
        insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
        values (new.id, auth.uid(), 'game_points_revoked', v_points::text, '0',
                jsonb_build_object('profile_id', v_broker, 'event_code', 'distrato'));
      end if;
    end loop;

  elsif new.outcome in ('lost', 'cancelled') and new.outcome is distinct from old.outcome then
    -- Quem é penalizado é quem tem a VENDA deste negócio na temporada aberta
    -- (0142, item a) — inclusive a que nasceu no contrato.
    for v_broker in
      select e.profile_id
      from public.game_events e
      where e.season_id = v_season
        and e.event_code = 'venda'
        and e.ref_type = 'deal'
        and e.ref_id = new.id
    loop
      perform public.award_game_points(v_broker, 'distrato', 'deal', new.id, now());
    end loop;
  end if;

  return null;
end;
$$;

comment on function public.deals_award_points() is
  'Pontua venda ao virar venda para o jogo (ganho OU Status 1 VENDA, 0163) e distrato ao virar perdido/'
  'cancelado para quem tem a venda do negócio na temporada aberta (0142). Voltar a vender retira o '
  'distrato da temporada aberta com rastro em deal_history. Distrato é penalidade, não estorno.';

-- O corretor que entra no rateio de um negócio já vendido ganha a venda — agora
-- também quando a venda do jogo é o contrato. Igual à 0142, só a condição muda.
create or replace function public.deal_participants_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_code   text;
begin
  if new.role <> 'broker' then
    return null;
  end if;

  if exists (select 1 from public.deals d
              where d.id = new.deal_id
                and public.deal_counts_as_game_sale(d.outcome, d.status_group_id)) then
    perform public.award_game_points(new.profile_id, 'venda', 'deal', new.deal_id, now());
  end if;

  -- Os outros três seguem os EVENTOS que o negócio já gerou na temporada
  -- aberta (0142, item d). Distrato não entra: ele só existe junto de uma
  -- venda, e quem chega a um negócio perdido não teve a venda.
  v_season := public.current_game_season();

  for v_code in
    select distinct e.event_code
    from public.game_events e
    where e.season_id = v_season
      and e.ref_type = 'deal'
      and e.ref_id = new.deal_id
      and e.event_code in ('esteira', 'aprovado', 'incompleto_com_doc')
  loop
    perform public.award_game_points(new.profile_id, v_code, 'deal', new.deal_id, now());
  end loop;

  return null;
end;
$$;

comment on function public.deal_participants_award_points() is
  'Corretor que entra no rateio pontua a venda se o negócio já é venda para o jogo (ganho ou '
  'Status 1 VENDA, 0163) e recebe os eventos de esteira, aprovado e incompleto_com_doc que o '
  'negócio já gerou na temporada aberta (0142). Idempotente pelo game_events_dedupe_idx.';

-- -----------------------------------------------------------------------------
-- 2. Aba Game: gestores, admin e sócios
-- -----------------------------------------------------------------------------
delete from public.role_permissions
 where role = 'broker' and permission = 'menu.gamification';
