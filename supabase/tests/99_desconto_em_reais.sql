\set ON_ERROR_STOP on
begin;

-- 0159: desconto em R$ é o dado digitado; o líquido sai dele e o percentual
-- acompanha. Quem ainda escreve percentual continua funcionando.
create function pg_temp.check_desconto(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
end;
$$;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000001590001';
  adm uuid := '00000000-0000-0000-0000-000001590002';
  v_deal uuid;
  v_legado uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor,'broker@desconto159.test','{"full_name":"Corretor 159"}'),
    (adm,'admin@desconto159.test','{"full_name":"Admin 159"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin') on conflict do nothing;
  -- Editar valor exige `deals.edit_value` (`deals_guard_value`): o admin tem.
  perform set_config('request.jwt.claims',json_build_object('sub',adm,'role','authenticated')::text,true);
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.deals(stage_id,created_by,vgv_gross,discount_amount)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor,250000,1234.56)
    returning id into v_deal;
  perform pg_temp.check_desconto((select vgv_net = 248765.44 from public.deals where id=v_deal),
    'líquido = bruto - desconto em R$, sem perder centavo');
  perform pg_temp.check_desconto((select discount_pct = 0.49 from public.deals where id=v_deal),
    'percentual derivado do R$');

  update public.deals set vgv_gross = 300000 where id = v_deal;
  perform pg_temp.check_desconto((select discount_amount = 1234.56 and vgv_net = 298765.44 from public.deals where id=v_deal),
    'trocar o bruto mantém o desconto em R$');

  -- Quem ainda escreve percentual (importação, seeds).
  insert into public.deals(stage_id,created_by,vgv_gross,discount_pct)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor,500000,10)
    returning id into v_legado;
  perform pg_temp.check_desconto((select discount_amount = 50000 and vgv_net = 450000 from public.deals where id=v_legado),
    'insert em percentual vira R$');
  update public.deals set discount_pct = 20 where id = v_legado;
  perform pg_temp.check_desconto((select discount_amount = 100000 and vgv_net = 400000 from public.deals where id=v_legado),
    'update em percentual recalcula o R$');

  begin
    update public.deals set discount_amount = 600000 where id = v_legado;
    raise exception 'FALHOU: desconto maior que o bruto passou';
  exception when check_violation then null;
  end;

  -- O guarda de valor vigia o R$: sem `deals.edit_value`, mexer no desconto
  -- mudaria o líquido por fora da permissão.
  update public.role_permissions set allowed=false where role='broker' and permission='deals.edit_value';
  perform set_config('request.jwt.claims',json_build_object('sub',cor,'role','authenticated')::text,true);
  begin
    update public.deals set discount_amount = 1 where id = v_deal;
    raise exception 'FALHOU: desconto em R$ mudou sem deals.edit_value';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
