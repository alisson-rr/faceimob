-- =============================================================================
-- 0021 — Fechamento de mês atômico (ata 14/07: "fecha o game e fecha o mês")
--
-- O botão "Fechar Mês" do Pipeline fazia três operações separadas no navegador
-- (select de deals, update de month_base, insert em closed_months): uma falha
-- no meio deixava propostas migradas com o mês ainda aberto — e a temporada do
-- jogo não era encerrada junto, contrariando a ata. Esta RPC faz tudo numa
-- transação só.
-- =============================================================================

create or replace function public.close_month_and_season(p_period date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := public.month_start(coalesce(p_period, current_date));
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

  -- Encerra a temporada do jogo junto (p_close_month=false: o período fechado
  -- acima é o pedido na tela, que pode não ser o mês do calendário).
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

revoke all on function public.close_month_and_season(date) from public, anon;
grant execute on function public.close_month_and_season(date) to authenticated;

comment on function public.close_month_and_season is
  'Fecha o mês do pipeline e a temporada do jogo numa transação: migra propostas abertas, congela o período e encerra o placar. Só admin.';
