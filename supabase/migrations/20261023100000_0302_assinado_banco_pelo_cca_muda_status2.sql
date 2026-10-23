-- =============================================================================
-- 0302 · "Assinado banco" dado pelo CCA muda o Status 2 de todos
--
-- Pedido de 23/10/2026: o CCA move o caso para ASSINADO BANCO, mas o negócio
-- continua EM CONTRATO — no Status 2 e nos e-mails. "Queremos que vá para
-- assinado banco para todos ... ignorar [o ASSINADO do meio do caminho] se o
-- assinado banco for dado pelo CCA, e mudar o status de todos".
--
-- Por que ficava: `cca_cases_sync_esteira_label` (0282) só copia a coluna para
-- o Status 2 quando o mês-base do negócio está aberto. A assinatura no banco
-- sai semanas depois da venda, com o mês já fechado — o filtro pulava em
-- silêncio. Também cobre a coluna sem o vínculo com o Status 2.
--
--   1. A coluna ASSINADO BANCO aponta para "02. ASS. BANCO" (e ASSINADO para
--      "03. ASSINADO"), e o CCA avança o contrato (sem colocar EM CONTRATO).
--   2. Avanço de contrato pelo CCA (EM CONTRATO → ASSINADO → ASS. BANCO → RC
--      EMITIDA, em qualquer ordem entre eles) passa no mês fechado: muda só o
--      Status 2 e o que segue dele; o mês-base, o VGV e o rateio não mudam —
--      a venda continua no mês em que foi feita.
--   3. Quem já está na coluna ASSINADO BANCO e ficou parado vai para ASS. BANCO.
-- =============================================================================

-- 1. Vínculo das colunas e matriz do CCA -------------------------------------------
update public.cca_stages s
   set deal_status_id = ds.id
  from public.deal_statuses ds
 where public.cca_stage_name_key(s.name) = 'ASSINADO BANCO'
   and public.deal_status_bare(ds.value) = 'ASS. BANCO'
   and s.deal_status_id is distinct from ds.id;

update public.cca_stages s
   set deal_status_id = ds.id
  from public.deal_statuses ds
 where public.cca_stage_name_key(s.name) = 'ASSINADO'
   and public.deal_status_bare(ds.value) = 'ASSINADO'
   and s.deal_status_id is null;

-- O CCA avança o contrato: entra em ASSINADO, ASS. BANCO e RC EMITIDA e sai de
-- qualquer um deles. Colocar EM CONTRATO continua fora do CCA (0164).
insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select s.id, 'cca'::public.app_role, true, true
  from public.deal_statuses s
 where public.deal_status_bare(s.value) in ('ASSINADO', 'ASS. BANCO', 'RC EMITIDA')
on conflict (status_id, role) do update set can_enter = true, can_exit = true, updated_at = now();

insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select s.id, 'cca'::public.app_role, false, true
  from public.deal_statuses s
 where public.deal_status_bare(s.value) = 'EM CONTRATO'
on conflict (status_id, role) do update set can_exit = true, updated_at = now();

