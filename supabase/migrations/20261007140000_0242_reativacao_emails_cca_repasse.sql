-- =============================================================================
-- 0242 · OFF histórico, fluxos para virar negócio, e-mails, CCA e repasse
-- =============================================================================

-- Os dois caminhos continuam sendo fluxos operacionais ativos. Em instalações
-- onde foram desativados pelo cadastro, a implantação os devolve ao catálogo.
update public.deal_statuses
   set active = true
 where public.deal_status_bare(value) in
       ('PENDENTE P/ VIRAR NEGÓCIO', 'ANÁLISE P/ VIRAR NEGÓCIO');

-- A equipe CCA pode configurar as próprias colunas. Tipos de documento seguem
-- restritos a admin/sócio pela policy separada `document_types_write`.
drop policy if exists cca_stages_write on public.cca_stages;
create policy cca_stages_write on public.cca_stages
  for all to authenticated
  using (public.is_admin() or public.has_role('cca'))
  with check (public.is_admin() or public.has_role('cca'));

-- ANÁLISE EXTERNA: somente liderança (e admin, pelo bypass já existente) pode
-- registrar o retorno como aprovação total ou condicionada. A exceção é da
-- transição; ela não libera gerente/diretor para outros movimentos da CCA.
create or replace function public.deal_status_move_block(p_from text, p_to text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from public.deal_statuses;
  v_to   public.deal_statuses;
begin
  if public.is_admin() then return null; end if;

  if public.deal_status_bare(p_from) = 'REPROVADO'
     and public.deal_status_bare(p_to) = 'OFF' then
    return null;
  end if;

  if public.deal_status_bare(p_from) = 'ANÁLISE EXTERNA'
     and public.deal_status_bare(p_to) in ('APROV. TOTAL', 'APROV. COND.')
     and public.has_any_role('manager', 'director') then
    return null;
  end if;

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_to)
   order by active desc limit 1;
  if not found then return 'Este Status 2 não está no cadastro.'; end if;

  select * into v_from from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_from)
   order by active desc limit 1;

  if v_from.id is not null and v_from.id <> v_to.id and not exists (
    select 1 from public.deal_status_permissions p
     where p.status_id = v_from.id and p.can_exit and public.has_any_role(p.role)
  ) then
    return format('Seu perfil não tira o negócio de "%s".', v_from.label);
  end if;

  if not exists (
    select 1 from public.deal_status_permissions p
     where p.status_id = v_to.id and p.can_enter and public.has_any_role(p.role)
  ) then
    return format('Seu perfil não coloca o negócio em "%s".', v_to.label);
  end if;
  return null;
end;
$$;
revoke all on function public.deal_status_move_block(text, text) from public, anon;
grant execute on function public.deal_status_move_block(text, text) to authenticated, service_role;
comment on function public.deal_status_move_block(text, text) is
  'Matriz de Status 2, com REPROVADO→OFF e ANÁLISE EXTERNA→APROV. TOTAL/COND. pela liderança.';

-- Os interruptores ficam ligados na implantação; credenciais/worker continuam
-- sendo a última camada de entrega. Assim o banco não descarta novos avisos.
update public.automation_settings
   set pipeline_move_email = true,
       cca_move_email = true,
       conferencia_email = true;

-- Pipeline: participantes atuais E a pessoa que fez a ação recebem. A união por
-- profile_id e o DISTINCT por endereço evitam duplicidade quando o ator também
-- é corretor/gerente/diretor do negócio.
create or replace function public.deals_queue_status_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message text;
  v_actor text;
  v_client text;
  v_status1 text;
  v_status2 text;
