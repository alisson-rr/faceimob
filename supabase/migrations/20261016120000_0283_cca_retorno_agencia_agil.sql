-- Retorno operacional de caso já conferido: não representa um novo envio ao gerente.
insert into public.cca_stages(name,color,position,status,active,notify_sales)
select 'ESTEIRA ÁGIL','info',coalesce((select max(position) from public.cca_stages),0)+1,'under_review',true,true
where not exists(select 1 from public.cca_stages where public.cca_stage_name_key(name)='ESTEIRA AGIL');
update public.cca_stages set active=true,status='under_review',deal_status_id=null,notify_sales=true
where public.cca_stage_name_key(name)='ESTEIRA AGIL';

create or replace function public.cca_cases_return_agency_to_agile()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_deal public.deals;
begin
  if new.submitted_at is distinct from old.submitted_at
     or new.stage_id is not distinct from old.stage_id or not exists (
    select 1 from public.cca_stages where id=new.stage_id
      and public.cca_stage_name_key(name)='ESTEIRA AGIL'
  ) then return null; end if;
  if auth.uid() is null or not public.has_permission('cca.review')
     or coalesce(current_setting('faceimob.cca_move',true),'') <> 'on' then
    raise exception 'Use a ação Mover do CCA, com comentário, para retornar à Esteira Ágil.' using errcode='42501';
  end if;
  select * into v_deal from public.deals where id=new.deal_id for update;
  if old.status <> 'sent_to_agency' or new.status <> 'under_review'
     or public.cca_stage_name_key(v_deal.status_detail) is distinct from 'AG. RET. AGENCIA' then
    raise exception 'Somente casos aguardando retorno da agência podem voltar à Esteira Ágil por esta ação.' using errcode='P0001';
  end if;
  if v_deal.outcome in ('lost','cancelled','won')
     or exists(select 1 from public.closed_months where period=v_deal.month_base) then
    raise exception 'Não é possível retornar um negócio encerrado ou de mês fechado à Esteira Ágil.' using errcode='P0001';
  end if;
  update public.deals set status_detail='13. ESTEIRA AGIL' where id=new.deal_id;
  return null;
end $$;
revoke all on function public.cca_cases_return_agency_to_agile() from public,anon,authenticated;
create trigger zz_cca_return_agency_to_agile after update of stage_id on public.cca_cases
for each row execute function public.cca_cases_return_agency_to_agile();
notify pgrst,'reload schema';
