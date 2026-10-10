-- =============================================================================
-- 0162 — check-in externo feito pelo diretor, com motivo.
--
-- Cenário: Equipe 0162 (diretora Dirce, gerente Gil) com Caio; Beto está fora
-- da equipe. Turno 00:00–23:59:59.999999 para `current_shift()` não depender do relógio.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.como(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

/** Espera que a chamada falhe com `p_code`; devolve a mensagem. */
create or replace function pg_temp.falha(p_sql text, p_code text, p_label text)
returns void
language plpgsql
as $$
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
  ('00000000-0000-0000-0000-000000016201', 'dirce@v0162.test', '{"full_name":"Dirce Diretora 0162"}'),
  ('00000000-0000-0000-0000-000000016202', 'gil@v0162.test',   '{"full_name":"Gil Gerente 0162"}'),
  ('00000000-0000-0000-0000-000000016203', 'caio@v0162.test',  '{"full_name":"Caio Corretor 0162"}'),
  ('00000000-0000-0000-0000-000000016204', 'beto@v0162.test',  '{"full_name":"Beto Corretor 0162"}')
on conflict do nothing;
insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000016201', 'director'),
  ('00000000-0000-0000-0000-000000016202', 'manager'),
  ('00000000-0000-0000-0000-000000016203', 'broker'),
  ('00000000-0000-0000-0000-000000016204', 'broker')
on conflict do nothing;
insert into public.teams (id, name, slug, director_id, manager_id) values
  ('00000000-0000-0000-0000-0000000162a1', 'Equipe 0162', 'equipe-0162',
   '00000000-0000-0000-0000-000000016201', '00000000-0000-0000-0000-000000016202');
insert into public.team_members (team_id, profile_id) values
  ('00000000-0000-0000-0000-0000000162a1', '00000000-0000-0000-0000-000000016203');
insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
values ('teste-0162', 'Integral 0162', '00:00', '00:00', '23:59:59.999999', -162);

set role authenticated;

select pg_temp.como('00000000-0000-0000-0000-000000016202');
select pg_temp.falha($$select public.director_external_checkin('00000000-0000-0000-0000-000000016203', 'Plantão no estande')$$,
  '42501', 'gerente não faz check-in externo');

select pg_temp.como('00000000-0000-0000-0000-000000016203');
select pg_temp.falha($$select public.director_external_checkin('00000000-0000-0000-0000-000000016203', 'Plantão no estande')$$,
  '42501', 'corretor não se libera sozinho');

select pg_temp.como('00000000-0000-0000-0000-000000016201');
select pg_temp.falha($$select public.director_external_checkin('00000000-0000-0000-0000-000000016204', 'Plantão no estande')$$,
  '42501', 'diretor não libera corretor de fora da equipe');
select pg_temp.falha($$select public.director_external_checkin('00000000-0000-0000-0000-000000016203', '  ok ')$$,
  'P0001', 'motivo curto é recusado');

do $$
declare
  v_row public.checkins;
begin
  select * into v_row
  from public.director_external_checkin('00000000-0000-0000-0000-000000016203', '  Plantão no estande do Jardim  ');
  if v_row.profile_id <> '00000000-0000-0000-0000-000000016203'
     or v_row.ip_address is not null
     or v_row.external_reason <> 'Plantão no estande do Jardim'
     or v_row.external_by <> '00000000-0000-0000-0000-000000016201'
     or v_row.checked_out_at is not null then
    raise exception 'FALHOU: linha do check-in externo errada: %', row_to_json(v_row);
  end if;
  -- O diretor lê o que gravou (checkins_select), com o motivo.
  if not exists (select 1 from public.checkins
                  where profile_id = '00000000-0000-0000-0000-000000016203'
                    and external_reason = 'Plantão no estande do Jardim') then
    raise exception 'FALHOU: diretor não enxerga o check-in externo';
  end if;
  raise notice '  ok  diretor faz o check-in externo com motivo registrado';
end
$$;

-- Escrita direta continua só do admin (0075): o motivo não entra por fora da RPC.
select pg_temp.falha($$insert into public.checkins (profile_id, shift_id, external_reason, external_by)
  select '00000000-0000-0000-0000-000000016203', id, 'por fora', '00000000-0000-0000-0000-000000016201'
    from public.work_shifts where code = 'teste-0162'$$,
  '42501', 'diretor não grava checkins direto');

reset role;
rollback;
