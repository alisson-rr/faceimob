\set ON_ERROR_STOP on
begin;
create function pg_temp.ok281(value boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(value,false) then raise exception 'FALHOU: %', label; end if;
  raise notice 'ok: %', label;
end $$;

update public.automation_settings set leads_paused=false, leads_recomeco_em=null;
update public.work_shifts set active=false;
insert into public.work_shifts(code,label,checkin_start,distribution_start,checkout_time)
values ('horario-281','Horário teste','08:30','09:00','18:00');
select pg_temp.ok281(not public.roleta_horario_aberto('2026-10-15 01:00:00-03'), '1h de São Paulo fica bloqueada');
select pg_temp.ok281(not public.roleta_horario_aberto('2026-10-15 08:59:59-03'), 'antes da abertura fica bloqueado');
select pg_temp.ok281(public.roleta_horario_aberto('2026-10-15 09:00:00-03'), 'abertura inclusiva');
select pg_temp.ok281(public.roleta_horario_aberto('2026-10-15 20:59:59+00'), 'converte UTC para São Paulo');
select pg_temp.ok281(not public.roleta_horario_aberto('2026-10-15 18:00:00-03'), 'encerramento exclusivo');
update public.work_shifts set active=false;
select pg_temp.ok281(not public.roleta_horario_aberto('2026-10-15 12:00:00-03'), 'turnos inativos não abrem a roleta');

do $$
declare
  corretor uuid := '00000000-0000-0000-0000-000000028101';
  grupo uuid;
  anterior uuid;
  retorno uuid;
  novo uuid;
  turno uuid;
  expirado uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (corretor,'corretor@hora281.test','{"full_name":"Corretor 281"}');
  insert into public.user_roles(profile_id,role) values (corretor,'broker') on conflict do nothing;
  insert into public.distribution_groups(name,slug,kind,active,deliver_without_checkin)
    values ('Grupo 281','grupo-281','specific',true,true) returning id into grupo;
  insert into public.distribution_group_members(group_id,profile_id,active) values (grupo,corretor,true);
  insert into public.leads(full_name,phone,status,assigned_to,distribution_group_id)
    values ('Contato anterior 281','11900281001','in_progress',corretor,grupo) returning id into anterior;
  insert into public.leads(full_name,phone,status,distribution_group_id)
    values ('Retorno 281','11900281001','queued',grupo) returning id into retorno;
  insert into public.leads(full_name,phone,status,distribution_group_id)
    values ('Novo 281','11900281002','queued',grupo) returning id into novo;

  perform pg_temp.ok281(public.assign_lead(retorno,true) is null, 'afinidade não fura horário nem com force');
  perform pg_temp.ok281(public.assign_lead(novo) is null, 'dispensar check-in não fura horário');
  perform pg_temp.ok281(public.assign_queued_leads()=0, 'dreno automático não entrega durante fechamento');
  perform pg_temp.ok281(not exists(select 1 from public.distribution_queue_interna(grupo)), 'fila fechada sem turno ativo');
  perform pg_temp.ok281(not exists(select 1 from public.lead_assignments where lead_id in (retorno,novo)), 'não cria entrega nem prazo durante fechamento');
  perform pg_temp.ok281((select bool_and(status='queued' and assigned_to is null and attend_deadline is null) from public.leads where id in (retorno,novo)), 'leads aguardam sem perda');

  insert into public.work_shifts(code,label,checkin_start,distribution_start,checkout_time)
    values ('aberto-281','Integral 281','00:00','00:00','23:59:59.999999') returning id into turno;
  perform pg_temp.ok281(public.assign_lead(retorno)=corretor, 'reabertura entrega retorno ao corretor anterior');
  perform pg_temp.ok281((select not counts_for_queue from public.lead_assignments where lead_id=retorno), 'afinidade continua sem consumir vez');
  perform pg_temp.ok281(public.assign_lead(novo)=corretor, 'reabertura entrega lead comum sem check-in');

  -- A presença ainda não encerrada pelo cron não permite receber após o fim do próprio turno.
  update public.lead_assignments set responded_at=now() where lead_id=novo;
  update public.distribution_groups set deliver_without_checkin=false where id=grupo;
  insert into public.work_shifts(code,label,checkin_start,distribution_start,checkout_time)
    values ('expirado-281','Expirado 281','00:00','00:00','00:00:00.000001') returning id into expirado;
  insert into public.checkins(profile_id,shift_id,work_date,checked_in_at)
    values (corretor,expirado,public.current_work_date(),now());
  perform pg_temp.ok281(not exists(select 1 from public.distribution_queue_interna(grupo)), 'checkout do cron atrasado não prolonga o turno');
end $$;
select pg_temp.ok281(not has_function_privilege('anon','public.assign_lead(uuid,boolean)','execute'), 'anônimo não distribui leads');
select pg_temp.ok281(not has_function_privilege('authenticated','public.assign_lead(uuid,boolean)','execute'), 'cliente não força entrega direta');
select pg_temp.ok281(not has_function_privilege('authenticated','public.roleta_horario_aberto(timestamptz)','execute'), 'relógio interno não permite execução pelo cliente');
rollback;
