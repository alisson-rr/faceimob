-- =============================================================================
-- 0233 — VGV/desconto nulo regravado como 0 não conta como edição de valor.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002330001';
  v_deal uuid;
  v_ok   boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c233.test', '{"full_name":"Corretor 233"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'INCOMPLETO')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;
  update public.deals set vgv_gross = null where id = v_deal;
  -- Como em produção: "Editar VGV" desligado para o corretor em Admin · Permissões.
  update public.role_permissions set allowed = false where role = 'broker' and permission = 'deals.edit_value';

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- O que a ficha manda ao salvar: 0 no lugar do VGV vazio.
  update public.deals set vgv_gross = 0, discount_amount = 0, notes = 'ajuste' where id = v_deal;
  raise notice '  ok  vazio regravado como 0 salva sem "editar o VGV"';

  begin
    update public.deals set vgv_gross = 250000 where id = v_deal;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then
    raise exception 'FALHOU: corretor sem deals.edit_value não muda o VGV de verdade';
  end if;
  raise notice '  ok  mudar o VGV de verdade continua barrado';
end;
$$;

rollback;
