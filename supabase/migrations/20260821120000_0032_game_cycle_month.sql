-- =============================================================================
-- 0032 · O mês-base do negócio segue o ciclo do game (decisão do cliente, 21/08)
--
-- A ata de 14/07 já pedia "fechamento de mês e de jogos que não dependa do
-- calendário tradicional". O banco atendia metade: `game_seasons` é período
-- livre (02/07 -> 05/08, aberto e fechado pelo admin), mas `deals.month_base`
-- continuava nascendo de `month_start(current_date)` (`0006:39`) — calendário.
--
-- O descasamento tinha consequência contábil: negócio criado em 03/08 com a
-- temporada de julho ainda aberta nascia com mês-base agosto. Ao encerrar o
-- ciclo "julho" em 05/08, ele ficava fora do fechamento e do congelamento —
-- some do relatório do período a que de fato pertence.
--
-- O que muda:
--   1. `current_season_month()` — fonte única do "mês do ciclo aberto".
--   2. Trigger de INSERT em `deals`: o mês-base default vira o do ciclo.
--   3. `close_game_season` deixa de travar mês. Ponto único de fechamento
--      contábil é `close_month_and_season` (0021), que migra as propostas.
--   4. `close_month_and_season()` sem argumento fecha o mês do ciclo, não o do
--      relógio de quem clicou.
--   5. F01 — `notify_lead_assigned` grava um link que existe.
--
-- Não reescreve `month_base` de negócio existente: mês fechado é histórico e
-- reescrevê-lo mudaria relatório já entregue — exatamente a queixa que a
-- `closed_months` existe para impedir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O mês do ciclo aberto
-- -----------------------------------------------------------------------------
-- Uma função só, porque a regra passou a ter mais de um leitor (o trigger
-- abaixo e `close_month_and_season`). NULL = jogo parado, e aí vale o calendário.
create or replace function public.current_season_month()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.month_start(gs.period_start)
  from public.game_seasons gs
  where gs.id = public.current_game_season();
$$;

revoke all on function public.current_season_month() from public, anon;
grant execute on function public.current_season_month() to authenticated, service_role;

comment on function public.current_season_month is
  'Mês-base do ciclo do jogo aberto (month_start do period_start da temporada). NULL quando não há temporada aberta. Fonte única do "mês" que não é o do calendário.';

