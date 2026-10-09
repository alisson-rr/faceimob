-- =============================================================================
-- 0249 · Coluna de pendência não devolve a conferência automaticamente
-- =============================================================================
-- Mover o caso dentro do CCA continua espelhando o Status 2. A conferência de
-- documentos só volta ao comercial por uma ação explícita: rejeição da
-- liderança ou `devolver_ao_comercial`. Antes, qualquer coluna cujo estado
-- técnico fosse pending_documents mudava `approved` para `returned` e gerava
-- e-mails "Análise devolvida para ajustes".

create or replace function public.cca_cases_sync_esteira_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entrada boolean := tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at;
  v_label text;
  v_mover_sem_status boolean := false;
begin
  if not v_entrada
     and new.status is not distinct from old.status
     and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  if v_entrada and new.status = 'under_review' then
    select case d.review_esteira
             when 'virar' then '15. ANÁLISE P/ VIRAR NEGÓCIO'
             else '13. ESTEIRA AGIL'
           end
      into v_label
      from public.deals d
     where d.id = new.deal_id;
  elsif not v_entrada and new.stage_id is distinct from old.stage_id then
    select ds.value into v_label
      from public.cca_stages s
      join public.deal_statuses ds on ds.id = s.deal_status_id
     where s.id = new.stage_id;
    v_mover_sem_status := v_label is null
      and coalesce(current_setting('faceimob.cca_move', true), '') = 'on';
  end if;

  if v_label is null and not v_mover_sem_status
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    v_label := case new.status
      when 'under_review'      then '13. ESTEIRA AGIL'
      when 'pending_documents' then 'RET. ESTEIRA AGIL'
      when 'approved'          then '09. APROV. TOTAL'
      when 'sent_to_developer' then 'ANÁLISE EXTERNA'
      when 'sent_to_agency'    then 'ANÁLISE EXTERNA'
      else null
    end;
  end if;

  if v_label is not null then
    update public.deals
       set status_detail = v_label
     where id = new.deal_id
       and status_detail is distinct from v_label
       and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'OFF')
       and outcome not in ('lost', 'cancelled')
       and (public.is_admin()
            or not exists (select 1 from public.closed_months cm where cm.period = deals.month_base));
  end if;

  return null;
end;
$$;

revoke all on function public.cca_cases_sync_esteira_label() from public, anon, authenticated;

comment on function public.cca_cases_sync_esteira_label() is
  'Espelha entrada/coluna CCA no Status 2 sem devolver a conferência. Devolução é somente por ação explícita (0249).';
