-- 0244 · Diretor alterna o Dashboard entre imobiliária e própria diretoria.
--
-- A 0141 recorta deals/leads pela hierarquia do diretor. Essa regra continua
-- valendo em Pipeline, Leads e exportações. Estas duas RPCs são somente leitura
-- e entregam o necessário para o Dashboard da imobiliária sem alargar as RLS.

create or replace function public.dashboard_imobiliaria_payload()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_role('director')) then
    raise exception 'Somente diretor ou administrador acessa o Dashboard da imobiliária.' using errcode = '42501';
  end if;

  with participantes as (
    select dp.deal_id,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'broker'))[1] as b1,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'broker'))[2] as b2,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'broker'))[3] as b3,
           (array_agg(dp.share_pct order by dp.ordinal) filter (where dp.role = 'broker'))[1] as bs1,
           (array_agg(dp.share_pct order by dp.ordinal) filter (where dp.role = 'broker'))[2] as bs2,
           (array_agg(dp.share_pct order by dp.ordinal) filter (where dp.role = 'broker'))[3] as bs3,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'manager'))[1] as m1,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'manager'))[2] as m2,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'manager'))[3] as m3,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'director'))[1] as d1,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'director'))[2] as d2
      from public.deal_participants dp
     group by dp.deal_id
  ), negocios as (
    select jsonb_build_object(
      'id', d.id, 'code', d.code,
      'client', coalesce(cli.full_name, 'Cliente não informado'),
      'developer', coalesce(dev.name, ''), 'developer_color', dev.color,
      'developer_id', d.developer_id, 'project', coalesce(d.project_name, proj.name, ''),
      'project_id', d.project_id, 'unit', coalesce(d.unit, ''),
      'status', coalesce(d.status_detail,
        case d.outcome when 'won' then 'VENDA' when 'lost' then upper(coalesce(d.lost_reason, 'PERDIDO')) else 'PROPOSTA' end),
      'status_detail', d.status_detail, 'status_group_id', d.status_group_id,
      'status_group_code', grp.code, 'lost_reason', d.lost_reason,
      'stage', coalesce(st.code, 'incomplete'), 'stage_id', d.stage_id,
      'stage_label', coalesce(st.label, 'Sem etapa'), 'stage_position', coalesce(st.position, 0),
      'outcome', d.outcome, 'lead_origin', d.lead_origin,
      'month_base', to_char(d.month_base, 'MM/YYYY'),
      'broker1_id', pa.b1, 'broker2_id', pa.b2, 'broker3_id', pa.b3,
      'broker1_share', pa.bs1, 'broker2_share', pa.bs2, 'broker3_share', pa.bs3,
      'manager1_id', pa.m1, 'manager2_id', pa.m2, 'manager3_id', pa.m3,
      'director1_id', pa.d1, 'director2_id', pa.d2,
      'broker1', coalesce(pb1.full_name, ''), 'broker2', pb2.full_name, 'broker3', pb3.full_name,
      'broker1_name', pb1.full_name, 'broker2_name', pb2.full_name,
      'manager1', coalesce(pm1.full_name, ''), 'manager2', pm2.full_name, 'manager3', pm3.full_name,
      'manager1_name', pm1.full_name, 'manager2_name', pm2.full_name,
      'director1_name', pd1.full_name, 'director2_name', pd2.full_name,
      'deal_value', coalesce(d.vgv_net, 0), 'vgv_liquido', coalesce(d.vgv_net, 0),
      'active', d.outcome not in ('lost', 'cancelled'), 'created_at', d.created_at,
      'document_review_status', d.document_review_status,
      'document_review_requested_at', d.document_review_requested_at,
      'document_review_reason', d.document_review_reason,
      'contract_has_pending_issue', d.contract_has_pending_issue
    ) as row
      from public.deals d
      left join participantes pa on pa.deal_id = d.id
      left join lateral (
        select dc.full_name from public.deal_clients dc
         where dc.deal_id = d.id order by dc.ordinal, dc.id limit 1
      ) cli on true
      left join public.pipeline_stages st on st.id = d.stage_id
      left join public.developers dev on dev.id = d.developer_id
      left join public.developer_projects proj on proj.id = d.project_id
      left join public.deal_status_groups grp on grp.id = d.status_group_id
      left join public.profiles pb1 on pb1.id = pa.b1
      left join public.profiles pb2 on pb2.id = pa.b2
      left join public.profiles pb3 on pb3.id = pa.b3
      left join public.profiles pm1 on pm1.id = pa.m1
      left join public.profiles pm2 on pm2.id = pa.m2
      left join public.profiles pm3 on pm3.id = pa.m3
      left join public.profiles pd1 on pd1.id = pa.d1
      left join public.profiles pd2 on pd2.id = pa.d2
  ), papeis as (
    select ur.profile_id, array_agg(ur.role order by ur.role::text) as roles
      from public.user_roles ur group by ur.profile_id
  ), membro_atual as (
    select distinct on (tm.profile_id) tm.profile_id, t.id as team_id, t.name as team_name,
           t.manager_id, t.director_id
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where tm.left_at is null
     order by tm.profile_id, tm.joined_at desc nulls last, tm.created_at desc, tm.id desc
  ), pessoas as (
    select jsonb_build_object(
      'id', p.id, 'user_id', p.id, 'name', p.full_name, 'full_name', p.full_name,
      'email', p.email, 'phone', p.phone, 'avatar_url', p.avatar_url,
      'active', p.status = 'active', 'status', p.status,
      'roles', to_jsonb(coalesce(pa.roles, array['broker'::public.app_role])),
      'role', case
        when 'admin'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'admin'
        when 'director'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'director'
        when 'manager'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'manager'
        when 'cca'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'cca'
        when 'sdr'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'sdr'
        when 'marketing'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'marketing'
        when 'partner'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'partner'
        else 'broker' end,
      'team_id', ma.team_id, 'team', coalesce(ma.team_name, ''),
      'manager_id', ma.manager_id, 'director_id', ma.director_id
    ) as row
      from public.profiles p
      left join papeis pa on pa.profile_id = p.id
      left join membro_atual ma on ma.profile_id = p.id
  )
  select jsonb_build_object(
    'deals', coalesce((select jsonb_agg(n.row) from negocios n), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(p.row) from pessoas p), '[]'::jsonb),
    'activeMonth', to_char(coalesce(public.current_season_month(), current_date), 'MM/YYYY'),
    'leadsCount', (select count(*) from public.leads),
    'ccaCounts', '{}'::jsonb,
    'ccaDealIds', coalesce((select jsonb_agg(distinct c.deal_id) from public.cca_cases c), '[]'::jsonb),
    'closedMonths', coalesce((select jsonb_agg(to_char(cm.period, 'MM/YYYY') order by cm.period desc) from public.closed_months cm), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_imobiliaria_payload() from public, anon;
grant execute on function public.dashboard_imobiliaria_payload() to authenticated;

create or replace function public.dashboard_imobiliaria_leads(
  p_de timestamptz default null,
  p_ate timestamptz default null
)
returns table (
  id uuid, name text, phone text, whatsapp text, email text, source text,
  broker_id text, broker_name text, created_at timestamptz, status text, notes text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada.' using errcode = '28000'; end if;
  if not (public.is_admin() or public.has_role('director')) then
    raise exception 'Somente diretor ou administrador acessa os leads do Dashboard da imobiliária.' using errcode = '42501';
  end if;

  return query
  select l.id, l.full_name, coalesce(l.phone, ''), coalesce(l.phone, ''), coalesce(l.email, ''),
         coalesce(src.label, l.utm_source, ''), coalesce(l.assigned_to::text, ''), prof.full_name,
         l.created_at,
         case when l.status = 'converted' then 'converted'
              when l.status in ('lost', 'discarded') then 'lost'
              when l.funnel_stage = 'qualified' then 'qualified'
              when l.status in ('attending', 'in_progress') then 'contacted'
              else 'new' end,
         coalesce(l.notes, '')
    from public.leads l
    left join public.lead_sources src on src.id = l.source_id
    left join public.profiles prof on prof.id = l.assigned_to
   where (p_de is null or l.created_at >= p_de)
     and (p_ate is null or l.created_at < p_ate)
   order by l.created_at desc, l.id
   limit case when p_de is null and p_ate is null then 1000 else null end;
end;
$$;

revoke all on function public.dashboard_imobiliaria_leads(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_imobiliaria_leads(timestamptz, timestamptz) to authenticated;

comment on function public.dashboard_imobiliaria_payload() is
  'Carga somente leitura do Dashboard da imobiliária para diretor/admin, sem ampliar as RLS das telas operacionais.';
comment on function public.dashboard_imobiliaria_leads(timestamptz, timestamptz) is
  'Leads da imobiliária para os gráficos do Dashboard de diretor/admin; 1.000 recentes sem intervalo, completo com intervalo.';