begin
  if new.status_group_id is not distinct from old.status_group_id
     and new.status_detail is not distinct from old.status_detail then return null; end if;
  if coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then return null; end if;
  if not coalesce((select pipeline_move_email from public.automation_settings where id), false) then return null; end if;

  perform set_config('faceimob.saiu_da_venda',
    case when exists (select 1 from public.deal_status_groups g where g.id = old.status_group_id and g.code = 'VENDA')
         then 'on' else '' end, true);
  select full_name into v_actor from public.profiles where id = auth.uid();
  select full_name into v_client from public.deal_clients where deal_id = new.id and ordinal = 1;
  select label into v_status1 from public.deal_status_groups where id = new.status_group_id;
  select label into v_status2 from public.deal_statuses where value = new.status_detail;
  v_status2 := coalesce(v_status2, public.deal_status_bare(new.status_detail), 'Sem Status 2');
  v_message := concat_ws(E'\n',
    case when new.status_group_id is distinct from old.status_group_id then
      'Status 1: ' || coalesce((select label from public.deal_status_groups where id = old.status_group_id), 'Sem Status 1')
        || ' → ' || coalesce(v_status1, 'Sem Status 1') end,
    case when new.status_detail is distinct from old.status_detail then
      'Status 2: ' || coalesce(public.deal_status_bare(old.status_detail), 'Sem Status 2') || ' → ' || v_status2 end);

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text))) new.id, p.id, btrim(p.email::text),
    new.code, v_client, concat_ws(' · ', v_status1, v_status2), coalesce(v_actor, 'Sistema'), v_message, 'pipeline',
    public.email_detalhes_do_negocio(new.id) || jsonb_strip_nulls(jsonb_build_object(
      'status2_antes', case when new.status_detail is distinct from old.status_detail
                            then coalesce((select label from public.deal_statuses where value = old.status_detail),
                                          public.deal_status_bare(old.status_detail)) end,
      'observacao', nullif(btrim(coalesce(current_setting('faceimob.status_note', true), '')), '')))
  from (
    select dp.profile_id from public.deal_participants dp
     where dp.deal_id = new.id and dp.role in ('broker', 'manager', 'director')
    union
    select auth.uid() where auth.uid() is not null
  ) destinatario
  join public.profiles p on p.id = destinatario.profile_id
  where p.status = 'active'
    and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    and p.email::text !~* '@sem-email\.local$'
  order by lower(btrim(p.email::text)), p.id;
  perform set_config('faceimob.saiu_da_venda', '', true);
  return null;
end;
$$;
revoke all on function public.deals_queue_status_email() from public, anon, authenticated;

-- Conferência: os participantes, o ator e (quando segue à análise de crédito)
-- toda a equipe CCA recebem o e-mail pertinente.
create or replace function public.avisar_conferencia()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ator uuid := auth.uid();
  v_evento text;
  v_titulo text;
  v_mensagem text;
  v_cliente text;
  v_ator_nome text;
  v_push text[];
  v_email text[];
  v_admin boolean;
  v_cca boolean;
  v_kind text;
