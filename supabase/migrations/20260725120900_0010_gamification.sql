-- =============================================================================
-- 0010 · Gamificação e fechamento de período
--
-- "Necessidade de um sistema próprio de fechamento de mês e de jogos, que não
--  dependa do calendário tradicional, permitindo que as propostas e status
--  sejam movidos para o mês seguinte apenas quando o encerramento for validado
--  pelo administrador. Essa ação deverá congelar os dados do período anterior
--  e preparar o sistema para o novo ciclo."
--
-- Daí duas coisas separadas:
--   · game_seasons — o ciclo do jogo, aberto e fechado à mão
--   · closed_months — o travamento contábil do mês-base dos negócios
-- =============================================================================

-- -----------------------------------------------------------------------------
-- closed_months — mês-base travado. Depois de fechado, negócio daquele mês
-- não muda mais (exceto por admin), o que impede relatório passado de mudar
-- retroativamente — a queixa do cliente sobre discrepância nos anuais.
-- -----------------------------------------------------------------------------
create table public.closed_months (
  period     date primary key,
  closed_at  timestamptz not null default now(),
  closed_by  uuid references public.profiles(id) on delete set null,
  notes      text,

  constraint closed_months_is_month_start check (period = public.month_start(period))
);

create or replace function public.deals_guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := coalesce(new.month_base, old.month_base);
begin
  if public.is_admin() then
    return new;
  end if;

  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_period, 'MM/YYYY') using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger deals_guard_closed_month
  before insert or update on public.deals
  for each row execute function public.deals_guard_closed_month();

-- -----------------------------------------------------------------------------
-- game_seasons — o ciclo do jogo. Só uma aberta por vez.
-- -----------------------------------------------------------------------------
create table public.game_seasons (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  period_start date not null default current_date,
  period_end   date,
  closed_at    timestamptz,
  closed_by    uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint game_seasons_period check (period_end is null or period_end >= period_start),
  constraint game_seasons_closed_consistency
    check ((closed_at is null) = (period_end is null))
);

-- Índice sobre expressão constante: garante no máximo uma temporada aberta.
create unique index game_seasons_one_open
  on public.game_seasons ((closed_at is null)) where closed_at is null;

