-- =============================================================================
-- 0035 — Rótulo da temporada em pt-BR
--
-- `close_game_season` abre a temporada seguinte com
-- `to_char(current_date + 1, 'TMMonth YYYY')` (0010:293, mantido na 0032:158).
-- O prefixo `TM` traduz pelo `lc_time` da sessão — e o do projeto é
-- `en_US.UTF-8`, sem `pt_BR` instalado no container. Resultado: o fechamento
-- gravava "August 2026" ao lado de "Julho 2026", e o admin corrigia à mão.
--
-- `set lc_time = 'pt_BR'` não resolve: a locale não existe no SO do banco e o
-- `to_char` cai no inglês em silêncio (já testado). A saída é não depender de
-- locale: `season_label_ptbr(date)` monta o rótulo por tabela fixa dos 12
-- meses, e `close_game_season` passa a usá-la — o corpo é o da 0032 inteiro,
-- só a expressão do rótulo muda.
--
-- O UPDATE no final traduz rótulos em inglês já gravados. Na homologação é
-- no-op (o de agosto foi corrigido à mão); fica para o próximo fechamento em
-- qualquer ambiente que ainda esteja na 0034.
-- =============================================================================

create or replace function public.season_label_ptbr(d date)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select (array['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'])
           [extract(month from d)::int]
         || ' ' || extract(year from d)::int;
$$;

revoke all on function public.season_label_ptbr(date) from public, anon;
grant execute on function public.season_label_ptbr(date) to authenticated, service_role;

comment on function public.season_label_ptbr is
  'Rótulo "Mês YYYY" em pt-BR sem depender de lc_time (o container não tem pt_BR). Fonte única do nome da temporada que close_game_season abre.';

-- -----------------------------------------------------------------------------
-- close_game_season — corpo da 0032, só o rótulo da próxima temporada muda
-- -----------------------------------------------------------------------------
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
    coalesce(p_next_label, public.season_label_ptbr(current_date + 1)),
    current_date + 1
  )
  returning id into v_next;

  return v_next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rótulos em inglês já gravados
-- -----------------------------------------------------------------------------
-- Traduz o texto do rótulo, não recalcula pelo `period_start`: o que o admin
-- viu como "August 2026" vira "Agosto 2026", mesmo que o período tenha sido
-- ajustado depois. `to_date` com `Month` (sem `TM`) lê nome inglês em qualquer
-- locale. Idempotente: traduzido, o rótulo deixa de casar com o regex.
update public.game_seasons
   set label = public.season_label_ptbr(to_date(label, 'Month YYYY'))
 where label ~ '^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$';