begin
  if new.document_review_status is not distinct from old.document_review_status then return null; end if;

  if new.document_review_status = 'pending' then
    v_evento := 'Análise enviada para conferência';
    v_kind := 'document_review_requested';
    v_push := array['broker', 'director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := true; v_cca := false;
    select h.to_value into v_mensagem from public.deal_history h
     where h.deal_id = new.id and h.kind = 'comment' order by h.created_at desc limit 1;
  elsif new.document_review_status = 'approved' then
    v_evento := 'Análise aprovada e enviada ao CCA';
    v_kind := 'document_review_approved';
    v_push := array['manager', 'director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := true; v_cca := true;
    v_mensagem := 'A conferência foi aprovada e o negócio seguiu para a análise de crédito.';
  elsif new.document_review_status = 'returned' then
    v_evento := 'Análise devolvida para ajustes';
    v_kind := 'document_review_returned';
    v_push := array['director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := false; v_cca := false;
    v_mensagem := coalesce(new.document_review_reason, 'A documentação voltou para ajustes.');
  else
    return null;
  end if;

  select nullif(btrim(c.full_name), '') into v_cliente from public.deal_clients c
   where c.deal_id = new.id and c.ordinal = 1;
  select full_name into v_ator_nome from public.profiles where id = v_ator;
  v_titulo := v_evento || ': ' || coalesce(v_cliente, new.code, 'negócio');

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct q.pid, v_kind, v_titulo, left(coalesce(v_mensagem, ''), 2000),
         case when v_kind = 'document_review_requested' then '/pipeline?conferencia=pendente' else '/pipeline' end,
         'in_app'::notification_channel
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = new.id and dp.role::text = any (v_push)
      union
      select ur.profile_id from public.user_roles ur where v_admin and ur.role in ('admin', 'partner')
    ) q
    join public.profiles p on p.id = q.pid and p.status = 'active'
   where q.pid is distinct from v_ator
     and not exists (
       select 1 from public.deal_participants x
        where x.deal_id = new.id and x.profile_id = q.pid
          and x.role::text = case new.document_review_status when 'pending' then 'manager' else 'broker' end);

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         new.id, p.id, btrim(p.email::text), new.code, v_cliente, v_evento, coalesce(v_ator_nome, 'Sistema'),
         coalesce(v_mensagem, ''), 'conferencia',
         public.email_detalhes_do_negocio(new.id)
           || jsonb_build_object('status2', v_evento, 'observacao', coalesce(v_mensagem, ''))
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = new.id and dp.role::text = any (v_email)
      union
      select v_ator where v_ator is not null
      union
      select ur.profile_id from public.user_roles ur where v_cca and ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.pid and p.status = 'active'
   where coalesce((select s.conferencia_email from public.automation_settings s where s.id), false)
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;
  return null;
end;
$$;
revoke all on function public.avisar_conferencia() from public, anon, authenticated;

-- Movimento CCA: o sino continua poupando o ator, mas o e-mail alcança todos os
-- responsáveis, quem realizou a ação e as usuárias ativas da CCA.
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
  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (v_case.deal_id, auth.uid(), 'comment', 'STATUS: ' || v_stage.name || ' — ' || v_message);

  if v_stage.notify_sales then
    select s.cca_move_email into v_email from public.automation_settings s where s.id;
    select c.full_name into v_cliente from public.deal_clients c
     where c.deal_id = v_case.deal_id and c.ordinal = 1;

    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select distinct dp.profile_id, 'cca_status_changed',
           format('Crédito %s: %s', coalesce(v_code, 'negócio sem código'), v_stage.name),
           left(format('%s moveu para "%s": %s', coalesce(v_ator_nome, 'Alguém'), v_stage.name, v_message), 2000),
           '/pipeline', 'in_app'
      from public.deal_participants dp
      join public.profiles p on p.id = dp.profile_id and p.status = 'active'
     where dp.deal_id = v_case.deal_id and dp.role in ('broker', 'manager', 'director')
       and dp.profile_id <> auth.uid()
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = dp.profile_id and n.kind = 'document_review_returned'
            and n.title = 'CCA devolveu o dossiê: ' || v_code and n.created_at >= now());

    insert into public.cca_move_emails
      (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
    select distinct on (lower(btrim(p.email::text)))
           v_case.deal_id, p.id, btrim(p.email::text), v_code, v_cliente, v_stage.name,
           coalesce(v_ator_nome, 'Sistema'), v_message, 'cca',
           public.email_detalhes_do_negocio(v_case.deal_id)
             || jsonb_build_object('status2', v_stage.name, 'observacao', v_message)
      from (
        select dp.profile_id as pid from public.deal_participants dp
         where dp.deal_id = v_case.deal_id and dp.role in ('broker', 'manager', 'director')
        union
        select auth.uid() where auth.uid() is not null
        union
        select ur.profile_id from public.user_roles ur where ur.role = 'cca'
      ) destino
      join public.profiles p on p.id = destino.pid and p.status = 'active'
     where coalesce(v_email, false)
       and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
       and p.email::text !~* '@sem-email\.local$'
     order by lower(btrim(p.email::text)), p.id;
  end if;

  return jsonb_build_object('case_id', v_case.id, 'deal_id', v_case.deal_id,
                            'stage_id', v_stage.id, 'status', v_stage.status);
end;
$$;
revoke all on function public.move_cca_case(uuid, uuid, text) from public, anon;
grant execute on function public.move_cca_case(uuid, uuid, text) to authenticated, service_role;

-- Repasse manual mantém ambos os corretores na ordem da roleta. A atribuição
-- continua existindo (prazo, histórico e `notify_lead_assigned`), mas não conta
-- como uma vez automática nem como bloqueio "com lead" da fila.
alter table public.lead_assignments
  add column if not exists counts_for_queue boolean not null default true;
comment on column public.lead_assignments.counts_for_queue is
  'False em repasse manual entre colegas: mantém prazo/notificação sem alterar a roleta.';

create or replace function public.reassign_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_timeout int;
  v_actor uuid := auth.uid();
  v_previous_owner uuid;
  v_by_permission boolean;
  v_by_owner boolean;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead não encontrado.' using errcode = 'P0002'; end if;
  v_previous_owner := v_lead.assigned_to;
  v_by_permission := public.has_permission('leads.reassign');
  v_by_owner := coalesce(v_lead.assigned_to = v_actor, false) and public.has_role('broker');
  if not (v_by_permission or v_by_owner) then
    raise exception 'Você só pode repassar leads que estão com você.' using errcode = '42501';
  end if;
  if v_by_owner and not v_by_permission and v_lead.status not in ('assigned', 'attending', 'in_progress') then
    raise exception 'Este lead já foi encerrado ou saiu da sua carteira.' using errcode = 'P0001';
  end if;
  if p_target = v_previous_owner then raise exception 'Escolha outro corretor para receber o lead.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_target and p.status = 'active'
      and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'broker')
  ) then raise exception 'O corretor escolhido não existe ou está inativo.' using errcode = 'P0002'; end if;
  if v_by_permission and not v_by_owner and not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para realocar para este corretor.' using errcode = '42501';
  end if;
  if v_by_permission and not v_by_owner and not coalesce(
       case when v_lead.assigned_to is null then p_lead_id in (select public.auth_queue_lead_ids())
            else v_lead.assigned_to in (select public.auth_visible_profiles()) end, false) then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  update public.lead_assignments set released_at = now(), release_reason = 'reassigned'
   where lead_id = p_lead_id and released_at is null;
  v_timeout := public.effective_attend_timeout(v_lead.distribution_group_id);
  insert into public.lead_assignments
    (lead_id, profile_id, group_id, sequence, deadline, counts_for_queue)
  select p_lead_id, p_target, v_lead.distribution_group_id,
         coalesce(max(la.sequence), 0) + 1, now() + make_interval(secs => v_timeout), false
    from public.lead_assignments la where la.lead_id = p_lead_id;

  update public.leads
     set status = 'assigned', assigned_to = p_target, assigned_at = now(),
         attend_deadline = now() + make_interval(secs => v_timeout), last_activity_at = now()
   where id = p_lead_id returning * into v_lead;
  insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value, detail)
  values (p_lead_id, v_actor, 'reassigned', v_previous_owner::text, p_target::text,
          jsonb_build_object('manual', true, 'by_owner', v_by_owner, 'counts_for_queue', false));
  return v_lead;
