\set ON_ERROR_STOP on
begin;
do $$
begin
  insert into public.goals(scope,period_type,period,metric,target) values
    ('global','month','2099-12-01','sales',20),
    ('global','month','2099-12-01','sales_comp',25);
  if (select target from public.goals where scope='global' and period_type='month' and period='2099-12-01' and metric='sales') <> 20
    or (select target from public.goals where scope='global' and period_type='month' and period='2099-12-01' and metric='sales_comp') <> 25 then
    raise exception 'As duas metas precisam ser independentes.';
  end if;
  begin
    insert into public.goals(scope,period_type,period,metric,target) values ('global','month','2099-12-01','invalida',10);
    raise exception 'A restrição de métricas deixou de funcionar.';
  exception when check_violation then null;
  end;
  begin
    update public.goals set target=-1 where scope='global' and period='2099-12-01' and metric='sales_comp';
    raise exception 'Meta negativa foi aceita.';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
