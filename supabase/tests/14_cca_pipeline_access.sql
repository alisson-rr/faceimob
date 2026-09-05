\echo 'acesso do CCA ao formulário de análise'

do $$
begin
  if not exists (
    select 1
    from public.role_permissions
    where role = 'cca'
      and permission = 'menu.pipeline'
      and allowed
  ) then
    raise exception 'FALHOU: papel CCA continua bloqueado fora do formulário de análise';
  end if;
end
$$;

\echo 'acesso do CCA ao formulário de análise ok'

-- -----------------------------------------------------------------------------
-- 0047: a policy do bucket deal-documents espelha a da tabela.
--
-- `deal_documents_select` libera `has_role('cca')`, mas a policy do bucket (0012)
-- só aceitava `can_see_deal`: o CCA listava todo documento e não baixava nenhum.
-- No harness a 0047 cria a policy no stub de storage.objects — aqui ela é
-- exercitada de verdade, não só lida em pg_policy.
-- -----------------------------------------------------------------------------
\echo 'bucket deal-documents visível ao CCA'

create or replace function pg_temp.check14(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  cca  uuid := '00000000-0000-0000-0000-00000000f141';
  fora uuid := '00000000-0000-0000-0000-00000000f142';
  v_qual  text;
  v_stage uuid;
  v_deal  uuid;
  v_type  uuid;
  v_path  text;
begin
  if to_regclass('storage.objects') is null then
    raise notice '  --  storage ausente, policy do bucket não exercitada';
    return;
  end if;

  select pg_get_expr(p.polqual, p.polrelid) into v_qual
  from pg_policy p
  where p.polname = 'deal_documents_storage'
    and p.polrelid = 'storage.objects'::regclass;

  perform pg_temp.check14(v_qual is not null, 'policy deal_documents_storage existe');
  perform pg_temp.check14(position('has_role(''cca''' in v_qual) > 0,
    'policy do bucket libera o papel cca');
  perform pg_temp.check14(position('can_see_deal' in v_qual) > 0,
    'policy do bucket mantém can_see_deal para os demais papéis');

  -- No Supabase real storage.objects já tem RLS, usage no schema e grant; o
  -- stub do harness nasce sem os três (00_supabase_stubs só concede usage em
  -- public/extensions/auth), e sem eles a policy nem seria avaliada.
  if to_regprocedure('storage.foldername(text)') is null then
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;
  end if;

  insert into auth.users (id, email, raw_user_meta_data) values
    (cca,  'cca@bucket.test',  '{"full_name":"Analista Bucket"}'),
    (fora, 'fora@bucket.test', '{"full_name":"Corretor Fora Bucket"}');
  insert into public.user_roles (profile_id, role) values (cca, 'cca'), (fora, 'broker')
  on conflict do nothing;

  -- Testes anteriores exercitam o fechamento do mês corrente.
  delete from public.closed_months where period = public.month_start(current_date);
  select id into v_stage from public.pipeline_stages where code = 'proposal';
  insert into public.deals (stage_id) values (v_stage) returning id into v_deal;

  select id into v_type from public.document_types where active order by sort_order limit 1;
  v_path := v_deal || '/bucket-cca.pdf';
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name)
  values (v_deal, v_type, v_path, 'bucket-cca.pdf', 'bucket-cca.pdf');
  insert into storage.objects (bucket_id, name) values ('deal-documents', v_path);

  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform pg_temp.check14(
    (select count(*) from storage.objects where name = v_path) = 1,
    'CCA enxerga o objeto do bucket sem participar do negócio');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', fora::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform pg_temp.check14(
    (select count(*) from storage.objects where name = v_path) = 0,
    'corretor fora do negócio continua sem acesso ao objeto');
  reset role;
end
$$;

\echo 'bucket deal-documents visível ao CCA ok'