end;
$$;
revoke all on function public.reassign_lead(uuid, uuid) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid) to authenticated;

create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with eligible as (
    select c.profile_id, p.full_name,
      (select max(la.assigned_at) from public.lead_assignments la
        where la.profile_id = c.profile_id and la.counts_for_queue) as last_assigned_at,
      (select max(case when la.release_reason = 'timeout' then la.released_at else la.assigned_at end)
         from public.lead_assignments la
        where la.profile_id = c.profile_id and la.counts_for_queue) as last_turn_at,
      c.checked_in_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date() and c.checked_out_at is null
      and m.group_id = p_group_id and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
      and not exists (
        select 1 from public.lead_assignments la where la.profile_id = c.profile_id
          and la.counts_for_queue and la.released_at is null and la.responded_at is null)
  )
  select e.profile_id, e.full_name,
         row_number() over (order by greatest(e.checked_in_at, e.last_turn_at), e.profile_id)::int,
         e.last_assigned_at, e.last_turn_at
    from eligible e;
$$;
revoke all on function public.distribution_queue_interna(uuid) from public, anon, authenticated;
grant execute on function public.distribution_queue_interna(uuid) to service_role;

create or replace function public.fila_em_formacao()
returns table (group_id uuid, group_name text, profile_id uuid, full_name text,
  posicao integer, situacao text, checked_in_at timestamptz, abre_as text,
  last_turn_at timestamptz, atrasados integer)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  return query
  with presentes as (
    select g.id g_id, g.name g_name, c.profile_id p_id, p.full_name p_nome,
      c.checked_in_at entrou, s.distribution_start abre,
      (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start aberta,
      public.overdue_lead_count(c.profile_id) atrasos,
      exists (select 1 from public.lead_assignments la where la.profile_id = c.profile_id
               and la.counts_for_queue and la.released_at is null and la.responded_at is null) com_lead,
      (select max(case when la.release_reason = 'timeout' then la.released_at else la.assigned_at end)
         from public.lead_assignments la where la.profile_id = c.profile_id and la.counts_for_queue) ultima_vez
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date() and c.checked_out_at is null and p.status = 'active'
  ), classificados as (
    select pr.*, case
      when pr.atrasos >= (select a.overdue_block_threshold from public.automation_settings a where a.id) then 'bloqueado'
      when pr.com_lead then 'com_lead' when pr.aberta then 'na_fila' else 'aguardando' end sit
    from presentes pr
  )
  select k.g_id, k.g_name, k.p_id, k.p_nome,
    case when k.sit in ('bloqueado', 'com_lead') then null
         else row_number() over (partition by k.g_id, (k.sit in ('bloqueado', 'com_lead'))
                order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id)::int end,
    k.sit, k.entrou, to_char(k.abre, 'HH24:MI'), k.ultima_vez, k.atrasos::int
  from classificados k
  order by k.g_name, (k.sit = 'bloqueado'), (k.sit = 'com_lead'),
           (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id;
end;
$$;
revoke all on function public.fila_em_formacao() from public, anon;
grant execute on function public.fila_em_formacao() to authenticated;

