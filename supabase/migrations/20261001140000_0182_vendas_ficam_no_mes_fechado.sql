-- 0182 — venda fica no mês em que foi fechada
--
-- O fechamento de 09/2026 ainda usava a regra antiga: todo negócio com
-- `outcome = 'open'` migrava. Desde a 0163, porém, um negócio aberto cujo
-- Status 1 é VENDA já é venda (EM CONTRATO, ASSINADO, ASS. BANCO, RC EMITIDA).
-- Oito vendas foram assim levadas para 10/2026. Esta migration:
--   1. devolve apenas as vendas de setembro que o fechamento levou para outubro;
--   2. deixa rastro imutável em deal_history;
--   3. impede que próximos fechamentos migrem venda aberta novamente.

-- Alvo conservador da reparação: venda hoje em outubro, criada antes do
-- fechamento de setembro e que já possuía evento de venda quando setembro foi
-- fechado. Uma venda legítima criada em outubro não satisfaz esse conjunto.
create temporary table vendas_0182_a_reparar on commit drop as
select d.id
  from public.deals d
  join public.closed_months cm on cm.period = date '2026-09-01'
 where d.month_base = date '2026-10-01'
   and d.created_at < cm.closed_at
   and public.deal_counts_as_game_sale(d.outcome, d.status_group_id)
   and exists (
     select 1
       from public.game_events e
      where e.ref_type = 'deal'
        and e.ref_id = d.id
        and e.event_code = 'venda'
        and e.occurred_at <= cm.closed_at
   );

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from vendas_0182_a_reparar;
  if v_count > 8 then
    raise exception '0182 recusou reparar % vendas; o fechamento de setembro moveu no máximo 8.', v_count;
  end if;
end;
$$;

insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
select id, null, 'month_base_corrected', '10/2026', '09/2026',
       jsonb_build_object(
         'reason', 'Venda migrada indevidamente pelo fechamento de 09/2026',
         'migration', '0182'
       )
  from vendas_0182_a_reparar;

-- O mês de destino está fechado; a migration é postgres e corrige somente a
-- lista materializada acima. Os outros gatilhos continuam ativos.
alter table public.deals disable trigger deals_guard_closed_month;

update public.deals d
   set month_base = date '2026-09-01'
  from vendas_0182_a_reparar r
 where d.id = r.id;

alter table public.deals enable trigger deals_guard_closed_month;

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

  -- Só proposta em andamento migra. Negócio aberto com Status 1 VENDA já é
  -- venda oficial desde a 0163 e permanece congelado na competência fechada.
  update public.deals
     set month_base = (v_period + interval '1 month')::date
   where outcome = 'open'
     and month_base = v_period
     and not public.deal_counts_as_game_sale(outcome, status_group_id);
  get diagnostics v_moved = row_count;

  insert into public.closed_months (period, closed_by)
  values (v_period, auth.uid());

  begin
    v_season := public.close_game_season(null, false);
  exception when others then
    if sqlerrm = 'Nenhuma temporada aberta.' then
      v_season := null;
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
  'Fecha mês e temporada numa transação. Migra apenas propostas abertas; venda (inclusive Status 1 VENDA com outcome aberto), perda e distrato permanecem no mês fechado. Sem período usa o mês operacional. Só admin/sócio (0182).';
