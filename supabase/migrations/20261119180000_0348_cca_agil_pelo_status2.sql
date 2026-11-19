-- =============================================================================
-- 0348 · CCA move para a Esteira Ágil pelo Status 2 da agência
--
-- 19/11/2026: depois da 0347 a opção "ESTEIRA ÁGIL" sumiu do Mover do caso do
-- Silvio. A 0347 exigia o caso `sent_to_agency`; na 1ª tentativa (antes da
-- 0347) o Mover já tinha levado o caso para a etapa ESTEIRA ÁGIL com status
-- `under_review`, mas o Status 2 seguiu "11. AG. RET. AGENCIA" — o card ficou
-- na coluna da agência e, para a regra nova, ele "não estava na agência".
-- Quem manda na coluna é o Status 2 (0150), então é ele que decide:
--  · o retorno vale para todo caso com Status 2 AG. RET. AGENCIA;
--  · `move_cca_case` deixa refazer o movimento do caso que já tem a etapa
--    ESTEIRA ÁGIL mas o Status 2 da agência (o preso da 1ª tentativa).
-- =============================================================================

create or replace function public.cca_cases_return_agency_to_agile()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_deal public.deals;
begin
  -- Envio (aprovação do gerente, reenvio): não é retorno da agência.
  if new.submitted_at is distinct from old.submitted_at or not exists (
    select 1 from public.cca_stages where id=new.stage_id
      and public.cca_stage_name_key(name)='ESTEIRA AGIL'
  ) then return null; end if;
  select * into v_deal from public.deals where id=new.deal_id for update;
  -- 0348: quem decide é o Status 2 (a coluna do card), não o status do caso:
  -- o caso preso da 1ª tentativa já não estava `sent_to_agency`.
  if public.cca_stage_name_key(v_deal.status_detail) is distinct from 'AG. RET. AGENCIA' then
    if new.stage_id is distinct from old.stage_id then
      raise exception 'Somente casos aguardando retorno da agência podem voltar à Esteira Ágil por esta ação.' using errcode='P0001';
    end if;
    return null;
  end if;
  if auth.uid() is null or not public.has_permission('cca.review')
     or coalesce(current_setting('faceimob.cca_move',true),'') <> 'on' then
    raise exception 'Use a ação Mover do CCA, com comentário, para retornar à Esteira Ágil.' using errcode='42501';
  end if;
  if v_deal.outcome in ('lost','cancelled','won')
     or exists(select 1 from public.closed_months where period=v_deal.month_base) then
    raise exception 'Não é possível retornar um negócio encerrado ou de mês fechado à Esteira Ágil.' using errcode='P0001';
  end if;
  update public.deals set status_detail='13. ESTEIRA AGIL' where id=new.deal_id;
  return null;
end $$;
revoke all on function public.cca_cases_return_agency_to_agile() from public,anon,authenticated;