create trigger game_seasons_set_updated_at
  before update on public.game_seasons
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- game_scoring_rules — pontuação configurável.
-- season_id NULL = regra padrão, herdada por toda temporada que não sobrescreve.
-- -----------------------------------------------------------------------------
create table public.game_scoring_rules (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid references public.game_seasons(id) on delete cascade,
  event_code text not null,
  label      text not null,
  points     int not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index game_scoring_rules_default_idx
  on public.game_scoring_rules (event_code) where season_id is null;
create unique index game_scoring_rules_season_idx
  on public.game_scoring_rules (season_id, event_code) where season_id is not null;

create trigger game_scoring_rules_set_updated_at
  before update on public.game_scoring_rules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- game_events — cada pontuação concedida, com referência à origem.
-- -----------------------------------------------------------------------------
create table public.game_events (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.game_seasons(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  event_code  text not null,
  points      int not null,
  ref_type    text,
  ref_id      uuid,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Impede pontuar duas vezes o mesmo negócio pelo mesmo motivo.
create unique index game_events_dedupe_idx
  on public.game_events (season_id, profile_id, event_code, ref_id)
  where ref_id is not null;

create index game_events_season_idx on public.game_events (season_id, profile_id);

-- -----------------------------------------------------------------------------
-- game_season_results — o congelamento. Escrito uma vez no fechamento e nunca
-- mais recalculado, para que o histórico não mude quando as regras mudarem.
-- -----------------------------------------------------------------------------
create table public.game_season_results (
  season_id  uuid not null references public.game_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  rank       int not null,
  points     int not null,
  sales      int not null default 0,
  vgv        numeric(14,2) not null default 0,
  breakdown  jsonb not null default '{}'::jsonb,
  frozen_at  timestamptz not null default now(),

  primary key (season_id, profile_id)
);

-- -----------------------------------------------------------------------------
-- Funções do jogo
-- -----------------------------------------------------------------------------

create or replace function public.current_game_season()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.game_seasons where closed_at is null
  order by period_start desc limit 1;
$$;

-- Pontos vigentes de um evento: regra da temporada, senão a padrão.
create or replace function public.scoring_points(p_season_id uuid, p_event_code text)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.points
  from public.game_scoring_rules r
  where r.active
    and r.event_code = p_event_code
    and (r.season_id = p_season_id or r.season_id is null)
  order by (r.season_id is not null) desc
  limit 1;
$$;

-- Concede pontos. Idempotente quando há ref_id: reprocessar não duplica.
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
begin
  if v_season is null then
    return null;   -- nenhuma temporada aberta: o jogo está parado
  end if;

  v_points := public.scoring_points(v_season, p_event_code);
  if v_points is null then
    return null;   -- evento sem regra configurada
  end if;

  insert into public.game_events (season_id, profile_id, event_code, points,
                                  ref_type, ref_id, occurred_at)
  values (v_season, p_profile_id, p_event_code, v_points, p_ref_type, p_ref_id, p_occurred)
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- Ranking da temporada aberta. security_invoker: a view respeita o RLS de
-- game_events em vez de rodar com os poderes do dono — sem isso, qualquer
-- corretor leria a pontuação de todo mundo por baixo do pano.
create view public.game_ranking with (security_invoker = true) as
select
  e.season_id,
  e.profile_id,
  p.full_name,
  sum(e.points)::int as points,
  count(*) filter (where e.event_code = 'venda')::int as sales,
  jsonb_object_agg(e.event_code, e.code_points) as breakdown
from (
  select season_id, profile_id, event_code, points,
         sum(points) over (partition by season_id, profile_id, event_code) as code_points
  from public.game_events
) e
join public.profiles p on p.id = e.profile_id
group by e.season_id, e.profile_id, p.full_name;

-- Fecha a temporada: congela o ranking e abre a próxima na mesma transação.
create or replace function public.close_game_season(
  p_next_label text default null,
  p_close_month boolean default true
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

  update public.game_seasons
     set closed_at = now(), closed_by = auth.uid(), period_end = current_date
   where id = v_season.id;

  -- Trava também o mês-base corrente, se pedido.
  if p_close_month then
    insert into public.closed_months (period, closed_by)
    values (public.month_start(current_date), auth.uid())
    on conflict (period) do nothing;
  end if;

  insert into public.game_seasons (label, period_start)
  values (
    coalesce(p_next_label, to_char(current_date + 1, 'TMMonth YYYY')),
    current_date + 1
  )
  returning id into v_next;

  return v_next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pontuação automática a partir do funil
-- -----------------------------------------------------------------------------

-- Venda fechada pontua todos os corretores participantes.
create or replace function public.deals_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker uuid;
begin
  if new.outcome = 'won' and old.outcome is distinct from 'won' then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'venda', 'deal', new.id, now());
    end loop;
  end if;

  -- Distrato: negócio que estava ganho e foi cancelado devolve a penalidade.
  if new.outcome = 'cancelled' and old.outcome = 'won' then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'distrato', 'deal', new.id, now());
    end loop;
  end if;

  return null;
end;
$$;

create trigger deals_award_points
  after update on public.deals
  for each row execute function public.deals_award_points();

-- Aprovação de crédito pontua os corretores do negócio.
create or replace function public.cca_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker uuid;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.deal_id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'aprovado', 'deal', new.deal_id, now());
    end loop;
  end if;

  if new.status = 'under_review' and old.status is distinct from 'under_review' then
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

create trigger cca_award_points
  after update on public.cca_cases
  for each row execute function public.cca_award_points();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.closed_months        enable row level security;
alter table public.game_seasons         enable row level security;
alter table public.game_scoring_rules   enable row level security;
alter table public.game_events          enable row level security;
alter table public.game_season_results  enable row level security;

create policy closed_months_select on public.closed_months
  for select to authenticated using (true);
create policy closed_months_write on public.closed_months
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy game_seasons_select on public.game_seasons
  for select to authenticated using (true);
create policy game_seasons_write on public.game_seasons
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy game_scoring_rules_select on public.game_scoring_rules
  for select to authenticated using (true);
create policy game_scoring_rules_write on public.game_scoring_rules
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- O ranking é público internamente: é o ponto do jogo. Mas a linha do evento
-- só aparece para quem já enxerga a pessoa.
create policy game_events_select on public.game_events
  for select to authenticated using (true);

-- Pontuação não se digita: vem de award_game_points. Só admin corrige à mão.
create policy game_events_write on public.game_events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy game_season_results_select on public.game_season_results
  for select to authenticated using (true);
create policy game_season_results_write on public.game_season_results
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on function public.close_game_season(text, boolean) from public, anon;
grant execute on function public.close_game_season(text, boolean) to authenticated;
revoke all on function public.award_game_points(uuid, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.award_game_points(uuid, text, text, uuid, timestamptz) to service_role;
