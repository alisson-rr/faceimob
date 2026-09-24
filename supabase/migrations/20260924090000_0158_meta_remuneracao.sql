-- Patamar de remuneração separado da meta operacional de vendas.
-- A ausência de cadastro não equivale a zero nem a copiar a meta de vendas.
alter table public.goals drop constraint goals_metric_check;
alter table public.goals add constraint goals_metric_check
  check (metric in ('sales','sales_comp','vgv','leads','visits','analyses','approvals'));