create or replace function public.move_cca_case(p_case_id uuid, p_stage_id uuid, p_message text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_case public.cca_cases;
  v_stage public.cca_stages;
  v_message text := btrim(coalesce(p_message, ''));
  v_code text;
  v_ator_nome text;
  v_cliente text;
  v_email boolean;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not public.has_permission('cca.review') then
    raise exception 'Seu perfil não move casos na esteira do CCA.' using errcode = '42501';
  end if;
  if v_message = '' then
    raise exception 'Escreva a mensagem da movimentação: ela fica registrada no negócio e avisa a equipe.' using errcode = 'P0001';
  end if;
  if length(v_message) > 4000 then raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001'; end if;

  select * into v_stage from public.cca_stages where id = p_stage_id and active;
  if not found then raise exception 'Coluna da esteira não encontrada ou desativada.' using errcode = 'P0001'; end if;
  select * into v_case from public.cca_cases where id = p_case_id for update;
  if not found then raise exception 'Caso não encontrado.' using errcode = 'P0002'; end if;

  -- A trava da linha serializa cliques concorrentes: o segundo lê o destino já gravado.
  -- 0348: o caso que ficou com a etapa ESTEIRA ÁGIL mas o Status 2 da agência
  -- (antes da 0347 o Mover não levava o Status 2) refaz o movimento.
  if v_case.stage_id = v_stage.id
     and not (public.cca_stage_name_key(v_stage.name) = 'ESTEIRA AGIL'
              and public.cca_stage_name_key((select d.status_detail from public.deals d where d.id = v_case.deal_id))
                  = 'AG. RET. AGENCIA') then
    return jsonb_build_object('case_id',v_case.id,'deal_id',v_case.deal_id,
      'stage_id',v_stage.id,'status',v_case.status,'already_moved',true);
  end if;

  perform set_config('faceimob.cca_move', 'on', true);
  update public.cca_cases
     set stage_id = v_stage.id, status = v_stage.status, decision_notes = v_message,
         decided_at = case when v_stage.status not in ('approved', 'rejected') then null
                           when v_stage.status = v_case.status then coalesce(v_case.decided_at, now())
                           else now() end
   where id = p_case_id;
  perform set_config('faceimob.cca_move', '', true);

  select d.code into v_code from public.deals d where d.id = v_case.deal_id;
  select p.full_name into v_ator_nome from public.profiles p where p.id = auth.uid();
  select c.full_name into v_cliente from public.deal_clients c
   where c.deal_id = v_case.deal_id and c.ordinal = 1;
  select s.cca_move_email into v_email from public.automation_settings s where s.id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (v_case.deal_id, auth.uid(), 'comment', 'STATUS: ' || v_stage.name || ' — ' || v_message);

  if v_stage.notify_sales or public.cca_stage_is_independent(v_stage.name) then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select distinct dp.profile_id, 'cca_status_changed',
           format('Crédito %s: %s', coalesce(v_code, 'negócio sem código'), v_stage.name),
           left(format('%s moveu para "%s": %s', coalesce(v_ator_nome, 'Alguém'), v_stage.name, v_message), 2000),
           '/pipeline', 'in_app'::notification_channel
      from public.deal_participants dp
      join public.profiles p on p.id = dp.profile_id and p.status = 'active'
     where dp.deal_id = v_case.deal_id and dp.role in ('broker', 'manager', 'director')
       and dp.profile_id <> auth.uid()
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = dp.profile_id and n.kind = 'document_review_returned'
            and n.title = public.texto_com_nome_do_cliente('CCA devolveu o dossiê: ' || v_code)
            and n.created_at >= now());
  end if;

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         v_case.deal_id, p.id, btrim(p.email::text), v_code, v_cliente, v_stage.name,
         coalesce(v_ator_nome, 'Sistema'), v_message, 'cca',
         public.email_detalhes_do_negocio(v_case.deal_id)
           || jsonb_build_object('status2', (select status_detail from public.deals where id = v_case.deal_id), 'status_cca', v_stage.name, 'observacao', v_message)
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = v_case.deal_id
         and dp.role in ('broker', 'manager', 'director')
      union
      select auth.uid() where auth.uid() is not null
      union
      select ur.profile_id from public.user_roles ur where ur.role = 'cca'
    ) destino
    join public.profiles p on p.id = destino.pid and p.status = 'active'
   where (coalesce(v_email, false) or public.cca_stage_is_independent(v_stage.name))
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;

  return jsonb_build_object('case_id', v_case.id, 'deal_id', v_case.deal_id,
                            'stage_id', v_stage.id, 'status', v_stage.status);
end;
$$;
revoke all on function public.move_cca_case(uuid, uuid, text) from public, anon;
grant execute on function public.move_cca_case(uuid, uuid, text) to authenticated, service_role;
drop trigger if exists zz_cca_return_agency_to_agile on public.cca_cases;
create trigger zz_cca_return_agency_to_agile after update of stage_id on public.cca_cases
for each row execute function public.cca_cases_return_agency_to_agile();
