\set ON_ERROR_STOP on
begin;

-- 0160: o empreendimento digitado é gravado sem depender do cadastro.
create function pg_temp.check_empreendimento(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
end;
$$;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000001600001';
  v_deal uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor,'broker@empreendimento160.test','{"full_name":"Corretor 160"}');
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.deals(stage_id,created_by,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor,'RESIDENCIAL NOVO SEM CADASTRO')
    returning id into v_deal;
  perform pg_temp.check_empreendimento(
    (select project_name = 'RESIDENCIAL NOVO SEM CADASTRO' and project_id is null from public.deals where id=v_deal),
    'nome digitado fica gravado sem vínculo com o cadastro');

  begin
    update public.deals set project_name = repeat('x', 121) where id = v_deal;
    raise exception 'FALHOU: nome com mais de 120 caracteres passou';
  exception when check_violation then null;
  end;
end
$$;

rollback;
