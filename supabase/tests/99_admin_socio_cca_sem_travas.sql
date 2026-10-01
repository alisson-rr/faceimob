-- =============================================================================
-- 0181 — admin/sócio atuam no negócio durante a CCA; demais perfis continuam
-- travados. A entrada Ágil é roteada para a coluna homônima quando configurada.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.como181(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.ok181(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.falha181(p_sql text, p_code text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU: % — a chamada passou', p_label;
exception when others then
  if sqlstate <> p_code then
    raise exception 'FALHOU: % — esperado %, veio % (%)', p_label, p_code, sqlstate, sqlerrm;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000018101', 'admin@v0181.test',   '{"full_name":"Admin 0181"}'),
  ('00000000-0000-0000-0000-000000018102', 'socio@v0181.test',   '{"full_name":"Socio 0181"}'),
  ('00000000-0000-0000-0000-000000018103', 'corretor@v0181.test','{"full_name":"Corretor 0181"}')
on conflict do nothing;

insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000018101', 'admin'),
  ('00000000-0000-0000-0000-000000018102', 'partner'),
  ('00000000-0000-0000-0000-000000018103', 'broker')
on conflict do nothing;

insert into public.deals (id, stage_id, created_by, month_base, status_detail)
select '00000000-0000-0000-0000-0000000181d1', s.id,
       '00000000-0000-0000-0000-000000018103', '12/2099', 'PROPOSTA'
  from public.pipeline_stages s
 where s.active
 order by s.position
 limit 1;

insert into public.deal_participants (deal_id, profile_id, role, share_pct)
values ('00000000-0000-0000-0000-0000000181d1',
        '00000000-0000-0000-0000-000000018103', 'broker', 100);

insert into public.cca_cases (id, deal_id, status, stage_id, submitted_at)
select '00000000-0000-0000-0000-0000000181c1',
       '00000000-0000-0000-0000-0000000181d1', 'under_review', s.id, now()
  from public.cca_stages s
 where s.active and s.status = 'under_review'
 order by s.position
 limit 1;

set role authenticated;

-- O corretor participante continua esperando a decisão da CCA.
select pg_temp.como181('00000000-0000-0000-0000-000000018103');
select pg_temp.falha181(
  $$update public.deals set status_detail = '08. VIROU NEGÓCIO' where id = '00000000-0000-0000-0000-0000000181d1'$$,
  'P0001', 'corretor continua travado durante a análise da CCA');

-- Administrador corrige/conclui diretamente no editor, mesmo com caso ativo.
select pg_temp.como181('00000000-0000-0000-0000-000000018101');
update public.deals set status_detail = '08. VIROU NEGÓCIO'
 where id = '00000000-0000-0000-0000-0000000181d1';
select pg_temp.ok181(
  (select public.deal_status_bare(status_detail) = 'VIROU NEGÓCIO'
     from public.deals where id = '00000000-0000-0000-0000-0000000181d1'),
  'administrador atua sem aguardar a CCA');

-- O sócio tem exatamente a mesma exceção, sem precisar receber papel admin.
reset role;
update public.deals set status_detail = '13. ESTEIRA AGIL'
 where id = '00000000-0000-0000-0000-0000000181d1';
set role authenticated;
select pg_temp.como181('00000000-0000-0000-0000-000000018102');
update public.deals set status_detail = '04. EM CONTRATO'
 where id = '00000000-0000-0000-0000-0000000181d1';
select pg_temp.ok181(
  (select public.deal_status_bare(status_detail) = 'EM CONTRATO'
     from public.deals where id = '00000000-0000-0000-0000-0000000181d1'),
  'sócio atua com a mesma liberdade do administrador');

-- Um novo envio Ágil procura a coluna homônima, mesmo com acento no nome.
reset role;
insert into public.cca_stages (id, name, color, position, status, active)
values ('00000000-0000-0000-0000-0000000181a1', 'ESTEIRA ÁGIL', '#16a34a', -181, 'under_review', true);
update public.deals set status_detail = '13. ESTEIRA AGIL', review_esteira = 'agil'
 where id = '00000000-0000-0000-0000-0000000181d1';
update public.cca_cases set status = 'under_review', submitted_at = now() + interval '1 second'
 where id = '00000000-0000-0000-0000-0000000181c1';
select pg_temp.ok181(
  (select stage_id = '00000000-0000-0000-0000-0000000181a1'
     from public.cca_cases where id = '00000000-0000-0000-0000-0000000181c1'),
  'envio Esteira Ágil entra na coluna Esteira Ágil');

rollback;