-- -----------------------------------------------------------------------------
-- 2. Negócio novo nasce no mês do ciclo
-- -----------------------------------------------------------------------------
create or replace function public.deals_default_month_base()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Só substitui o valor que veio do default da coluna (ou nulo explícito).
  -- Mês-base digitado — importação, correção do admin, `close_month_and_season`
  -- movendo proposta — continua valendo como está.
  if new.month_base is null or new.month_base = public.month_start(current_date) then
    new.month_base := coalesce(
      public.current_season_month(),
      new.month_base,
      public.month_start(current_date)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.deals_default_month_base() from public, anon, authenticated;

-- O nome ordena antes de `deals_guard_closed_month` de propósito: na mesma fase
-- (BEFORE INSERT) o Postgres dispara em ordem alfabética de nome, e o guard
-- precisa julgar o mês que a linha vai realmente ter, não o do calendário.
drop trigger if exists deals_default_month_base on public.deals;
create trigger deals_default_month_base
  before insert on public.deals
  for each row execute function public.deals_default_month_base();

comment on column public.deals.month_base is
  'Mês contábil do negócio. Nasce do ciclo aberto do jogo (current_season_month()), não do calendário: com a temporada de julho aberta, negócio criado em 03/08 é de julho. Sem temporada aberta, cai no mês do calendário. Só close_month_and_season() o move.';

-- -----------------------------------------------------------------------------
-- 3. Encerrar temporada não trava mais mês
-- -----------------------------------------------------------------------------
-- `p_close_month` gravava `month_start(current_date)` em `closed_months` — o mês
-- do relógio, que com ciclo livre quase nunca é o mês do ciclo — e sem migrar as
-- propostas abertas. O parâmetro fica na assinatura (grants e tipos gerados
-- dependem dela) mas não tem mais efeito; o default vira `false` para que a
-- assinatura conte a mesma história.
create or replace function public.close_game_season(
  p_next_label text default null,
  p_close_month boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season public.game_seasons;
  v_next   uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador encerra a temporada.' using errcode = '42501';
  end if;

  select * into v_season from public.game_seasons
  where closed_at is null order by period_start desc limit 1
  for update;

  if not found then
    raise exception 'Nenhuma temporada aberta.' using errcode = 'P0001';
  end if;

  -- Congela o ranking com as regras vigentes agora.
  insert into public.game_season_results (season_id, profile_id, rank, points, sales, vgv, breakdown)
  select
    r.season_id,
    r.profile_id,
    row_number() over (order by r.points desc, r.full_name)::int,
    r.points,
    r.sales,
    coalesce((
      select sum(d.vgv_net * dp.share_pct / 100)
      from public.deal_participants dp
      join public.deals d on d.id = dp.deal_id
      where dp.profile_id = r.profile_id
        and dp.role = 'broker'
        and d.outcome = 'won'
        and d.closed_at >= v_season.period_start
    ), 0),
    r.breakdown
  from public.game_ranking r
  where r.season_id = v_season.id
  on conflict (season_id, profile_id) do nothing;

  -- `greatest`: a temporada que este mesmo fluxo abre nasce em `current_date + 1`,
  -- então encerrá-la no mesmo dia daria `period_end < period_start` e o
  -- `game_seasons_period` derrubaria a transação inteira com erro cru — dois
  -- fechamentos no mesmo dia são um caminho real (corrigir o mês, refazer a demo).
  update public.game_seasons
     set closed_at = now(),
         closed_by = auth.uid(),
         period_end = greatest(v_season.period_start, current_date)
   where id = v_season.id;

  -- p_close_month ignorado desde a 0032: quem trava mês é close_month_and_season.

  insert into public.game_seasons (label, period_start)
  values (
    coalesce(p_next_label, to_char(current_date + 1, 'TMMonth YYYY')),
    current_date + 1
  )
  returning id into v_next;

  return v_next;
end;
$$;

comment on function public.close_game_season is
  'Encerra a temporada aberta: congela o ranking e abre a próxima. NÃO trava mês — p_close_month é ignorado desde a 0032; o fechamento contábil é close_month_and_season(). Só admin.';

-- -----------------------------------------------------------------------------
-- 4. Fechar mês sem argumento fecha o mês do ciclo
-- -----------------------------------------------------------------------------
-- Era `coalesce(p_period, current_date)`: chamada sem período em 05/08, com a
-- temporada de julho aberta, fechava agosto e deixava julho aberto para sempre.
-- O Pipeline continua podendo escolher o período.
create or replace function public.close_month_and_season(p_period date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := public.month_start(
    coalesce(p_period, public.current_season_month(), current_date)
  );
  v_moved  int;
  v_season uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador fecha o mês.' using errcode = '42501';
  end if;

  if exists (select 1 from public.closed_months where period = v_period) then
    raise exception 'O mês % já está fechado.', to_char(v_period, 'MM/YYYY')
      using errcode = 'P0001';
  end if;

  -- Propostas abertas migram para o mês seguinte; VENDA/QUEDA/DISTRATO ficam.
  update public.deals
     set month_base = (v_period + interval '1 month')::date
   where outcome = 'open'
     and month_base = v_period;
  get diagnostics v_moved = row_count;

  insert into public.closed_months (period, closed_by)
  values (v_period, auth.uid());

  -- Encerra a temporada do jogo junto.
  begin
    v_season := public.close_game_season(null, false);
  exception when others then
    if sqlerrm = 'Nenhuma temporada aberta.' then
      v_season := null;  -- sem jogo ativo não impede o fechamento do mês
    else
      raise;
    end if;
  end;

  return jsonb_build_object(
    'period', v_period,
    'moved_deals', v_moved,
    'next_season_id', v_season
  );
end;
$$;

comment on function public.close_month_and_season is
  'Fecha o mês do pipeline e a temporada do jogo numa transação: migra propostas abertas, congela o período e encerra o placar. Sem p_period usa o mês do ciclo aberto (current_season_month()), não o do calendário. Só admin.';

-- -----------------------------------------------------------------------------
-- 5. F01 — o link da notificação precisa existir
-- -----------------------------------------------------------------------------
-- `/leads/<uuid>` não é rota do app: quem clicava no sino caía no 404. A tela de
-- Leads abre o lead por `?lead=<id>` (contrato do agente D, registrado em
-- `docs/prompts/handoff-D.md`). Notificações já gravadas continuam como estão —
-- `resolveLink`, no NotificationBell, reescreve as antigas.
create or replace function public.notify_lead_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_notify  boolean;
begin
  select notify_on_assign into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  select * into v_lead from public.leads where id = new.lead_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (
    new.profile_id,
    'lead_assigned',
    'Novo lead: ' || coalesce(v_lead.full_name, 'sem nome'),
    format('Você tem até %s para iniciar o atendimento.',
           to_char(new.deadline at time zone 'America/Sao_Paulo', 'HH24:MI')),
    '/leads?lead=' || new.lead_id::text,
    'in_app'
  );

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (
    new.profile_id,
    'lead_assigned',
    'Novo lead atribuído',
    format('%s acabou de cair para você. Atenda em até %s minutos.',
           coalesce(v_lead.full_name, 'Um lead'),
           greatest(1, round(extract(epoch from (new.deadline - now())) / 60))),
    '/leads?lead=' || new.lead_id::text,
    'whatsapp'
  );

  return null;
end;
$$;
