-- =============================================================================
-- 0252 — Esteira Ágil e Análise p/ virar negócio: duas filas por chegada.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002520001';
  ini uuid := (select id from public.pipeline_stages where is_initial limit 1);
  a1 uuid; a2 uuid; v1 uuid; a3 uuid;
  r record;
  res text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c252.test', '{"full_name":"Corretor 252"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;

  insert into public.deals (stage_id, created_by) values (ini, cor) returning id into a1;
  insert into public.deals (stage_id, created_by) values (ini, cor) returning id into a2;
  insert into public.deals (stage_id, created_by) values (ini, cor) returning id into v1;
  insert into public.deals (stage_id, created_by) values (ini, cor) returning id into a3;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
  select x, cor, 'broker', 1 from unnest(array[a1, a2, v1, a3]) x on conflict do nothing;

  -- Chegadas: a1, a2 (Ágil), v1 (virar), a3 (Ágil) — v1 chega entre a2 e a3.
  insert into public.cca_cases (deal_id, status, submitted_at) values
    (a1, 'under_review', now() - interval '4 minutes'),
    (a2, 'under_review', now() - interval '3 minutes'),
    (v1, 'under_review', now() - interval '2 minutes'),
    (a3, 'under_review', now() - interval '1 minute');
  update public.deals set status_detail = '13. ESTEIRA AGIL' where id in (a1, a2, a3);
  update public.deals set status_detail = 'ANÁLISE P/ VIRAR NEGÓCIO' where id = v1;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  for r in select * from public.my_cca_queue_position() loop
    res := res || r.fila || r.queue_position ||
           case r.deal_id when a1 then 'a1' when a2 then 'a2' when a3 then 'a3' when v1 then 'v1' end || ' ';
  end loop;
  if res <> 'agil1a1 agil2a2 agil3a3 virar1v1 ' then
    raise exception 'FALHOU: filas por chegada, separadas (%)', res;
  end if;
  raise notice '  ok  Ágil e virar em filas próprias; chegar na de virar não mexe na Ágil';

  -- a1 sai da fila (CCA analisou): os de trás sobem, ninguém troca de lugar entre si.
  update public.cca_cases set status = 'approved', decided_at = now() where deal_id = a1;
  res := '';
  for r in select * from public.my_cca_queue_position() loop
    res := res || r.fila || r.queue_position || ' ';
  end loop;
  if res <> 'agil1 agil2 virar1 ' then
    raise exception 'FALHOU: saída do 1º sobe os demais (%)', res;
  end if;
  raise notice '  ok  quem sai da fila faz os de trás subirem, na mesma ordem';
end;
$$;

rollback;
