-- =============================================================================
-- 0180 — cor livre e destinatários dos avisos do Pipeline/CCA.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok180(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.como180(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000018001', 'admin@v0180.test', '{"full_name":"Admin 0180"}'),
  ('00000000-0000-0000-0000-000000018002', 'diretor@v0180.test', '{"full_name":"Diretor 0180"}'),
  ('00000000-0000-0000-0000-000000018003', 'gerente@v0180.test', '{"full_name":"Gerente 0180"}'),
  ('00000000-0000-0000-0000-000000018004', 'corretor@v0180.test', '{"full_name":"Corretor 0180"}'),
  ('00000000-0000-0000-0000-000000018005', 'cca@v0180.test', '{"full_name":"CCA 0180"}')
on conflict do nothing;

insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000018001', 'admin'),
  ('00000000-0000-0000-0000-000000018002', 'director'),
  ('00000000-0000-0000-0000-000000018003', 'manager'),
  ('00000000-0000-0000-0000-000000018004', 'broker'),
  ('00000000-0000-0000-0000-000000018005', 'cca')
on conflict do nothing;

delete from public.closed_months where period = public.month_start(current_date);

insert into public.deals (id, stage_id, created_by, vgv_gross, status_detail)
select '00000000-0000-0000-0000-0000000180d1', id,
       '00000000-0000-0000-0000-000000018004', 180000, '16. PENDENTE'
  from public.pipeline_stages where code = 'under_analysis';

insert into public.deal_clients (deal_id, ordinal, full_name)
values ('00000000-0000-0000-0000-0000000180d1', 1, 'Cliente Avisado 0180');

insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
  ('00000000-0000-0000-0000-0000000180d1', '00000000-0000-0000-0000-000000018002', 'director', 1),
  ('00000000-0000-0000-0000-0000000180d1', '00000000-0000-0000-0000-000000018003', 'manager', 1),
  ('00000000-0000-0000-0000-0000000180d1', '00000000-0000-0000-0000-000000018004', 'broker', 1)
on conflict do nothing;

update public.deal_statuses set color = '#123ABC' where value = '04. EM CONTRATO';
select pg_temp.ok180(
  (select color = '#123ABC' from public.deal_statuses where value = '04. EM CONTRATO'),
  'Status 2 aceita cor hexadecimal livre');

set role authenticated;
select pg_temp.como180('00000000-0000-0000-0000-000000018001');
select public.move_deal_status('00000000-0000-0000-0000-0000000180d1', '04. EM CONTRATO');
reset role;

select pg_temp.ok180(
  (select count(distinct profile_id) = 3
     from public.notifications
    where kind = 'deal_status_changed'
      and title = 'Cliente Avisado 0180 foi para EM CONTRATO'
      and profile_id in (
        '00000000-0000-0000-0000-000000018002',
        '00000000-0000-0000-0000-000000018003',
        '00000000-0000-0000-0000-000000018004')),
  'Status 2 avisa corretor, gerente e diretor');

insert into public.cca_stages
  (id, name, color, position, status, active, deal_status_id, notify_sales)
values
  ('00000000-0000-0000-0000-0000000180c1', 'Entrada 0180', '#2563EB', 9801, 'under_review', true, null, false),
  ('00000000-0000-0000-0000-0000000180c2', 'Aprovado 0180', '#16A34A', 9802, 'approved', true,
   (select id from public.deal_statuses where value = '09. APROV. TOTAL'), true);

insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
values ('00000000-0000-0000-0000-0000000180d1', 'under_review',
        '00000000-0000-0000-0000-0000000180c1', now());

delete from public.notifications
 where profile_id in (
   '00000000-0000-0000-0000-000000018002',
   '00000000-0000-0000-0000-000000018003',
   '00000000-0000-0000-0000-000000018004');

set role authenticated;
select pg_temp.como180('00000000-0000-0000-0000-000000018005');
select public.move_cca_case(
  (select id from public.cca_cases where deal_id = '00000000-0000-0000-0000-0000000180d1'),
  '00000000-0000-0000-0000-0000000180c2',
  'Crédito aprovado no teste 0180');
reset role;

select pg_temp.ok180(
  (select count(distinct profile_id) = 3
     from public.notifications
    where kind = 'cca_status_changed'
      and profile_id in (
        '00000000-0000-0000-0000-000000018002',
        '00000000-0000-0000-0000-000000018003',
        '00000000-0000-0000-0000-000000018004')),
  'movimento do CCA avisa corretor, gerente e diretor sem excluir líderes');

select pg_temp.ok180(public.push_category('deal_status_changed') = 'credito',
  'movimento do Status 2 usa a categoria de push do crédito');

rollback;

