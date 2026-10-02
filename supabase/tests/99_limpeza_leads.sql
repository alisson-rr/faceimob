-- =============================================================================
-- 0186 — limpeza dos leads sem negócio, só admin, com total conferido e cópia.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001860001';
  cor uuid := '00000000-0000-0000-0000-000001860002';
  v_lead_negocio uuid;
  v_lead_teste uuid;
  v_deal uuid;
  v_total int;
  v_apagados int;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@l186.test','{"full_name":"Admin 186"}'),
    (cor,'cor@l186.test','{"full_name":"Corretor 186"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin') on conflict do nothing;
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.leads(full_name, phone) values ('Lead Que Virou', '51999991861') returning id into v_lead_negocio;
  insert into public.deals(stage_id, created_by, lead_id) values
    ((select id from public.pipeline_stages where is_initial limit 1), cor, v_lead_negocio) returning id into v_deal;
  insert into public.leads(full_name, phone) values ('Lead Teste 186', '51999991862') returning id into v_lead_teste;
  insert into public.lead_comments(lead_id, author_id, body) values (v_lead_teste, cor, 'comentário de teste');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.previa_limpeza_de_leads();
    raise exception 'FALHOU: corretor viu a prévia';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não limpa leads';
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select sum(total)::int into v_total from public.previa_limpeza_de_leads();

  begin
    perform public.apagar_leads_sem_negocio(v_total + 1);
    raise exception 'FALHOU: apagou com total errado';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  total diferente do conferido não apaga nada';
  end;

  v_apagados := public.apagar_leads_sem_negocio(v_total);
  reset role;

  perform pg_temp.ok(v_apagados = v_total, 'apaga exatamente o total conferido');
  perform pg_temp.ok(not exists (select 1 from public.leads where id = v_lead_teste), 'lead de teste apagado');
  perform pg_temp.ok(exists (select 1 from public.leads where id = v_lead_negocio), 'lead que virou negócio fica');
  perform pg_temp.ok(
    (select dados->'comentarios'->0->>'body' from private.leads_apagados where id = v_lead_teste) = 'comentário de teste',
    'cópia guarda o lead com os comentários');
  perform pg_temp.ok(not exists (select 1 from public.leads l where public.lead_sem_negocio(l)), 'roleta começa vazia');
end
$$;

rollback;
