-- =============================================================================
-- 0205 — batida de CPF: último comentário do negócio ativo e distrato à parte.
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
  cor_a uuid := '00000000-0000-0000-0000-000002050001';
  cor_b uuid := '00000000-0000-0000-0000-000002050002';
  v_ativo uuid; v_distrato uuid;
  v_previous_month date := public.month_start(
    (coalesce(public.current_season_month(), current_date) - interval '1 month')::date
  );
  r record;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor_a,'cor_a@cpf205.test','{"full_name":"Corretor A 205"}'),
    (cor_b,'cor_b@cpf205.test','{"full_name":"Corretor B 205"}');
  insert into public.user_roles(profile_id,role) values (cor_a,'broker'),(cor_b,'broker') on conflict do nothing;

  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor_a,'06. ENVIO DE RP','X') returning id into v_ativo;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values (v_ativo,cor_a,'broker',1) on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_ativo,'JOAO 205','111.444.777-35',1);
  insert into public.deal_history(deal_id,actor_id,kind,to_value,created_at) values
    (v_ativo,cor_a,'comment','Primeiro contato', now() - interval '2 days'),
    (v_ativo,cor_a,'comment','Cliente aprovado, aguardando assinatura', now() - interval '1 hour');

  delete from public.closed_months where period = v_previous_month;
  insert into public.deals(stage_id,created_by,status_detail,lost_reason,project_name,month_base)
    values ((select id from public.pipeline_stages where code='lost'),cor_a,'20. DISTRATO','20. DISTRATO','Y',v_previous_month)
    returning id into v_distrato;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values (v_distrato,cor_a,'broker',1) on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_distrato,'MARIA 205','52998224725',1);

  perform set_config('request.jwt.claims',json_build_object('sub',cor_b,'role','authenticated')::text,true);
  set local role authenticated;

  select * into r from public.negocio_do_cpf('11144477735');
  perform pg_temp.ok(r.situacao = 'ativo' and r.ultimo_comentario = 'Cliente aprovado, aguardando assinatura'
    and r.ultimo_comentario_em > now() - interval '2 hours', 'ativo: traz o último comentário com a hora');

  select * into r from public.negocio_do_cpf('52998224725');
  perform pg_temp.ok(r.situacao = 'distrato', 'distrato aparece à parte');

  begin
    perform public.assumir_negocio_do_cpf(v_distrato, 'quero retomar');
    raise exception 'FALHOU: retomou distrato';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    perform pg_temp.ok(sqlerrm like '%já foi contabilizado em mês anterior%', 'distrato não é retomado pelo corretor');
  end;
  reset role;
end;
$$;

rollback;
