-- =============================================================================
-- 0306 — o mesmo contato vai para o mesmo corretor, com o telefone escrito de
-- outro jeito e vindo por outro grupo de distribuição.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

update public.automation_settings set leads_paused = false, leads_recomeco_em = null;
update public.work_shifts set active = false;
insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time)
values ('aberto-306', 'Integral 306', '00:00', '00:00', '23:59:59.999999');

do $$
declare
  cor_a   uuid := '00000000-0000-0000-0000-000003060001';
  cor_b   uuid := '00000000-0000-0000-0000-000003060002';
  grupo_a uuid;
  grupo_b uuid;
  novo    uuid;
  v_dono  uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor_a, 'a@c306.test', '{"full_name":"Corretor A 306"}'),
    (cor_b, 'b@c306.test', '{"full_name":"Corretor B 306"}');
  insert into public.user_roles (profile_id, role) values (cor_a, 'broker'), (cor_b, 'broker') on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active, deliver_without_checkin)
    values ('Site 306', 'site-306', 'specific', true, true) returning id into grupo_a;
  insert into public.distribution_groups (name, slug, kind, active, deliver_without_checkin)
    values ('Meta 306', 'meta-306', 'specific', true, true) returning id into grupo_b;
  insert into public.distribution_group_members (group_id, profile_id, active) values (grupo_a, cor_a, true), (grupo_b, cor_b, true);

  -- O contato já está com o corretor A, pelo site, sem DDI.
  insert into public.leads (full_name, phone, status, assigned_to, distribution_group_id)
    values ('Contato site 306', '11 90030-6001', 'in_progress', cor_a, grupo_a);
  -- Chega de novo pela Meta, com DDI, num grupo em que A não está.
  insert into public.leads (full_name, phone, status, distribution_group_id)
    values ('Contato meta 306', '+5511900306001', 'queued', grupo_b) returning id into novo;

  v_dono := public.assign_lead(novo);
  if v_dono is distinct from cor_a then
    raise exception 'FALHOU: o mesmo contato deveria ir para o corretor A (veio %)', v_dono;
  end if;
  raise notice '  ok  mesmo contato, telefone diferente e outro grupo: mesmo corretor';
end;
$$;

do $$
begin
  if public.telefone_chave('+55 (51) 99294-2662') is distinct from public.telefone_chave('5192942662') then
    raise exception 'FALHOU: com e sem DDI e nono dígito deveriam casar';
  end if;
  raise notice '  ok  telefone casa com e sem DDI e nono dígito';
end;
$$;

rollback;
