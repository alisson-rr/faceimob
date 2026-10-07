-- =============================================================================
-- 0237 — CCA registra DISTRATO em mês anterior já fechado
--
-- A 0230 deu à CCA a permissão específica `deals.mark_distrato` e a 0236
-- limitou DISTRATO a meses anteriores. Porém, esses meses normalmente já estão
-- em `closed_months`, então o movimento legítimo feito por `move_cca_case`
-- ainda era recusado pelo bloqueio contábil.
--
-- A exceção abaixo é deliberadamente estreita: vale somente durante o movimento
-- autenticado da esteira CCA, para quem tem a permissão específica, sem trocar o
-- mês-base e apenas quando o destino é DISTRATO em mês anterior. Todo o restante
-- do negócio no mês fechado continua imutável.
-- =============================================================================

create or replace function public.deals_guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := coalesce(new.month_base, old.month_base);
  v_reactivation text := coalesce(current_setting('faceimob.reactivate_deal', true), '');
  v_current_month date := public.month_start(
    coalesce(public.current_season_month(), current_date)
  );
begin
  if public.is_admin() or v_reactivation = new.id::text then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.cca_move', true), '') = 'on'
     and public.has_permission('deals.mark_distrato')
     and new.month_base is not distinct from old.month_base
     and new.month_base < v_current_month
     and public.deal_status_bare(new.status_detail) = 'DISTRATO' then
    return new;
  end if;

  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_period, 'MM/YYYY') using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.deals_guard_closed_month()
  from public, anon, authenticated;

comment on function public.deals_guard_closed_month() is
  'Congela meses fechados; permite somente reativação autorizada e DISTRATO anterior via movimento autenticado da CCA, sem trocar o mês-base.';
