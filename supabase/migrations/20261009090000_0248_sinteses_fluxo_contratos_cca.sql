-- =============================================================================
-- 0248 · Sínteses mensais, fluxo para virar negócio e contratos no CCA
-- =============================================================================

-- Status que ainda não existiam no catálogo comercial.
insert into public.deal_statuses (value, label, group_id, position, tone, active, locked)
select x.value, x.value, g.id,
       coalesce((select max(s.position) from public.deal_statuses s where s.group_id = g.id), 0) + x.ord,
       x.tone, true, false
  from (values
    ('RESOLVER P/ ASSINAR BANCO', 1, 'warning'),
    ('AGUARDANDO DEMANDA MÍNIMA', 2, 'info')
  ) x(value, ord, tone)
  join public.deal_status_groups g on g.code = 'PROPOSTA'
 where not exists (
   select 1 from public.deal_statuses s
    where public.deal_status_bare(s.value) = public.deal_status_bare(x.value)
 );

update public.deal_statuses set active = true
 where public.deal_status_bare(value) in
   ('RESOLVER P/ ASSINAR BANCO', 'AGUARDANDO DEMANDA MÍNIMA',
    'PENDENTE P/ VIRAR NEGÓCIO', 'ANÁLISE P/ VIRAR NEGÓCIO');

update public.deal_statuses s
   set stage_id = p.id
  from public.pipeline_stages p
 where p.code = 'under_analysis' and p.active
   and public.deal_status_bare(s.value) in
       ('RESOLVER P/ ASSINAR BANCO', 'AGUARDANDO DEMANDA MÍNIMA')
   and s.stage_id is null;

-- As duas sínteses novas são decisões internas do CCA. O comercial as enxerga,
-- mas não as grava por fora da esteira.
insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select s.id, 'cca'::public.app_role, true, true
  from public.deal_statuses s
 where public.deal_status_bare(s.value) in
   ('RESOLVER P/ ASSINAR BANCO', 'AGUARDANDO DEMANDA MÍNIMA')
on conflict (status_id, role) do update
set can_enter = true, can_exit = true, updated_at = now();

-- Colunas que precisam existir nos dois espelhos. ANÁLISE P/ VIRAR NEGÓCIO é
-- rótulo de entrada do sistema e fica sem deal_status_id; ccaColumnOf casa pelo
-- nome. As demais acompanham o Status 2 do negócio automaticamente.
do $$
declare
  v_name text;
  v_status text;
  v_color text;
  v_case_status public.cca_status;
  v_status_id uuid;
  v_position integer;
begin
  for v_name, v_status, v_color, v_case_status in
    select * from (values
      ('ANÁLISE P/ VIRAR NEGÓCIO', null::text, 'info', 'under_review'::public.cca_status),
      ('PENDENTE P/ VIRAR NEGÓCIO', 'PENDENTE P/ VIRAR NEGÓCIO', 'warning', 'pending_documents'::public.cca_status),
      ('RESOLVER P/ ASSINAR BANCO', 'RESOLVER P/ ASSINAR BANCO', 'warning', 'approved'::public.cca_status),
      ('AGUARDANDO DEMANDA MÍNIMA', 'AGUARDANDO DEMANDA MÍNIMA', 'info', 'approved'::public.cca_status),
      ('EM CONTRATO', 'EM CONTRATO', 'info', 'approved'::public.cca_status),
      ('ASSINADO', 'ASSINADO', 'success', 'approved'::public.cca_status)
    ) q(name, status_name, color, case_status)
  loop
    v_status_id := null;
    if v_status is not null then
      select id into v_status_id from public.deal_statuses
       where public.deal_status_bare(value) = public.deal_status_bare(v_status)
       order by active desc limit 1;
    end if;

    if exists (select 1 from public.cca_stages where public.cca_stage_name_key(name) = public.cca_stage_name_key(v_name)) then
      update public.cca_stages
         set active = true,
             status = v_case_status,
             deal_status_id = coalesce(v_status_id, deal_status_id),
             notify_sales = true
       where public.cca_stage_name_key(name) = public.cca_stage_name_key(v_name);
    else
      select coalesce(max(position), 0) + 1 into v_position from public.cca_stages where active and position < 100;
      insert into public.cca_stages
        (name, color, position, status, active, deal_status_id, notify_sales)
      values (v_name, v_color, v_position, v_case_status, true, v_status_id, true);
    end if;
  end loop;
end $$;

