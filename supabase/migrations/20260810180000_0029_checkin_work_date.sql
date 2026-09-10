-- A data do check-in pertence ao banco. Entre 21h e 21h30 em Brasília o
-- Postgres em UTC já está no dia seguinte; recalcular "hoje" no navegador fazia
-- a presença recém-gravada desaparecer da tela e impedia o checkout.
create or replace function public.current_work_date()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select current_date;
$$;

revoke all on function public.current_work_date() from public, anon;
grant execute on function public.current_work_date() to authenticated, service_role;

comment on function public.current_work_date is
  'Data operacional usada por checkins e pela fila. A interface deve consultar esta função, nunca recalcular a data local.';
