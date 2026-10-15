-- 0282: pendências internas do CCA, movimento idempotente e síntese sem repetição.
create or replace function public.cca_stage_is_independent(p_name text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select coalesce(public.cca_stage_name_key(p_name) in
    ('RESOLVER P/ ASSINAR BANCO','AGUARDANDO DEMANDA MINIMA'),false);
$$;
revoke all on function public.cca_stage_is_independent(text) from public,anon;
grant execute on function public.cca_stage_is_independent(text) to authenticated,service_role;
comment on column public.automation_settings.cca_move_email is
  'Liga e-mails nos movimentos comuns do CCA. Pendências internas sempre avisam os responsáveis por e-mail (0282).';

update public.cca_stages set deal_status_id=null,notify_sales=true
 where public.cca_stage_is_independent(name);
-- Permanecem no catálogo para preservar referências históricas, fora das opções comerciais.
update public.deal_statuses set active=false where public.cca_stage_is_independent(value);
-- Desde 0242 a RPC já inclui diretores; o gatilho antigo enviava o mesmo aviso de novo.
drop trigger if exists notify_cca_director_move on public.cca_cases;

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
  if v_case.stage_id = v_stage.id then
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

create or replace function public.cca_monthly_synthesis(p_month date)
returns table (
  event_id uuid,
  deal_id uuid,
  stage_name text,
  entered_at timestamptz,
  deal_code text,
  client_name text,
  developer_name text,
  project_name text,
  broker_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not (public.is_admin() or public.has_permission('cca.review')) then
    raise exception 'Seu perfil não consulta as sínteses do CCA.' using errcode = '42501';
  end if;
  if p_month is null then raise exception 'Escolha o mês das sínteses.' using errcode = 'P0001'; end if;

  v_start := make_timestamptz(extract(year from p_month)::int, extract(month from p_month)::int,
                              1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';

  return query
  with movimentos as (
    select h.id, h.deal_id, h.created_at,
           btrim(split_part(substr(h.to_value, length('STATUS: ') + 1), ' — ', 1)) as stage
      from public.deal_history h
     where h.kind = 'comment'
       and h.to_value like 'STATUS: % — %'
       and h.created_at >= v_start and h.created_at < v_end
  ), unicos as (
    select distinct on (m.deal_id, public.cca_stage_name_key(m.stage)) m.*
      from movimentos m
     order by m.deal_id, public.cca_stage_name_key(m.stage), m.created_at, m.id
  )
  select m.id, m.deal_id, m.stage, m.created_at, d.code,
         c.full_name, dev.name, d.project_name,
         brokers.names
    from unicos m
    join public.deals d on d.id = m.deal_id
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
    left join public.developers dev on dev.id = d.developer_id
    left join lateral (
      select string_agg(p.full_name, ', ' order by dp.share_pct desc, p.full_name) as names
        from public.deal_participants dp
        join public.profiles p on p.id = dp.profile_id
       where dp.deal_id = d.id and dp.role = 'broker'
    ) brokers on true
   where public.deal_status_bare(m.stage) in
     ('INCONFORME CEOPF', 'RESOLVER P/ ASSINAR BANCO',
      'AGUARDANDO DEMANDA MÍNIMA', 'ASSINADO BANCO')
   order by m.created_at, m.id;
end;
$$;

revoke all on function public.cca_monthly_synthesis(date) from public, anon;
grant execute on function public.cca_monthly_synthesis(date) to authenticated, service_role;

comment on function public.cca_monthly_synthesis(date) is
  'Agrupa as quatro sínteses solicitadas pelo mês em que o CCA entrou no status, usando deal_history.created_at e nunca o mês-base da venda.';

-- Publica imediatamente a assinatura corrigida no PostgREST.
notify pgrst, 'reload schema';