-- 2a. A trava do mês fechado aceita o avanço de contrato feito pelo CCA ------------
create or replace function public.deal_status_e_contrato(p_status text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(public.deal_status_bare(p_status) in ('EM CONTRATO', 'ASSINADO', 'ASS. BANCO', 'RC EMITIDA'), false);
$$;
revoke all on function public.deal_status_e_contrato(text) from public, anon;
grant execute on function public.deal_status_e_contrato(text) to authenticated, service_role;

create or replace function public.deals_guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := coalesce(new.month_base, old.month_base);
  v_reactivation text := coalesce(current_setting('faceimob.reactivate_deal', true), '');
  v_current_month date := public.month_start(
    coalesce(public.current_season_month(), current_date)
  );
begin
  if public.is_admin() or v_reactivation = new.id::text then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.cca_move', true), '') = 'on'
     and public.has_permission('deals.mark_distrato')
     and new.month_base is not distinct from old.month_base
     and new.month_base < v_current_month
     and public.deal_status_bare(new.status_detail) = 'DISTRATO' then
    return new;
  end if;

  -- Baixa da pendência (0286): só por `baixar_pendencia_contrato`, e só o selo
  -- de ligado para desligado. Coluna gerada (`vgv_net`) chega nula no BEFORE e
  -- não é escrita por ninguém: fica fora da comparação.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.baixa_pendencia', true), '') = new.id::text
     and old.contract_has_pending_issue and not new.contract_has_pending_issue
     and not exists (
       select 1
         from jsonb_each(to_jsonb(new)) n
         join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
          and n.key not in ('contract_has_pending_issue', 'updated_at')
          and n.key not in (select a.attname from pg_attribute a
                             where a.attrelid = 'public.deals'::regclass and a.attgenerated <> '')
     ) then
    return new;
  end if;

  -- Avanço de contrato pelo CCA (0302): só pela esteira (o gatilho da coluna liga o aviso),
  -- de um status de contrato para outro, e só o Status 2 e o que segue dele.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.cca_contrato', true), '') = new.id::text
     and public.deal_status_e_contrato(old.status_detail)
     and public.deal_status_e_contrato(new.status_detail)
     and not exists (
       select 1
         from jsonb_each(to_jsonb(new)) n
         join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
          and n.key not in ('status_detail', 'status_detail_changed_at', 'status_group_id', 'stage_id',
                            'stage_entered_at', 'outcome', 'closed_at', 'updated_at')
          and n.key not in (select a.attname from pg_attribute a
                             where a.attrelid = 'public.deals'::regclass and a.attgenerated <> '')
     ) then
    return new;
  end if;

  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_period, 'MM/YYYY') using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- 2b. A coluna do CCA leva o contrato ao Status 2 também no mês fechado -----------
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

  -- Pendência interna altera só o CCA, inclusive em competências comerciais fechadas.
  if not v_entrada and exists (
    select 1 from public.cca_stages s where s.id=new.stage_id
      and public.cca_stage_is_independent(s.name)
  ) then return null; end if;

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
    -- 0302: contrato para contrato passa no mês fechado (a trava confere).
    perform set_config('faceimob.cca_contrato', new.deal_id::text, true);
    update public.deals
       set status_detail = v_label
     where id = new.deal_id
       and status_detail is distinct from v_label
       and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'OFF')
       and outcome not in ('lost', 'cancelled')
       and (public.is_admin()
            or (public.deal_status_e_contrato(status_detail) and public.deal_status_e_contrato(v_label))
            or not exists (select 1 from public.closed_months cm where cm.period = deals.month_base));
    perform set_config('faceimob.cca_contrato', '', true);
  end if;

  return null;
end;
$$;

-- 3. Quem já está na coluna ASSINADO BANCO vai para ASS. BANCO ---------------------
do $$
declare
  r record;
  v_label text;
begin
  select ds.value into v_label from public.deal_statuses ds
   where public.deal_status_bare(ds.value) = 'ASS. BANCO'
   order by ds.active desc limit 1;
  if v_label is null then
    raise warning '[0302] Status 2 ASS. BANCO ausente; nada a corrigir.';
    return;
  end if;

  for r in
    select d.id
      from public.cca_cases c
      join public.cca_stages s on s.id = c.stage_id
      join public.deals d on d.id = c.deal_id
     where public.cca_stage_name_key(s.name) = 'ASSINADO BANCO'
       and public.deal_status_e_contrato(d.status_detail)
       and public.deal_status_bare(d.status_detail) <> 'ASS. BANCO'
       and d.outcome not in ('lost', 'cancelled')
  loop
    perform set_config('faceimob.cca_contrato', r.id::text, true);
    update public.deals set status_detail = v_label where id = r.id;
  end loop;
  perform set_config('faceimob.cca_contrato', '', true);
end;
$$;
