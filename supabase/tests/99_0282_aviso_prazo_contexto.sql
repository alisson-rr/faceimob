\set ON_ERROR_STOP on
begin;
do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002820001';
  lead_id uuid; assignment_id uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor,'cor@a282.test','{"full_name":"Corretor 282"}');
  update public.automation_settings set notify_on_timeout=true where id;
  insert into public.leads(full_name,phone,status,assigned_to)
    values ('Cliente do aviso 282','11955550282','assigned',cor) returning id into lead_id;
  insert into public.lead_assignments(lead_id,profile_id,assigned_at,deadline)
    values (lead_id,cor,'2026-10-28 15:00:00+00','2026-10-28 15:10:00+00') returning id into assignment_id;
  update public.lead_assignments set released_at='2026-10-28 15:10:00+00',release_reason='timeout' where id=assignment_id;
  if not exists(select 1 from public.notifications where profile_id=cor and kind='lead_lost_timeout'
    and channel='in_app' and title like '%Cliente do aviso 282%' and body like '%final 0282%'
    and body like '%28/10/2026 12:00%' and body like '%28/10/2026 12:10%'
    and body like '%Aguardando atendimento%' and link='/leads') then
    raise exception 'FALHOU: aviso não identifica lead, horários e orientação';
  end if;
  if exists(select 1 from public.notifications where profile_id=cor and kind='lead_lost_timeout'
    and body like '%11955550282%') then raise exception 'FALHOU: telefone completo no aviso'; end if;
  update public.lead_assignments set released_at='2026-10-28 15:11:00+00' where id=assignment_id;
  if (select count(*) from public.notifications where profile_id=cor and kind='lead_lost_timeout') <> 2 then
    raise exception 'FALHOU: aviso duplicado ao atualizar liberação antiga';
  end if;
  insert into public.lead_assignments(lead_id,profile_id,sequence,deadline,responded_at,counts_for_queue)
    values(lead_id,cor,2,now(),now(),false) returning id into assignment_id;
  update public.lead_assignments set released_at=now(),release_reason='reassigned' where id=assignment_id;
  if (select count(*) from public.notifications where profile_id=cor and kind='lead_lost_timeout') <> 2 then
    raise exception 'FALHOU: repasse manual confundido com prazo';
  end if;
  raise notice 'ok: prazo identificado, parcial do telefone, horários de São Paulo e idempotência';
end;
$$;
rollback;