-- Relatório por ENTRADA no status. A fonte é o comentário imutável que
-- move_cca_case grava no mesmo instante do movimento, não month_base da venda.
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
  )
  select m.id, m.deal_id, m.stage, m.created_at, d.code,
         c.full_name, dev.name, d.project_name,
         brokers.names
    from movimentos m
    join public.deals d on d.id = m.deal_id
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
    left join public.developers dev on dev.id = d.developer_id
    left join lateral (
      select string_agg(p.full_name, ', ' order by dp.share desc, p.full_name) as names
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

-- Encerramento específico da CCA para contratos. A justificativa é obrigatória;
-- QUEDA continua no mês vigente e DISTRATO continua reservado a mês anterior.
create or replace function public.cca_close_contract(
  p_deal_id uuid,
  p_outcome text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_target text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_current_month date := public.month_start(coalesce(public.current_season_month(), current_date));
  v_lost_stage uuid;
  v_client text;
  v_actor text;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not (public.is_admin() or (public.has_role('cca') and public.has_permission('cca.review'))) then
    raise exception 'Só a equipe CCA encerra contratos por esta ação.' using errcode = '42501';
  end if;
  if v_reason = '' then raise exception 'A justificativa é obrigatória.' using errcode = 'P0001'; end if;

  v_target := public.deal_status_bare(p_outcome);
  if v_target not in ('QUEDA', 'DISTRATO') then
    raise exception 'Escolha QUEDA ou DISTRATO.' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Negócio não encontrado.' using errcode = 'P0002'; end if;
  if public.deal_status_bare(v_deal.status_detail) not in
     ('EM CONTRATO', 'ASSINADO', 'ASS. BANCO', 'RC EMITIDA') then
    raise exception 'Esta ação é exclusiva de contratos e negócios já assinados.' using errcode = 'P0001';
  end if;
  if v_target = 'QUEDA' and v_deal.month_base is distinct from v_current_month then
    raise exception 'QUEDA só pode ser marcada no mês vigente (%).', to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;
  if v_target = 'DISTRATO' and v_deal.month_base >= v_current_month then
    raise exception 'DISTRATO só pode ser marcado em mês anterior a %.', to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;

  select id into v_lost_stage from public.pipeline_stages where code = 'lost' and active limit 1;
  if v_lost_stage is null then raise exception 'A etapa Perdido não está configurada.' using errcode = 'P0001'; end if;

  perform set_config('faceimob.cca_move', 'on', true);
  perform set_config('faceimob.status_note', left(v_reason, 2000), true);
  update public.deals
     set stage_id = v_lost_stage,
         status_detail = case v_target when 'QUEDA' then '18. QUEDA' else '17. DISTRATO' end,
         lost_reason = (case v_target when 'QUEDA' then '18. QUEDA' else '17. DISTRATO' end)
                       || ' — ' || left(v_reason, 1800)
   where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', 'CCA — ' || v_target || ': ' || left(v_reason, 3900));

  select c.full_name into v_client from public.deal_clients c
   where c.deal_id = p_deal_id and c.ordinal = 1;
  select p.full_name into v_actor from public.profiles p where p.id = auth.uid();

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct q.profile_id, 'cca_status_changed',
         v_target || ': ' || coalesce(v_client, v_deal.code, 'negócio'),
         left(coalesce(v_actor, 'CCA') || ' registrou ' || v_target || ': ' || v_reason, 2000),
         '/pipeline?negocio=' || p_deal_id, 'in_app'::public.notification_channel
    from (
      select dp.profile_id from public.deal_participants dp
       where dp.deal_id = p_deal_id and dp.role in ('broker', 'manager', 'director')
      union
      select ur.profile_id from public.user_roles ur where ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.profile_id and p.status = 'active'
   where q.profile_id is distinct from auth.uid();

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name,
     actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         p_deal_id, p.id, btrim(p.email::text), v_deal.code, v_client, v_target,
         coalesce(v_actor, 'CCA'), v_reason, 'cca',
         public.email_detalhes_do_negocio(p_deal_id)
           || jsonb_build_object('status2', v_target, 'observacao', v_reason)
    from (
      select dp.profile_id from public.deal_participants dp
       where dp.deal_id = p_deal_id and dp.role in ('broker', 'manager', 'director')
      union select auth.uid()
      union select ur.profile_id from public.user_roles ur where ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.profile_id and p.status = 'active'
   where coalesce((select s.cca_move_email from public.automation_settings s where s.id), false)
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;
end;
$$;
revoke all on function public.cca_close_contract(uuid, text, text) from public, anon;
grant execute on function public.cca_close_contract(uuid, text, text) to authenticated, service_role;

comment on function public.cca_close_contract(uuid, text, text) is
  'CCA encerra contrato/assinado com justificativa: QUEDA no mês vigente ou DISTRATO em mês anterior, inclusive mês fechado.';
