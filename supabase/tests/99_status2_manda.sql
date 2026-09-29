-- =============================================================================
-- 0164 — o Status 2 manda: quem coloca e quem tira por função, e a etapa segue.
--
-- Cenário: Equipe 0164 (diretora Dirce, gerente Gil) com Caio; Cris é CCA,
-- Ari é admin. Negócio do Caio, com Gil no rateio.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.como(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.falha(p_sql text, p_code text, p_label text)
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

create or replace function pg_temp.ok(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000016401', 'ari@v0164.test',   '{"full_name":"Ari Admin 0164"}'),
  ('00000000-0000-0000-0000-000000016402', 'dirce@v0164.test', '{"full_name":"Dirce Diretora 0164"}'),
  ('00000000-0000-0000-0000-000000016403', 'gil@v0164.test',   '{"full_name":"Gil Gerente 0164"}'),
  ('00000000-0000-0000-0000-000000016404', 'caio@v0164.test',  '{"full_name":"Caio Corretor 0164"}'),
  ('00000000-0000-0000-0000-000000016405', 'cris@v0164.test',  '{"full_name":"Cris CCA 0164"}')
on conflict do nothing;
insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000016401', 'admin'),
  ('00000000-0000-0000-0000-000000016402', 'director'),
  ('00000000-0000-0000-0000-000000016403', 'manager'),
  ('00000000-0000-0000-0000-000000016404', 'broker'),
  ('00000000-0000-0000-0000-000000016405', 'cca')
on conflict do nothing;
insert into public.teams (id, name, slug, director_id, manager_id) values
  ('00000000-0000-0000-0000-0000000164a1', 'Equipe 0164', 'equipe-0164',
   '00000000-0000-0000-0000-000000016402', '00000000-0000-0000-0000-000000016403');
insert into public.team_members (team_id, profile_id) values
  ('00000000-0000-0000-0000-0000000164a1', '00000000-0000-0000-0000-000000016404');

-- Em banco novo as etapas nascem no seed, depois das migrations: o vínculo
-- Status 2 → etapa da semente não casa nada. Aqui ele é dado para os status
-- que o teste usa (em produção a 0164 grava).
update public.deal_statuses s set stage_id = p.id
  from public.pipeline_stages p
 where (public.deal_status_bare(s.value), p.code) in
       (('APROV. TOTAL', 'approved'), ('EM CONTRATO', 'contract'), ('PENDENTE', 'under_analysis'));

insert into public.deals (id, stage_id, created_by, vgv_gross, status_detail)
select '00000000-0000-0000-0000-0000000164d1', id, '00000000-0000-0000-0000-000000016404', 250000, '16. PENDENTE'
  from public.pipeline_stages where code = 'under_analysis';

set role authenticated;

-- Corretor: não coloca em status da CCA nem tira de lá.
select pg_temp.como('00000000-0000-0000-0000-000000016404');
select pg_temp.falha($$select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', '12. EM PROCESSAMENTO')$$,
  '42501', 'corretor não coloca em "em processamento"');
select pg_temp.falha($$select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', '09. APROV. TOTAL')$$,
  '42501', 'corretor não aprova');
select pg_temp.falha($$select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', 'RET. ESTEIRA AGIL')$$,
  'P0001', 'voltar à análise é pelo envio ao gerente, não por troca de rótulo');
select pg_temp.falha($$select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', '18. QUEDA')$$,
  'P0001', 'encerrar é pelo diálogo de perda, com motivo');

-- CCA aprova; a etapa segue o Status 2 sem cobrar a matriz de etapa.
select pg_temp.como('00000000-0000-0000-0000-000000016405');
select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', '09. APROV. TOTAL');
select pg_temp.ok((select d.status_detail = '09. APROV. TOTAL' and p.code = 'approved'
                     from public.deals d join public.pipeline_stages p on p.id = d.stage_id
                    where d.id = '00000000-0000-0000-0000-0000000164d1'),
  'CCA aprova e a etapa vai para Aprovado');
select pg_temp.falha($$select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', '04. EM CONTRATO')$$,
  '42501', 'CCA não coloca em contrato');

-- Escrita direta também passa pela matriz (Select da tabela, formulário).
select pg_temp.como('00000000-0000-0000-0000-000000016404');
select pg_temp.falha($$update public.deals set status_detail = '08. VIROU NEGÓCIO' where id = '00000000-0000-0000-0000-0000000164d1'$$,
  '42501', 'corretor não vira negócio (só a CCA)');

-- Observação obrigatória onde o status pede.
reset role;
update public.deal_statuses set requires_note = true where public.deal_status_bare(value) = 'INCOMPLETO';
update public.deals set status_detail = 'PROPOSTA' where id = '00000000-0000-0000-0000-0000000164d1';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000016404');
select pg_temp.falha($$select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', 'INCOMPLETO')$$,
  'P0001', 'status com observação obrigatória recusa sem observação');
select pg_temp.falha($$update public.deals set status_detail = 'INCOMPLETO' where id = '00000000-0000-0000-0000-0000000164d1'$$,
  'P0001', 'escrita direta não pula a observação');
select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', 'INCOMPLETO', 'Falta o comprovante de renda');
select pg_temp.ok(exists (select 1 from public.deal_history
                           where deal_id = '00000000-0000-0000-0000-0000000164d1' and kind = 'comment'
                             and to_value like '%Falta o comprovante de renda'),
  'a observação fica no histórico do negócio');

-- Admin passa por cima da matriz: contrato.
select pg_temp.como('00000000-0000-0000-0000-000000016401');
select public.move_deal_status('00000000-0000-0000-0000-0000000164d1', '04. EM CONTRATO');
select pg_temp.ok((select p.code = 'contract' from public.deals d join public.pipeline_stages p on p.id = d.stage_id
                    where d.id = '00000000-0000-0000-0000-0000000164d1'), 'admin coloca em contrato');

-- Só o admin edita a matriz.
select pg_temp.como('00000000-0000-0000-0000-000000016402');
do $$
declare v_rows int;
begin
  update public.deal_status_permissions set can_enter = true where role = 'director';
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 0, 'diretor não edita a matriz');
end
$$;

-- Gerente do negócio também envia para análise (antes, só o corretor).
reset role;
insert into public.deal_participants (deal_id, profile_id, role)
values ('00000000-0000-0000-0000-0000000164d1', '00000000-0000-0000-0000-000000016403', 'manager')
on conflict do nothing;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000016403');
select pg_temp.falha($$select public.submit_deal_for_manager_review('00000000-0000-0000-0000-0000000164d1', 'Pendência resolvida', 'agil')$$,
  'P0001', 'gerente passa da checagem de papel no envio (barra adiante: falta construtora)');

reset role;
rollback;
