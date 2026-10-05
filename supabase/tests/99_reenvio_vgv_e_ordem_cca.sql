-- =============================================================================
-- 0228 — percentual derivado não conta como mudança de VGV; CCA reordena colunas.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002280001';
  cca uuid := '00000000-0000-0000-0000-000002280002';
  v_deal uuid;
  v_ids uuid[];
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c228.test', '{"full_name":"Corretor 228"}'),
    (cca, 'cca@c228.test', '{"full_name":"CCA 228"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (cca, 'cca') on conflict do nothing;
  insert into public.deals (stage_id, created_by, vgv_gross, discount_amount)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 200000, 1000) returning id into v_deal;
  -- Percentual legado fora da conta (como nos negócios antigos).
  alter table public.deals disable trigger deals_aa_sync_discount;
  update public.deals set discount_pct = 7.77 where id = v_deal;
  alter table public.deals enable trigger deals_aa_sync_discount;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  -- A tela regrava o mesmo VGV e o mesmo desconto: o percentual é recalculado.
  update public.deals set vgv_gross = 200000, discount_amount = 1000 where id = v_deal;
  raise notice '  ok  regravar o mesmo VGV não acusa mudança de VGV';

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  select array_agg(id order by position desc) into v_ids from public.cca_stages where active;
  perform public.reorder_cca_stages(v_ids);
  if (select id from public.cca_stages where active order by position limit 1) <> v_ids[1] then
    raise exception 'FALHOU: a CCA não reordenou as colunas';
  end if;
  raise notice '  ok  a CCA reordena as colunas';
end;
$$;

rollback;
